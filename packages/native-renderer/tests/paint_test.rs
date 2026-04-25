use hyperframes_native_renderer::paint::{paint_element, ImageCache, RenderSurface};
use hyperframes_native_renderer::scene::{Color, Element, ElementKind, Rect, Style, Transform2D};
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
    assert!(
        jpeg.len() > 100,
        "JPEG should be non-trivial, got {} bytes",
        jpeg.len()
    );
    // JPEG magic bytes: 0xFF 0xD8
    assert_eq!(jpeg[0], 0xFF, "JPEG SOI byte 0");
    assert_eq!(jpeg[1], 0xD8, "JPEG SOI byte 1");
}

#[test]
fn encode_png_produces_bytes() {
    let mut surface = RenderSurface::new_raster(64, 64).expect("should create surface");
    surface.clear(Color4f::new(0.0, 1.0, 0.0, 1.0));

    let png = surface.encode_png().expect("should encode PNG");
    assert!(
        png.len() > 100,
        "PNG should be non-trivial, got {} bytes",
        png.len()
    );
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

// ---------------------------------------------------------------------------
// Element painting tests
// ---------------------------------------------------------------------------

#[test]
fn paint_scene_with_background_and_text() {
    let mut surface = RenderSurface::new_raster(200, 100).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let container = Element {
        id: "bg".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 100.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 0,
                g: 0,
                b: 255,
                a: 255,
            }),
            ..Style::default()
        },
        children: vec![Element {
            id: "label".into(),
            kind: ElementKind::Text {
                content: "Hello".into(),
            },
            bounds: Rect {
                x: 10.0,
                y: 10.0,
                width: 180.0,
                height: 30.0,
            },
            style: Style {
                color: Some(Color {
                    r: 255,
                    g: 255,
                    b: 255,
                    a: 255,
                }),
                font_size: Some(24.0),
                ..Style::default()
            },
            children: vec![],
        }],
    };

    paint_element(surface.canvas(), &container, &mut ImageCache::new());

    let jpeg = surface.encode_jpeg(80).expect("should encode JPEG");
    assert!(
        jpeg.len() > 200,
        "JPEG should be non-trivial, got {} bytes",
        jpeg.len()
    );
    assert_eq!(jpeg[0], 0xFF);
    assert_eq!(jpeg[1], 0xD8);
}

#[test]
fn paint_element_with_border_radius_and_opacity() {
    let mut surface = RenderSurface::new_raster(200, 200).expect("surface");
    // White background.
    surface.clear(Color4f::new(1.0, 1.0, 1.0, 1.0));

    let card = Element {
        id: "card".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 20.0,
            y: 20.0,
            width: 160.0,
            height: 160.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 255,
                g: 0,
                b: 0,
                a: 255,
            }),
            border_radius: [12.0; 4],
            opacity: 0.5,
            ..Style::default()
        },
        children: vec![],
    };

    paint_element(surface.canvas(), &card, &mut ImageCache::new());

    let pixels = surface.read_pixels_rgba().expect("should read pixels");

    // Corner pixel (0,0) is outside the rounded rect — should remain white.
    let idx_corner = 0;
    assert_eq!(pixels[idx_corner], 255, "corner R should be white");
    assert_eq!(pixels[idx_corner + 1], 255, "corner G should be white");
    assert_eq!(pixels[idx_corner + 2], 255, "corner B should be white");

    // Center pixel (100, 100) is inside the card. Red at 50% alpha over white
    // means R should be high (close to 255), G ≈ 128, B ≈ 128.
    let idx_center = (100 * 200 + 100) * 4;
    assert!(
        pixels[idx_center] > 200,
        "center R expected > 200, got {}",
        pixels[idx_center]
    );
}

#[test]
fn paint_element_with_transform() {
    let mut surface = RenderSurface::new_raster(200, 200).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "transformed".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 50.0,
            y: 50.0,
            width: 100.0,
            height: 100.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 0,
                g: 255,
                b: 0,
                a: 255,
            }),
            transform: Some(Transform2D {
                translate_x: 0.0,
                translate_y: 0.0,
                scale_x: 2.0,
                scale_y: 2.0,
                rotate_deg: 45.0,
            }),
            ..Style::default()
        },
        children: vec![],
    };

    paint_element(surface.canvas(), &el, &mut ImageCache::new());

    // Hard to assert pixel-perfect results for rotated/scaled content.
    // Verify it produces a valid JPEG without crashing.
    let jpeg = surface.encode_jpeg(80).expect("should encode JPEG");
    assert!(
        jpeg.len() > 200,
        "JPEG should be non-trivial, got {} bytes",
        jpeg.len()
    );
}

#[test]
fn paint_invisible_element_skipped() {
    let mut surface = RenderSurface::new_raster(100, 100).expect("surface");
    // Clear to magenta so we can detect any unwanted painting.
    surface.clear(Color4f::new(1.0, 0.0, 1.0, 1.0));

    let el = Element {
        id: "hidden".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 0,
                g: 255,
                b: 0,
                a: 255,
            }),
            visibility: false,
            ..Style::default()
        },
        children: vec![],
    };

    paint_element(surface.canvas(), &el, &mut ImageCache::new());

    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    // Surface should still be magenta — the invisible element painted nothing.
    assert_eq!(pixels[0], 255, "R should be 255 (magenta)");
    assert_eq!(pixels[1], 0, "G should be 0 (magenta)");
    assert_eq!(pixels[2], 255, "B should be 255 (magenta)");
    assert_eq!(pixels[3], 255, "A should be 255");
}
