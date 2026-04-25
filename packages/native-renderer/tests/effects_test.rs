use hyperframes_native_renderer::paint::effects;
use hyperframes_native_renderer::paint::elements::paint_element;
use hyperframes_native_renderer::paint::images::ImageCache;
use hyperframes_native_renderer::paint::RenderSurface;
use hyperframes_native_renderer::scene::{
    BoxShadow, Color, Element, ElementKind, FilterAdjust, Gradient, GradientStop, Rect, Style,
};
use skia_safe::Color4f;

// ---------------------------------------------------------------------------
// Box shadow
// ---------------------------------------------------------------------------

#[test]
fn paint_box_shadow_produces_pixels() {
    let mut surface = RenderSurface::new_raster(200, 200).expect("surface");
    surface.clear(Color4f::new(1.0, 1.0, 1.0, 1.0));

    let el = Element {
        id: "card".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 40.0,
            y: 40.0,
            width: 120.0,
            height: 120.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 0,
                g: 0,
                b: 255,
                a: 255,
            }),
            box_shadow: Some(BoxShadow {
                offset_x: 4.0,
                offset_y: 4.0,
                blur_radius: 10.0,
                spread_radius: 2.0,
                color: Color {
                    r: 0,
                    g: 0,
                    b: 0,
                    a: 180,
                },
            }),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");

    // Check a pixel that is outside the element bounds but within the shadow
    // spread+blur area. At (165, 165) the element ends at 160,160 but the
    // shadow extends further via offset + spread + blur.
    let idx = (165 * 200 + 165) * 4;
    let is_not_white = pixels[idx] < 250 || pixels[idx + 1] < 250 || pixels[idx + 2] < 250;
    assert!(
        is_not_white,
        "pixel at (165,165) should be affected by shadow, got RGB({},{},{})",
        pixels[idx],
        pixels[idx + 1],
        pixels[idx + 2]
    );
}

// ---------------------------------------------------------------------------
// Blur filter
// ---------------------------------------------------------------------------

#[test]
fn paint_blur_filter() {
    let mut surface = RenderSurface::new_raster(200, 200).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "blurred".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 50.0,
            y: 50.0,
            width: 100.0,
            height: 100.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 255,
                g: 0,
                b: 0,
                a: 255,
            }),
            filter_blur: Some(8.0),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    // The blur should cause red color to bleed outside the element bounds.
    // Check a pixel just outside the element at (45, 100) — the element
    // starts at x=50, so (45, 100) is 5px to the left.
    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    let idx = (100 * 200 + 45) * 4;
    assert!(
        pixels[idx] > 10,
        "pixel at (45,100) should have red bleed from blur, got R={}",
        pixels[idx]
    );

    // Verify the JPEG encodes without errors.
    let jpeg = surface.encode_jpeg(80).expect("should encode JPEG");
    assert!(jpeg.len() > 200);
}

#[test]
fn paint_filter_adjust_brightness() {
    let mut surface = RenderSurface::new_raster(100, 100).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "bright".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 10.0,
            y: 10.0,
            width: 80.0,
            height: 80.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 80,
                g: 80,
                b: 80,
                a: 255,
            }),
            filter_adjust: Some(FilterAdjust {
                brightness: 2.0,
                contrast: 1.0,
                saturate: 1.0,
            }),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    let center = (50 * 100 + 50) * 4;
    assert!(
        pixels[center] > 120,
        "brightness filter should increase center R, got {}",
        pixels[center]
    );
}

// ---------------------------------------------------------------------------
// Linear gradient
// ---------------------------------------------------------------------------

#[test]
fn paint_linear_gradient() {
    let mut surface = RenderSurface::new_raster(200, 100).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "gradient".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 100.0,
        },
        style: Style {
            background_gradient: Some(Gradient::Linear {
                angle_deg: 90.0,
                stops: vec![
                    GradientStop {
                        position: 0.0,
                        color: Color {
                            r: 255,
                            g: 0,
                            b: 0,
                            a: 255,
                        },
                    },
                    GradientStop {
                        position: 1.0,
                        color: Color {
                            r: 0,
                            g: 0,
                            b: 255,
                            a: 255,
                        },
                    },
                ],
            }),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");

    // Left edge (x=5, y=50): should be reddish.
    let left = (50 * 200 + 5) * 4;
    assert!(
        pixels[left] > pixels[left + 2],
        "left edge R ({}) should dominate B ({})",
        pixels[left],
        pixels[left + 2]
    );

    // Right edge (x=195, y=50): should be bluish.
    let right = (50 * 200 + 195) * 4;
    assert!(
        pixels[right + 2] > pixels[right],
        "right edge B ({}) should dominate R ({})",
        pixels[right + 2],
        pixels[right]
    );
}

// ---------------------------------------------------------------------------
// Radial gradient
// ---------------------------------------------------------------------------

#[test]
fn paint_radial_gradient() {
    let mut surface = RenderSurface::new_raster(200, 200).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "radial".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 200.0,
            height: 200.0,
        },
        style: Style {
            background_gradient: Some(Gradient::Radial {
                stops: vec![
                    GradientStop {
                        position: 0.0,
                        color: Color {
                            r: 255,
                            g: 255,
                            b: 0,
                            a: 255,
                        },
                    },
                    GradientStop {
                        position: 1.0,
                        color: Color {
                            r: 0,
                            g: 0,
                            b: 128,
                            a: 255,
                        },
                    },
                ],
            }),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");

    // Center pixel (100, 100): should be yellow-ish (high R, high G).
    let center = (100 * 200 + 100) * 4;
    assert!(
        pixels[center] > 200 && pixels[center + 1] > 200,
        "center should be yellow-ish, got RGB({},{},{})",
        pixels[center],
        pixels[center + 1],
        pixels[center + 2]
    );

    // Edge pixel (0, 0): should be dark blue-ish (low R, low G, some B).
    let edge = 0;
    assert!(
        pixels[edge + 2] > pixels[edge],
        "edge B ({}) should dominate R ({})",
        pixels[edge + 2],
        pixels[edge]
    );
}

// ---------------------------------------------------------------------------
// Unit tests for effects module functions
// ---------------------------------------------------------------------------

#[test]
fn create_blur_image_filter_zero_returns_none() {
    assert!(effects::create_blur_image_filter(0.0).is_none());
    assert!(effects::create_blur_image_filter(-1.0).is_none());
}

#[test]
fn create_blur_image_filter_positive_returns_some() {
    assert!(effects::create_blur_image_filter(4.0).is_some());
}

#[test]
fn create_gradient_shader_too_few_stops_returns_none() {
    let rect = skia_safe::Rect::from_xywh(0.0, 0.0, 100.0, 100.0);
    let gradient = Gradient::Linear {
        angle_deg: 0.0,
        stops: vec![GradientStop {
            position: 0.0,
            color: Color {
                r: 255,
                g: 0,
                b: 0,
                a: 255,
            },
        }],
    };
    assert!(effects::create_gradient_shader(&rect, &gradient).is_none());
}
