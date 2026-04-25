use skia_safe::{
    surfaces, AlphaType, Canvas, Color4f, ColorType, EncodedImageFormat, ImageInfo, Surface,
};

/// A CPU-backed Skia rendering surface.
///
/// Wraps `skia_safe::Surface` and provides convenience methods for clearing,
/// drawing, pixel readback, and image encoding. Phase 1 uses a raster (CPU)
/// backend; a GPU backend will be introduced in Phase 3.
pub struct RenderSurface {
    surface: Surface,
}

impl RenderSurface {
    /// Create a CPU-backed raster surface with premultiplied N32 color type.
    pub fn new_raster(width: i32, height: i32) -> Result<Self, String> {
        let surface = surfaces::raster_n32_premul((width, height))
            .ok_or_else(|| format!("failed to create {width}x{height} raster surface"))?;
        Ok(Self { surface })
    }

    /// Get the Skia canvas for drawing operations.
    pub fn canvas(&mut self) -> &Canvas {
        self.surface.canvas()
    }

    /// Read back the rendered pixels as RGBA8888 bytes.
    ///
    /// Returns `None` if the readback fails (e.g. zero-sized surface).
    pub fn read_pixels_rgba(&mut self) -> Option<Vec<u8>> {
        let width = self.surface.width();
        let height = self.surface.height();
        let row_bytes = width as usize * 4;
        let mut dst = vec![0u8; row_bytes * height as usize];

        let info = ImageInfo::new(
            (width, height),
            ColorType::RGBA8888,
            AlphaType::Premul,
            None,
        );

        let ok = self.surface.read_pixels(
            &info,
            &mut dst,
            row_bytes,
            (0, 0),
        );

        if ok {
            Some(dst)
        } else {
            None
        }
    }

    /// Encode the surface contents as JPEG bytes at the given quality (1-100).
    pub fn encode_jpeg(&mut self, quality: u32) -> Option<Vec<u8>> {
        let image = self.surface.image_snapshot();
        let data = image.encode(None, EncodedImageFormat::JPEG, quality)?;
        Some(data.as_bytes().to_vec())
    }

    /// Encode the surface contents as PNG bytes.
    pub fn encode_png(&mut self) -> Option<Vec<u8>> {
        let image = self.surface.image_snapshot();
        let data = image.encode(None, EncodedImageFormat::PNG, 100)?;
        Some(data.as_bytes().to_vec())
    }

    /// Clear the entire surface with a color.
    pub fn clear(&mut self, color: Color4f) {
        self.surface.canvas().clear(color);
    }

    /// Surface width in pixels.
    pub fn width(&self) -> i32 {
        self.surface.width()
    }

    /// Surface height in pixels.
    pub fn height(&self) -> i32 {
        self.surface.height()
    }
}
