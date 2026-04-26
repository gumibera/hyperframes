use std::collections::HashMap;

use skia_safe::{FontMgr, Typeface};

use crate::scene::FontDescriptor;

/// Registry of custom typefaces loaded from font files on disk.
///
/// Font files are keyed by `"family-weight-style"` so the text painter can
/// resolve the closest match for each element's computed font properties.
pub struct FontRegistry {
    typefaces: HashMap<String, Typeface>,
}

impl FontRegistry {
    pub fn new() -> Self {
        Self {
            typefaces: HashMap::new(),
        }
    }

    /// Build a registry from a list of font descriptors.  Fonts that fail to
    /// load (missing file, unsupported format) are silently skipped — the
    /// painter falls back to the system default for those families.
    pub fn from_descriptors(descriptors: &[FontDescriptor]) -> Self {
        let mut registry = Self::new();
        for desc in descriptors {
            registry.load_font(&desc.family, &desc.path, desc.weight, &desc.style);
        }
        registry
    }

    /// Load a single font file into the registry.  Returns `true` on success.
    pub fn load_font(&mut self, family: &str, path: &str, weight: u16, style: &str) -> bool {
        let bytes = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => return false,
        };
        let mgr = FontMgr::new();
        let typeface = match mgr.new_from_data(&bytes, 0) {
            Some(tf) => tf,
            None => return false,
        };
        let key = format!("{}-{}-{}", family, weight, style);
        self.typefaces.insert(key, typeface);
        true
    }

    /// Look up a typeface by family, weight, and style.
    ///
    /// Falls back to weight 400 / normal for the same family if the exact
    /// variant is not registered.
    pub fn get_typeface(&self, family: &str, weight: u16, style: &str) -> Option<&Typeface> {
        let key = format!("{}-{}-{}", family, weight, style);
        self.typefaces
            .get(&key)
            .or_else(|| self.typefaces.get(&format!("{}-400-normal", family)))
    }

    pub fn is_empty(&self) -> bool {
        self.typefaces.is_empty()
    }
}
