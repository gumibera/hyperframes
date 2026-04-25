use hyperframes_native_renderer::paint::{paint_element, ImageCache, RenderSurface};
use hyperframes_native_renderer::scene::{
    BackgroundImage, BackgroundImageFit, Element, ElementKind, ObjectFit, ObjectPosition, Rect,
    Style,
};
use skia_safe::{surfaces, Color4f, EncodedImageFormat};
use std::process::Command;

/// Generate a solid-red PNG at the given path using Skia.
fn create_test_png(path: &str, width: i32, height: i32) {
    let mut surface = surfaces::raster_n32_premul((width, height)).expect("surface");
    surface.canvas().clear(Color4f::new(1.0, 0.0, 0.0, 1.0));
    let image = surface.image_snapshot();
    let data = image
        .encode(None, EncodedImageFormat::PNG, 100)
        .expect("encode PNG");
    std::fs::write(path, data.as_bytes()).expect("write test PNG");
}

fn create_test_mp4(path: &str) {
    let status = Command::new("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=blue:s=64x64:d=0.2:r=5",
            "-frames:v",
            "1",
            "-pix_fmt",
            "yuv420p",
            path,
        ])
        .status()
        .expect("run ffmpeg");
    assert!(status.success(), "ffmpeg should create test video");
}

#[test]
fn paint_image_element() {
    let test_png = "/tmp/hyperframes-test-red.png";
    create_test_png(test_png, 100, 100);

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
fn paint_image_object_fit_contain_letterboxes() {
    let test_png = "/tmp/hyperframes-test-wide-red.png";
    create_test_png(test_png, 100, 50);

    let mut surface = RenderSurface::new_raster(100, 100).expect("surface");
    surface.clear(Color4f::new(1.0, 1.0, 1.0, 1.0));

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
        style: Style {
            object_fit: Some(ObjectFit::Contain),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    let center = (50 * 100 + 50) * 4;
    assert!(
        pixels[center] > 200 && pixels[center + 1] < 50,
        "center should be red, got RGB({},{},{})",
        pixels[center],
        pixels[center + 1],
        pixels[center + 2]
    );

    let top_letterbox = (10 * 100 + 50) * 4;
    assert_eq!(
        pixels[top_letterbox], 255,
        "top letterbox should stay white"
    );
    assert_eq!(
        pixels[top_letterbox + 1],
        255,
        "top letterbox should stay white"
    );
    assert_eq!(
        pixels[top_letterbox + 2],
        255,
        "top letterbox should stay white"
    );

    std::fs::remove_file(test_png).ok();
}

#[test]
fn paint_background_image_from_file_url() {
    let test_png = "/tmp/hyperframes-test-bg-red.png";
    create_test_png(test_png, 100, 100);

    let mut surface = RenderSurface::new_raster(100, 100).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "bg".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 100.0,
            height: 100.0,
        },
        style: Style {
            background_image: Some(BackgroundImage {
                src: format!("file://{test_png}"),
                fit: BackgroundImageFit::Cover,
                position: ObjectPosition::default(),
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
        pixels[center] > 200 && pixels[center + 1] < 50,
        "background image should paint red, got RGB({},{},{})",
        pixels[center],
        pixels[center + 1],
        pixels[center + 2]
    );

    std::fs::remove_file(test_png).ok();
}

#[test]
fn paint_video_element_uses_ffmpeg_frame() {
    let test_mp4 = "/tmp/hyperframes-native-video-blue.mp4";
    create_test_mp4(test_mp4);

    let mut surface = RenderSurface::new_raster(64, 64).expect("surface");
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    let el = Element {
        id: "video".into(),
        kind: ElementKind::Video {
            src: test_mp4.to_string(),
        },
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 64.0,
            height: 64.0,
        },
        style: Style {
            object_fit: Some(ObjectFit::Fill),
            ..Style::default()
        },
        children: vec![],
    };

    let mut images = ImageCache::new();
    paint_element(surface.canvas(), &el, &mut images);

    let pixels = surface.read_pixels_rgba().expect("should read pixels");
    let center = (32 * 64 + 32) * 4;
    assert!(
        pixels[center + 2] > 120,
        "video frame should paint blue, got RGB({},{},{})",
        pixels[center],
        pixels[center + 1],
        pixels[center + 2]
    );

    std::fs::remove_file(test_mp4).ok();
}

#[test]
fn image_cache_reuses() {
    let test_png = "/tmp/hyperframes-test-cache.png";
    create_test_png(test_png, 100, 100);

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
