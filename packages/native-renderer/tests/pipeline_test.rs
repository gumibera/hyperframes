use std::path::Path;

use hyperframes_native_renderer::pipeline::{render_static, RenderConfig};
use hyperframes_native_renderer::scene::{Color, Element, ElementKind, Rect, Scene, Style};

/// Build a realistic scene: dark-blue background, white rounded card, text inside the card.
fn make_test_scene() -> Scene {
    let text = Element {
        id: "heading".into(),
        kind: ElementKind::Text {
            content: "Hello from Skia!".into(),
        },
        bounds: Rect {
            x: 24.0,
            y: 20.0,
            width: 280.0,
            height: 40.0,
        },
        style: Style {
            color: Some(Color {
                r: 30,
                g: 30,
                b: 50,
                a: 255,
            }),
            font_size: Some(28.0),
            ..Style::default()
        },
        children: vec![],
    };

    let card = Element {
        id: "card".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 140.0,
            y: 80.0,
            width: 360.0,
            height: 200.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 255,
                g: 255,
                b: 255,
                a: 255,
            }),
            border_radius: [16.0; 4],
            overflow_hidden: true,
            ..Style::default()
        },
        children: vec![text],
    };

    let background = Element {
        id: "bg".into(),
        kind: ElementKind::Container,
        bounds: Rect {
            x: 0.0,
            y: 0.0,
            width: 640.0,
            height: 360.0,
        },
        style: Style {
            background_color: Some(Color {
                r: 15,
                g: 23,
                b: 42,
                a: 255,
            }),
            ..Style::default()
        },
        children: vec![card],
    };

    Scene {
        width: 640,
        height: 360,
        elements: vec![background],
        fonts: vec![],
    }
}

#[test]
fn render_static_scene_to_mp4() {
    let scene = make_test_scene();
    let output_path = "/tmp/hyperframes-native-test.mp4";

    let config = RenderConfig {
        fps: 30,
        duration_secs: 1.0,
        quality: 80,
        output_path: output_path.to_string(),
    };

    let result = render_static(&scene, &config).unwrap();

    assert_eq!(result.total_frames, 30);
    assert_eq!(result.output_path, output_path);

    let path = Path::new(output_path);
    assert!(path.exists(), "output MP4 must exist");

    let size = std::fs::metadata(output_path).unwrap().len();
    assert!(size > 1000, "MP4 should be non-trivial, got {size} bytes");

    std::fs::remove_file(output_path).ok();
}

#[test]
fn render_static_fractional_duration() {
    let scene = make_test_scene();
    let output_path = "/tmp/hyperframes-native-frac.mp4";

    let config = RenderConfig {
        fps: 24,
        duration_secs: 0.5,
        quality: 70,
        output_path: output_path.to_string(),
    };

    let result = render_static(&scene, &config).unwrap();

    // ceil(24 * 0.5) = 12
    assert_eq!(result.total_frames, 12);
    assert!(Path::new(output_path).exists());

    std::fs::remove_file(output_path).ok();
}
