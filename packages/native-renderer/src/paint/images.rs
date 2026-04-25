use std::collections::{hash_map::DefaultHasher, HashMap};
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::process::Command;

use base64::Engine;
use skia_safe::{Data, Image};

/// Thread-safe image cache that loads images from disk on first access and
/// returns the cached `skia_safe::Image` on subsequent lookups.
pub struct ImageCache {
    cache: HashMap<String, Image>,
    video_frames: HashMap<String, Image>,
    video_inputs: HashMap<String, String>,
}

impl ImageCache {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
            video_frames: HashMap::new(),
            video_inputs: HashMap::new(),
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
            let input = self.get_or_resolve_video_input(src)?;
            let image = load_video_frame(&input, time_secs)?;
            self.video_frames.insert(key.clone(), image);
        }
        self.video_frames.get(&key)
    }

    fn get_or_resolve_video_input(&mut self, src: &str) -> Option<String> {
        if !self.video_inputs.contains_key(src) {
            let input = resolve_video_input(src)?;
            self.video_inputs.insert(src.to_string(), input);
        }
        self.video_inputs.get(src).cloned()
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

fn resolve_video_input(src: &str) -> Option<String> {
    if src.starts_with("http://") || src.starts_with("https://") {
        return download_video_to_cache(src);
    }

    src.strip_prefix("file://")
        .map(percent_decode)
        .or_else(|| Some(src.to_string()))
}

fn download_video_to_cache(src: &str) -> Option<String> {
    let path = cached_video_path(src);
    if !path.exists() {
        let output = Command::new("curl")
            .args(["-fsSL", "--max-time", "120", "-o", path.to_str()?, src])
            .output()
            .ok()?;
        if !output.status.success() {
            let _ = std::fs::remove_file(&path);
            return None;
        }
    }
    Some(path.to_string_lossy().into_owned())
}

fn cached_video_path(src: &str) -> PathBuf {
    let mut hasher = DefaultHasher::new();
    src.hash(&mut hasher);
    std::env::temp_dir().join(format!(
        "hyperframes-native-video-{:016x}.mp4",
        hasher.finish()
    ))
}

fn load_video_frame(input: &str, time_secs: f64) -> Option<Image> {
    let time_arg = format!("{:.6}", time_secs.max(0.0));
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
