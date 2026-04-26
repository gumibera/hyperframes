use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::thread::JoinHandle;
use std::time::Instant;

use skia_safe::Color4f;

use crate::encode::{detect_hw_encoder, encoder_args, raw_pixel_encoder_args, HwEncoder};
use crate::paint::{paint_element, paint_element_at_time, ImageCache, RenderSurface};
use crate::scene::{BakedElementState, BakedFrame, BakedTimeline, Element, Scene, Transform2D};

/// Configuration for a render pass.
pub struct RenderConfig {
    pub fps: u32,
    pub duration_secs: f64,
    pub quality: u32,
    pub output_path: String,
}

/// Timing and metadata returned after a successful render.
pub struct RenderResult {
    pub total_frames: u32,
    pub total_ms: u64,
    pub avg_paint_ms: f64,
    pub output_path: String,
}

/// Spawn an FFmpeg process that accepts MJPEG frames on stdin and writes
/// video to `config.output_path`.
///
/// Uses [`detect_hw_encoder`] to pick the best available codec:
/// - macOS: `hevc_videotoolbox` (Apple Silicon hardware)
/// - Linux NVIDIA: `h264_nvenc`
/// - Linux Intel/AMD: `h264_vaapi`
/// - Fallback: `libx264` (CPU)
fn spawn_ffmpeg(config: &RenderConfig) -> Result<(Child, HwEncoder), String> {
    spawn_ffmpeg_with_encoder(config, detect_hw_encoder())
}

/// Spawn FFmpeg with a specific encoder (useful for tests and benchmarks
/// that need deterministic codec selection).
fn spawn_ffmpeg_with_encoder(
    config: &RenderConfig,
    encoder: HwEncoder,
) -> Result<(Child, HwEncoder), String> {
    let mut args = encoder_args(encoder, config.fps, config.quality);
    args.push(config.output_path.clone());

    let child = Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    Ok((child, encoder))
}

/// Wait for FFmpeg to finish and return an error if it exited non-zero.
fn finish_ffmpeg(child: Child) -> Result<(), String> {
    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for ffmpeg: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg exited with {}: {stderr}", output.status));
    }
    Ok(())
}

fn spawn_raw_rgba_ffmpeg_writer(
    config: &RenderConfig,
    width: u32,
    height: u32,
) -> Result<
    (
        SyncSender<Vec<u8>>,
        JoinHandle<Result<Child, String>>,
        HwEncoder,
    ),
    String,
> {
    let encoder = detect_hw_encoder();
    let mut args = raw_pixel_encoder_args(encoder, config.fps, config.quality, width, height);
    args.push(config.output_path.clone());

    let mut child = Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    let mut stdin = child.stdin.take().ok_or("failed to open ffmpeg stdin")?;
    // Deep buffer lets the GPU render 16 frames ahead of FFmpeg,
    // decoupling paint throughput from encode throughput.
    let (tx, rx) = sync_channel::<Vec<u8>>(16);

    let writer = std::thread::spawn(move || {
        for frame in rx {
            stdin
                .write_all(&frame)
                .map_err(|e| format!("failed to write raw frame to ffmpeg: {e}"))?;
        }
        drop(stdin);
        Ok(child)
    });

    Ok((tx, writer, encoder))
}

fn finish_ffmpeg_writer(writer: JoinHandle<Result<Child, String>>) -> Result<(), String> {
    let child = writer
        .join()
        .map_err(|_| "ffmpeg writer thread panicked".to_string())??;
    finish_ffmpeg(child)
}

/// Render a static scene (no animation) to a video file via FFmpeg pipe.
///
/// The scene is painted once and the resulting JPEG frame is written
/// `total_frames` times to FFmpeg's stdin, producing a still-image video.
pub fn render_static(scene: &Scene, config: &RenderConfig) -> Result<RenderResult, String> {
    let total_frames = (config.fps as f64 * config.duration_secs).ceil() as u32;
    if total_frames == 0 {
        return Err("total_frames is zero — check fps and duration_secs".into());
    }

    // Paint once.
    let paint_start = Instant::now();

    let mut surface = RenderSurface::new_raster(scene.width as i32, scene.height as i32)?;
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let mut image_cache = ImageCache::new();
    for element in &scene.elements {
        paint_element(surface.canvas(), element, &mut image_cache);
    }

    let frame_jpeg = surface
        .encode_jpeg(config.quality)
        .ok_or("failed to encode frame as JPEG")?;

    let paint_ms = paint_start.elapsed().as_secs_f64() * 1000.0;

    // Spawn FFmpeg and pipe frames.
    let (mut child, _encoder) = spawn_ffmpeg(config)?;
    let write_start = Instant::now();
    {
        let stdin = child.stdin.as_mut().ok_or("failed to open ffmpeg stdin")?;

        for _ in 0..total_frames {
            stdin
                .write_all(&frame_jpeg)
                .map_err(|e| format!("failed to write frame to ffmpeg: {e}"))?;
        }
    }
    // stdin is dropped here, signalling EOF to FFmpeg.

    finish_ffmpeg(child)?;

    let total_ms = write_start.elapsed().as_millis() as u64;

    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: paint_ms,
        output_path: config.output_path.clone(),
    })
}

// ── Raw Frame Pipeline (fastest render, deferred encode) ────────────────────

/// Render all frames to a raw BGRA file at maximum speed, then encode
/// with a single FFmpeg batch call. Skips I420 conversion during render —
/// writes BGRA directly (Skia's native format), lets FFmpeg batch-convert.
///
/// This is the fastest render path: paint + write, no color conversion.
/// Pre-allocates the BGRA buffer once and reuses it across frames.
pub fn render_animated_raw_then_encode(
    scene: &Scene,
    timeline: &BakedTimeline,
    config: &RenderConfig,
) -> Result<RenderResult, String> {
    let total_frames = timeline.total_frames;
    if total_frames == 0 {
        return Err("timeline has zero frames".into());
    }

    let w = scene.width as i32;
    let h = scene.height as i32;
    let frame_bytes = w as usize * h as usize * 4; // BGRA

    let mut surface = RenderSurface::new_raster(w, h)?;
    let mut images = ImageCache::new();
    // Pre-allocate BGRA buffer — reused every frame (no per-frame allocation)
    let mut bgra_buf = vec![0u8; frame_bytes];

    let raw_path = format!("{}.raw", config.output_path);
    let mut raw_file = std::fs::File::create(&raw_path)
        .map_err(|e| format!("create raw file: {e}"))?;

    let render_start = Instant::now();
    let mut paint_total_ms: f64 = 0.0;

    for frame in &timeline.frames {
        let animated_scene = apply_frame_deltas(scene, frame);

        let paint_start = Instant::now();
        surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
        for element in &animated_scene.elements {
            paint_element_at_time(surface.canvas(), element, &mut images, frame.time);
        }
        paint_total_ms += paint_start.elapsed().as_secs_f64() * 1000.0;

        // Read BGRA directly — no I420 conversion in the render loop
        surface.read_pixels_bgra_into(&mut bgra_buf)
            .ok_or("read pixels failed")?;

        use std::io::Write as _;
        raw_file.write_all(&bgra_buf).map_err(|e| format!("write raw: {e}"))?;
    }

    let render_ms = render_start.elapsed().as_millis() as u64;

    // Phase 2: Single FFmpeg batch encode — converts BGRA→YUV + encodes
    let ffmpeg_child = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "rawvideo",
            "-pix_fmt", "bgra",
            "-s", &format!("{}x{}", w, h),
            "-r", &config.fps.to_string(),
            "-i", &raw_path,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-crf", "18",
            "-threads", "0",
            "-pix_fmt", "yuv420p",
            &config.output_path,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg spawn: {e}"))?;

    finish_ffmpeg(ffmpeg_child)?;
    std::fs::remove_file(&raw_path).ok();

    let total_ms = render_start.elapsed().as_millis() as u64;
    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: paint_total_ms / total_frames as f64,
        output_path: config.output_path.clone(),
    })
}

// ── Native Pipeline (no FFmpeg) ─────────────────────────────────────────────

/// Render an animated scene entirely in Rust — no FFmpeg subprocess.
/// Uses openh264 for H.264 encoding and minimp4 for MP4 muxing.
/// This is the fastest path: no pipe, no subprocess startup, no serialization.
pub fn render_animated_native(
    scene: &Scene,
    timeline: &BakedTimeline,
    config: &RenderConfig,
) -> Result<RenderResult, String> {
    use crate::native_encode::NativeEncoder;

    let total_frames = timeline.total_frames;
    if total_frames == 0 {
        return Err("timeline has zero frames".into());
    }

    let w = scene.width;
    let h = scene.height;
    let mut encoder = NativeEncoder::new(w, h, config.fps)?;
    let mut surface = RenderSurface::new_raster(w as i32, h as i32)?;
    let mut images = ImageCache::new();

    let start = Instant::now();
    let mut paint_total_ms: f64 = 0.0;

    for frame in &timeline.frames {
        let animated_scene = apply_frame_deltas(scene, frame);

        let paint_start = Instant::now();
        surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
        for element in &animated_scene.elements {
            paint_element_at_time(surface.canvas(), element, &mut images, frame.time);
        }
        paint_total_ms += paint_start.elapsed().as_secs_f64() * 1000.0;

        let bgra = surface
            .read_pixels_bgra()
            .ok_or("failed to read pixels")?;
        encoder.encode_bgra_frame(&bgra)?;
    }

    encoder.finish_to_mp4(&config.output_path)?;

    let total_ms = start.elapsed().as_millis() as u64;
    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: paint_total_ms / total_frames as f64,
        output_path: config.output_path.clone(),
    })
}

// ── Animated Pipeline (FFmpeg) ──────────────────────────────────────────────

/// Render an animated scene driven by a pre-baked timeline.
///
/// Each frame in the timeline carries a full snapshot of every animated
/// element's visual state.  For each frame we clone the base scene, apply
/// the per-element deltas, paint, encode to JPEG, and pipe into FFmpeg.
pub fn render_animated(
    scene: &Scene,
    timeline: &BakedTimeline,
    config: &RenderConfig,
) -> Result<RenderResult, String> {
    let total_frames = timeline.total_frames;
    if total_frames == 0 {
        return Err("timeline has zero frames".into());
    }

    let mut surface = RenderSurface::new_raster(scene.width as i32, scene.height as i32)?;
    let mut image_cache = ImageCache::new();

    let (mut child, _encoder) = spawn_ffmpeg(config)?;
    let stdin = child.stdin.as_mut().ok_or("failed to open ffmpeg stdin")?;

    let start = Instant::now();
    let mut paint_total_ms: f64 = 0.0;

    for frame in &timeline.frames {
        let animated_scene = apply_frame_deltas(scene, frame);

        let paint_start = Instant::now();
        surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
        for element in &animated_scene.elements {
            paint_element_at_time(surface.canvas(), element, &mut image_cache, frame.time);
        }
        paint_total_ms += paint_start.elapsed().as_secs_f64() * 1000.0;

        let jpeg = surface
            .encode_jpeg(config.quality)
            .ok_or("failed to encode animated frame as JPEG")?;
        stdin
            .write_all(&jpeg)
            .map_err(|e| format!("failed to write animated frame to ffmpeg: {e}"))?;
    }

    // Close stdin to signal EOF, then wait for FFmpeg.
    drop(child.stdin.take());
    finish_ffmpeg(child)?;

    let total_ms = start.elapsed().as_millis() as u64;

    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: paint_total_ms / total_frames as f64,
        output_path: config.output_path.clone(),
    })
}

/// Clone the scene and apply per-element deltas from a single baked frame.
fn apply_frame_deltas(scene: &Scene, frame: &BakedFrame) -> Scene {
    let mut animated = scene.clone();
    apply_deltas_recursive(&mut animated.elements, &frame.elements);
    animated
}

/// Walk the element tree and patch style/transform from the delta map.
fn apply_deltas_recursive(
    elements: &mut Vec<Element>,
    deltas: &std::collections::HashMap<String, BakedElementState>,
) {
    for element in elements.iter_mut() {
        if let Some(state) = deltas.get(&element.id) {
            element.style.opacity = state.opacity;
            element.style.visibility = state.visibility;
            element.style.transform = Some(Transform2D {
                translate_x: state.translate_x,
                translate_y: state.translate_y,
                scale_x: state.scale_x,
                scale_y: state.scale_y,
                rotate_deg: state.rotate_deg,
            });
        }
        apply_deltas_recursive(&mut element.children, deltas);
    }
}

// ── Chunk-Parallel GPU Pipeline (macOS Metal) ─────────────────────────────

/// Render an animated scene with GPU acceleration (Metal on macOS, Vulkan on
/// Linux) and a background raw-pixel pipe to FFmpeg with hardware encoding.
///
/// Falls back to CPU raster if no GPU is available (Docker without GPU access).
/// Hardware encoding auto-detects: VideoToolbox (macOS), NVENC (NVIDIA),
/// VAAPI (Intel/AMD), libx264 (CPU fallback).
pub fn render_animated_gpu(
    scene: &Scene,
    timeline: &BakedTimeline,
    config: &RenderConfig,
) -> Result<RenderResult, String> {
    let total_frames = timeline.total_frames;
    if total_frames == 0 {
        return Err("timeline has zero frames".into());
    }

    let width = scene.width as i32;
    let height = scene.height as i32;
    let mut surface = RenderSurface::new_gpu_or_raster(width, height)?;
    let mut images = ImageCache::new();

    let (frame_tx, writer, _encoder) =
        spawn_raw_rgba_ffmpeg_writer(config, scene.width, scene.height)?;

    let start = Instant::now();
    let mut paint_total_ms: f64 = 0.0;

    for (_i, frame) in timeline.frames.iter().enumerate() {
        let animated_scene = apply_frame_deltas(scene, frame);

        let paint_start = Instant::now();
        surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
        for element in &animated_scene.elements {
            paint_element_at_time(surface.canvas(), element, &mut images, frame.time);
        }
        surface.flush_and_submit();
        paint_total_ms += paint_start.elapsed().as_secs_f64() * 1000.0;

        let bgra = surface
            .read_pixels_bgra()
            .ok_or("failed to read GPU frame pixels")?;
        frame_tx
            .send(bgra)
            .map_err(|e| format!("failed to queue GPU frame for ffmpeg: {e}"))?;
    }

    drop(frame_tx);
    finish_ffmpeg_writer(writer)?;

    let total_ms = start.elapsed().as_millis() as u64;
    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: paint_total_ms / total_frames as f64,
        output_path: config.output_path.clone(),
    })
}
