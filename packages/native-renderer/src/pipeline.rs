use std::io::Write;
use std::process::{Command, Stdio};
use std::time::Instant;

use skia_safe::Color4f;

use crate::paint::{paint_element, RenderSurface};
use crate::scene::Scene;

/// Configuration for a static render pass.
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

    for element in &scene.elements {
        paint_element(surface.canvas(), element);
    }

    let frame_jpeg = surface
        .encode_jpeg(config.quality)
        .ok_or("failed to encode frame as JPEG")?;

    let paint_ms = paint_start.elapsed().as_secs_f64() * 1000.0;

    // Spawn FFmpeg.
    let mut child = Command::new("ffmpeg")
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
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    // Write frame data.
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

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for ffmpeg: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg exited with {}: {stderr}", output.status));
    }

    let total_ms = write_start.elapsed().as_millis() as u64;

    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: paint_ms,
        output_path: config.output_path.clone(),
    })
}
