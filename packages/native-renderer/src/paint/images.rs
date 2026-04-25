use std::collections::HashMap;

use skia_safe::{Data, Image};

/// Thread-safe image cache that loads images from disk on first access and
/// returns the cached `skia_safe::Image` on subsequent lookups.
pub struct ImageCache {
    cache: HashMap<String, Image>,
}

impl ImageCache {
    pub fn new() -> Self {
        Self {
            cache: HashMap::new(),
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
}

/// Read bytes from disk and decode into a Skia `Image`.
fn load_image(path: &str) -> Option<Image> {
    let bytes = std::fs::read(path).ok()?;
    let data = Data::new_copy(&bytes);
    Image::from_encoded(data)
}
