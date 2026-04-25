use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::time::Instant;

use skia_safe::Color4f;

use crate::paint::{paint_element, ImageCache, RenderSurface};
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

/// Spawn an FFmpeg process that accepts MJPEG frames on stdin and writes an
/// H.264 MP4 to `config.output_path`.
fn spawn_ffmpeg(config: &RenderConfig) -> Result<Child, String> {
    Command::new("ffmpeg")
        .args([
            "-y",
            "-f",
            "image2pipe",
            "-vcodec",
            "mjpeg",
            "-framerate",
            &config.fps.to_string(),
            "-i",
            "-",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-threads",
            "0",
            &config.output_path,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))
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
    let mut child = spawn_ffmpeg(config)?;
    let write_start = Instant::now();
    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or("failed to open ffmpeg stdin")?;

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

// ── Animated Pipeline ───────────────────────────────────────────────────────

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

    let mut child = spawn_ffmpeg(config)?;
    let stdin = child
        .stdin
        .as_mut()
        .ok_or("failed to open ffmpeg stdin")?;

    let start = Instant::now();
    let mut paint_total_ms: f64 = 0.0;

    for frame in &timeline.frames {
        let animated_scene = apply_frame_deltas(scene, frame);

        let paint_start = Instant::now();
        surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
        for element in &animated_scene.elements {
            paint_element(surface.canvas(), element, &mut image_cache);
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
