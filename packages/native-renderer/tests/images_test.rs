use hyperframes_native_renderer::paint::{paint_element, ImageCache, RenderSurface};
use hyperframes_native_renderer::scene::{Element, ElementKind, Rect, Style};
use skia_safe::{surfaces, Color4f, EncodedImageFormat};

/// Generate a solid-red 100x100 PNG at the given path using Skia.
fn create_test_png(path: &str) {
    let mut surface = surfaces::raster_n32_premul((100, 100)).expect("surface");
    surface.canvas().clear(Color4f::new(1.0, 0.0, 0.0, 1.0));
    let image = surface.image_snapshot();
    let data = image
        .encode(None, EncodedImageFormat::PNG, 100)
        .expect("encode PNG");
    std::fs::write(path, data.as_bytes()).expect("write test PNG");
}

#[test]
fn paint_image_element() {
    let test_png = "/tmp/hyperframes-test-red.png";
    create_test_png(test_png);

    let mut surface = RenderSurface::new_raster(100, 100).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "img".into(),
        kind: ElementKind::Image {
            src: test_png.to_string(),
        },
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        },
        style: Style::default(),
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    // The center pixel should be red from the loaded image.
    let idx = (50 * 100 + 50) * 4;
    assert!(
        pixels[idx] > 200,
        "center R expected > 200, got {}",
        pixels[idx]
    );
    assert!(
        pixels[idx + 1] < 50,
        "center G expected < 50, got {}",
        pixels[idx + 1]
    );
    assert!(
        pixels[idx + 2] < 50,
        "center B expected < 50, got {}",
        pixels[idx + 2]
    );

    std::fs::remove_file(test_png).ok();
}

#[test]
fn image_cache_reuses() {
    let test_png = "/tmp/hyperframes-test-cache.png";
    create_test_png(test_png);

    let mut cache = ImageCache::new();

    assert!(cache.get_or_load(test_png).is_some());
    assert_eq!(cache.len(), 1);

    // Second load should reuse the cached entry.
    assert!(cache.get_or_load(test_png).is_some());
    assert_eq!(cache.len(), 1, "cache should still have exactly 1 entry");

    std::fs::remove_file(test_png).ok();
}

#[test]
fn image_cache_missing_file_returns_none() {
    let mut cache = ImageCache::new();
    assert!(cache
        .get_or_load("/tmp/nonexistent-hyperframes-image.png")
        .is_none());
    assert_eq!(cache.len(), 0);
}
