use hyperframes_native_renderer::paint::RenderSurface;
use skia_safe::Color4f;

#[test]
fn create_surface_and_clear_red() {
    let mut surface = RenderSurface::new_raster(100, 100).expect("should create surface");
    surface.clear(Color4f::new(1.0, 0.0, 0.0, 1.0));

    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    assert_eq!(pixels.len(), 100 * 100 * 4);

    // First pixel: RGBA = (255, 0, 0, 255)
    assert_eq!(pixels[0], 255, "red channel");
    assert_eq!(pixels[1], 0, "green channel");
    assert_eq!(pixels[2], 0, "blue channel");
    assert_eq!(pixels[3], 255, "alpha channel");
}

#[test]
fn encode_jpeg_produces_bytes() {
    let mut surface = RenderSurface::new_raster(64, 64).expect("should create surface");
    surface.clear(Color4f::new(0.0, 0.0, 1.0, 1.0));

    let jpeg = surface.encode_jpeg(80).expect("should encode JPEG");
    assert!(jpeg.len() > 100, "JPEG should be non-trivial, got {} bytes", jpeg.len());
    // JPEG magic bytes: 0xFF 0xD8
    assert_eq!(jpeg[0], 0xFF, "JPEG SOI byte 0");
    assert_eq!(jpeg[1], 0xD8, "JPEG SOI byte 1");
}

#[test]
fn encode_png_produces_bytes() {
    let mut surface = RenderSurface::new_raster(64, 64).expect("should create surface");
    surface.clear(Color4f::new(0.0, 1.0, 0.0, 1.0));

    let png = surface.encode_png().expect("should encode PNG");
    assert!(png.len() > 100, "PNG should be non-trivial, got {} bytes", png.len());
    // PNG magic bytes: 0x89 0x50 0x4E 0x47
    assert_eq!(png[0], 0x89, "PNG signature byte 0");
    assert_eq!(png[1], 0x50, "PNG signature byte 1");
    assert_eq!(png[2], 0x4E, "PNG signature byte 2");
    assert_eq!(png[3], 0x47, "PNG signature byte 3");
}

#[test]
fn surface_dimensions() {
    let surface = RenderSurface::new_raster(1920, 1080).expect("should create surface");
    assert_eq!(surface.width(), 1920);
    assert_eq!(surface.height(), 1080);
}
