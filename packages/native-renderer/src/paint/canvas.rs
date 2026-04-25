use skia_safe::{
    surfaces, AlphaType, Canvas, Color4f, ColorType, EncodedImageFormat, ImageInfo, Surface,
};

#[cfg(target_os = "macos")]
use skia_safe::gpu;

/// A Skia rendering surface backed by either CPU raster or GPU (Metal).
///
/// Wraps `skia_safe::Surface` and provides convenience methods for clearing,
/// drawing, pixel readback, and image encoding.
///
/// When created via [`new_metal_gpu`](Self::new_metal_gpu), the surface is
/// GPU-accelerated through Apple's Metal API. The `DirectContext` is kept alive
/// alongside the surface for the duration of rendering.
pub struct RenderSurface {
    surface: Surface,
    /// Keeps the GPU context alive for GPU-backed surfaces. `None` for raster.
    #[cfg(target_os = "macos")]
    _gpu_context: Option<gpu::DirectContext>,
}

impl RenderSurface {
    /// Create a CPU-backed raster surface with premultiplied N32 color type.
    pub fn new_raster(width: i32, height: i32) -> Result<Self, String> {
        let surface = surfaces::raster_n32_premul((width, height))
            .ok_or_else(|| format!("failed to create {width}x{height} raster surface"))?;
        Ok(Self {
            surface,
            #[cfg(target_os = "macos")]
            _gpu_context: None,
        })
    }

    /// Create a Metal GPU-accelerated surface (macOS only).
    ///
    /// Uses the system default Metal device and a Skia `DirectContext` backed by
    /// Apple's Metal API. Drawing commands issued through `canvas()` execute on
    /// the GPU, which is 7-30x faster than CPU raster for typical composition
    /// workloads on Apple Silicon.
    ///
    /// Call [`flush_and_submit`](Self::flush_and_submit) after drawing to ensure
    /// all GPU work is submitted before reading back pixels.
    #[cfg(target_os = "macos")]
    pub fn new_metal_gpu(width: i32, height: i32) -> Result<Self, String> {
        use metal::foreign_types::ForeignType;

        let device = metal::Device::system_default()
            .ok_or("no Metal GPU device found")?;
        let queue = device.new_command_queue();

        let backend = unsafe {
            gpu::mtl::BackendContext::new(
                device.as_ptr() as gpu::mtl::Handle,
                queue.as_ptr() as gpu::mtl::Handle,
            )
        };

        let mut context = gpu::direct_contexts::make_metal(&backend, None)
            .ok_or("failed to create Skia Metal DirectContext")?;

        let image_info = ImageInfo::new(
            (width, height),
            ColorType::BGRA8888,
            AlphaType::Premul,
            None,
        );

        let surface = gpu::surfaces::render_target(
            &mut context,
            gpu::Budgeted::Yes,
            &image_info,
            None,                       // sample count
            gpu::SurfaceOrigin::TopLeft,
            None,                       // surface props
            false,                      // mipmaps
            false,                      // protected
        )
        .ok_or("failed to create Metal GPU surface")?;

        Ok(Self {
            surface,
            _gpu_context: Some(context),
        })
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

    /// Flush pending GPU commands and submit to the GPU.
    ///
    /// This is a no-op on raster surfaces. On GPU surfaces, it ensures all
    /// queued draw calls are submitted before pixel readback or timing.
    #[cfg(target_os = "macos")]
    pub fn flush_and_submit(&mut self) {
        if let Some(ctx) = self._gpu_context.as_mut() {
            ctx.flush_and_submit();
        }
    }
}
