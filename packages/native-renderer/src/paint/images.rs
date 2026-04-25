use std::collections::HashMap;
use std::process::Command;

use base64::Engine;
use skia_safe::{Data, Image};

/// Thread-safe image cache that loads images from disk on first access and
/// returns the cached `skia_safe::Image` on subsequent lookups.
pub struct ImageCache {
    cache: HashMap<String, Image>,
    video_frames: HashMap<String, Image>,
}

impl ImageCache {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            video_frames: HashMap::new(),
        }
    }

    /// Return a cached image for `src`, loading from disk on first access.
    /// Returns `None` if the file cannot be read or Skia fails to decode it.
    pub fn get_or_load(&mut self, src: &str) -> Option<&Image> {
        if !self.cache.contains_key(src) {
            let image = load_image(src)?;
            self.cache.insert(src.to_string(), image);
        }
        self.cache.get(src)
    }

    /// Number of images currently held in the cache.
    pub fn len(&self) -> usize {
        self.cache.len()
    }

    /// Return a decoded video frame for `src` at `time_secs`, loading via
    /// FFmpeg on first access. This is intentionally correctness-first; higher
    /// throughput comes from pre-extracting frame ranges into this cache.
    pub fn get_or_load_video_frame(&mut self, src: &str, time_secs: f64) -> Option<&Image> {
        let time_key = (time_secs.max(0.0) * 1000.0).round() as u64;
        let key = format!("{src}#{time_key}");
        if !self.video_frames.contains_key(&key) {
            let image = load_video_frame(src, time_secs)?;
            self.video_frames.insert(key.clone(), image);
        }
        self.video_frames.get(&key)
    }
}

/// Read bytes from disk and decode into a Skia `Image`.
fn load_image(src: &str) -> Option<Image> {
    let bytes = load_bytes(src)?;
    let data = Data::new_copy(&bytes);
    Image::from_encoded(data)
}

fn load_bytes(src: &str) -> Option<Vec<u8>> {
    if let Some(rest) = src.strip_prefix("data:") {
        return decode_data_url(rest);
    }

    if let Some(path) = src.strip_prefix("file://") {
        return std::fs::read(percent_decode(path)).ok();
    }

    if src.starts_with("http://") || src.starts_with("https://") {
        let output = Command::new("curl")
            .args(["-fsSL", "--max-time", "20", src])
            .output()
            .ok()?;
        return output.status.success().then_some(output.stdout);
    }

    std::fs::read(src).ok()
}

fn decode_data_url(rest: &str) -> Option<Vec<u8>> {
    let (meta, payload) = rest.split_once(',')?;
    if meta.ends_with(";base64") {
        base64::engine::general_purpose::STANDARD
            .decode(payload)
            .ok()
    } else {
        Some(percent_decode(payload).into_bytes())
    }
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(value) = u8::from_str_radix(hex, 16) {
                    out.push(value);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn ffmpeg_input(src: &str) -> String {
    src.strip_prefix("file://")
        .map(percent_decode)
        .unwrap_or_else(|| src.to_string())
}

fn load_video_frame(src: &str, time_secs: f64) -> Option<Image> {
    let time_arg = format!("{:.6}", time_secs.max(0.0));
    let input = ffmpeg_input(src);
    let output = Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-ss",
            &time_arg,
            "-i",
            &input,
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "-",
        ])
        .output()
        .ok()?;

    if !output.status.success() || output.stdout.is_empty() {
        return None;
    }

    let data = Data::new_copy(&output.stdout);
    Image::from_encoded(data)
}
