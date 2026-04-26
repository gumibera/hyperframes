use skia_safe::{
    images, surfaces, AlphaType, Canvas, Color4f, ColorType, Data, EncodedImageFormat, ImageInfo,
    Surface,
};

#[cfg(any(feature = "metal-gpu", feature = "vulkan-gpu"))]
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
    #[cfg(any(feature = "metal-gpu", feature = "vulkan-gpu"))]
    _gpu_context: Option<gpu::DirectContext>,
}

impl RenderSurface {
    /// Create a CPU-backed raster surface with premultiplied N32 color type.
    pub fn new_raster(width: i32, height: i32) -> Result<Self, String> {
        let surface = surfaces::raster_n32_premul((width, height))
            .ok_or_else(|| format!("failed to create {width}x{height} raster surface"))?;
        Ok(Self {
            surface,
            #[cfg(any(feature = "metal-gpu", feature = "vulkan-gpu"))]
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
    #[cfg(feature = "metal-gpu")]
    pub fn new_metal_gpu(width: i32, height: i32) -> Result<Self, String> {
        use metal::foreign_types::ForeignType;

        let device = metal::Device::system_default().ok_or("no Metal GPU device found")?;
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
            None, // sample count
            gpu::SurfaceOrigin::TopLeft,
            None,  // surface props
            false, // mipmaps
            false, // protected
        )
        .ok_or("failed to create Metal GPU surface")?;

        Ok(Self {
            surface,
            _gpu_context: Some(context),
        })
    }

    /// Create a Vulkan GPU-accelerated surface (Linux with NVIDIA/AMD/Intel).
    ///
    /// Vulkan initialization requires a live GPU with a Vulkan ICD installed.
    /// Returns Err if Vulkan is unavailable (Docker without GPU, CI, etc.)
    /// — the caller should fall back to CPU raster via `new_gpu_or_raster`.
    ///
    /// Full Vulkan setup (instance → physical device → logical device → queue)
    /// will be implemented when we validate on an NVIDIA GPU instance.
    /// For now, this returns Err to trigger the raster fallback.
    #[cfg(feature = "vulkan-gpu")]
    pub fn new_vulkan_gpu(_width: i32, _height: i32) -> Result<Self, String> {
        // TODO: Vulkan instance + device creation for production GPU path.
        // Requires: VkInstance, VkPhysicalDevice, VkDevice, VkQueue, GetProc.
        // Placeholder returns Err so new_gpu_or_raster falls back to raster.
        Err("Vulkan GPU surface not yet implemented — use raster fallback".into())
    }

    /// Create the best available GPU surface for the current platform.
    /// Falls back to CPU raster if no GPU is available.
    pub fn new_gpu_or_raster(width: i32, height: i32) -> Result<Self, String> {
        // Try GPU first, fall back to raster.
        #[cfg(feature = "metal-gpu")]
        {
            match Self::new_metal_gpu(width, height) {
                Ok(s) => return Ok(s),
                Err(e) => eprintln!("[native-renderer] Metal GPU unavailable ({e}), falling back to raster"),
            }
        }
        #[cfg(feature = "vulkan-gpu")]
        {
            match Self::new_vulkan_gpu(width, height) {
                Ok(s) => return Ok(s),
                Err(e) => eprintln!("[native-renderer] Vulkan GPU unavailable ({e}), falling back to raster"),
            }
        }
        Self::new_raster(width, height)
    }

    /// Get the Skia canvas for drawing operations.
    pub fn canvas(&mut self) -> &Canvas {
        self.surface.canvas()
    }

    /// Read back the rendered pixels as RGBA8888 bytes.
    ///
    /// Returns `None` if the readback fails (e.g. zero-sized surface).
    pub fn read_pixels_rgba(&mut self) -> Option<Vec<u8>> {
        self.read_pixels_with_color_type(ColorType::RGBA8888)
    }

    /// Read back pixels in BGRA8888 — the native format for Metal surfaces.
    /// Avoids the BGRA→RGBA conversion that `read_pixels_rgba` incurs on GPU
    /// surfaces, saving ~0.5ms per frame at 1080p.
    pub fn read_pixels_bgra(&mut self) -> Option<Vec<u8>> {
        self.read_pixels_with_color_type(ColorType::BGRA8888)
    }

    /// Read BGRA pixels into a pre-allocated buffer. Avoids per-frame allocation.
    pub fn read_pixels_bgra_into(&mut self, dst: &mut [u8]) -> Option<()> {
        let width = self.surface.width();
        let height = self.surface.height();
        let row_bytes = width as usize * 4;
        let expected = row_bytes * height as usize;
        if dst.len() < expected {
            return None;
        }
        let info = ImageInfo::new((width, height), ColorType::BGRA8888, AlphaType::Premul, None);
        if self.surface.read_pixels(&info, dst, row_bytes, (0, 0)) {
            Some(())
        } else {
            None
        }
    }

    fn read_pixels_with_color_type(&mut self, color_type: ColorType) -> Option<Vec<u8>> {
        let width = self.surface.width();
        let height = self.surface.height();
        let row_bytes = width as usize * 4;
        let mut dst = vec![0u8; row_bytes * height as usize];

        let info = ImageInfo::new((width, height), color_type, AlphaType::Premul, None);

        let ok = self.surface.read_pixels(&info, &mut dst, row_bytes, (0, 0));
        if ok { Some(dst) } else { None }
    }

    /// Encode the surface contents as JPEG bytes at the given quality (1-100).
    pub fn encode_jpeg(&mut self, quality: u32) -> Option<Vec<u8>> {
        self.encode_image(EncodedImageFormat::JPEG, quality)
    }

    /// Encode the surface contents as PNG bytes.
    pub fn encode_png(&mut self) -> Option<Vec<u8>> {
        self.encode_image(EncodedImageFormat::PNG, 100)
    }

    fn encode_image(&mut self, format: EncodedImageFormat, quality: u32) -> Option<Vec<u8>> {
        self.flush_and_submit();

        let image = self.surface.image_snapshot();
        if let Some(data) = image.encode(None, format, quality) {
            return Some(data.as_bytes().to_vec());
        }

        let width = self.surface.width();
        let height = self.surface.height();
        let row_bytes = width as usize * 4;
        let pixels = self.read_pixels_rgba()?;
        let info = ImageInfo::new(
            (width, height),
            ColorType::RGBA8888,
            AlphaType::Premul,
            None,
        );
        let image = images::raster_from_data(&info, Data::new_copy(&pixels), row_bytes)?;
        let data = image.encode(None, format, quality)?;
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
    pub fn flush_and_submit(&mut self) {
        #[cfg(any(feature = "metal-gpu", feature = "vulkan-gpu"))]
        if let Some(ctx) = self._gpu_context.as_mut() {
            ctx.flush_and_submit();
        }
    }

    pub fn is_gpu(&self) -> bool {
        #[cfg(any(feature = "metal-gpu", feature = "vulkan-gpu"))]
        { self._gpu_context.is_some() }
        #[cfg(not(any(feature = "metal-gpu", feature = "vulkan-gpu")))]
        { false }
    }
}
