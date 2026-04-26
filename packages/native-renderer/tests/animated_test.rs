use std::collections::HashMap;
use std::path::Path;

use hyperframes_native_renderer::pipeline::render_animated_gpu;
use hyperframes_native_renderer::pipeline::{render_animated, RenderConfig};
use hyperframes_native_renderer::scene::{
    BakedElementState, BakedFrame, BakedTimeline, Color, Element, ElementKind, Rect, Scene, Style,
};

/// Build a minimal scene: full-screen background + a title text element.
fn make_animated_scene() -> Scene {
    let title = Element {
        id: "title".into(),
        kind: ElementKind::Text {
            content: "Animated Title".into(),
        },
        bounds: Rect {
            x: 100.0,
            y: 120.0,
            width: 440.0,
            height: 60.0,
        },
        style: Style {
            color: Some(Color {
                r: 255,
                g: 255,
                b: 255,
                a: 255,
            }),
            font_size: Some(36.0),
            ..Style::default()
        },
        children: vec![],
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
                r: 10,
                g: 10,
                b: 30,
                a: 255,
            }),
            ..Style::default()
        },
        children: vec![title],
    };

    Scene {
        width: 640,
        height: 360,
        elements: vec![background],
        fonts: vec![],
    }
}

/// Build a 30-frame (1s @ 30fps) timeline where the title fades in and
/// slides up from y+50 to y+0.
fn make_fade_in_timeline() -> BakedTimeline {
    let frames = (0..30)
        .map(|i| {
            let progress = i as f32 / 29.0;
            BakedFrame {
                frame_index: i,
                time: i as f64 / 30.0,
                elements: HashMap::from([(
                    "title".to_string(),
                    BakedElementState {
                        opacity: progress,
                        translate_x: 0.0,
                        translate_y: 50.0 * (1.0 - progress),
                        scale_x: 1.0,
                        scale_y: 1.0,
                        rotate_deg: 0.0,
                        visibility: true,
                    },
                )]),
            }
        })
        .collect();

    BakedTimeline {
        fps: 30,
        duration: 1.0,
        total_frames: 30,
        frames,
    }
}

#[test]
fn render_animated_scene_to_mp4() {
    let scene = make_animated_scene();
    let timeline = make_fade_in_timeline();
    let output_path = "/tmp/hyperframes-animated-test.mp4";

    let config = RenderConfig {
        fps: 30,
        duration_secs: 1.0,
        quality: 80,
        output_path: output_path.to_string(),
    };

    let result = render_animated(&scene, &timeline, &config).unwrap();

    assert_eq!(result.total_frames, 30);
    assert!(result.avg_paint_ms > 0.0);
    assert_eq!(result.output_path, output_path);

    let path = Path::new(output_path);
    assert!(path.exists(), "output MP4 must exist");

    let size = std::fs::metadata(output_path).unwrap().len();
    assert!(size > 1000, "MP4 should be non-trivial, got {size} bytes");

    std::fs::remove_file(output_path).ok();
}

#[test]
fn render_animated_gpu_scene_to_mp4() {
    let scene = make_animated_scene();
    let timeline = make_fade_in_timeline();
    let output_path = "/tmp/hyperframes-animated-gpu-test.mp4";

    let config = RenderConfig {
        fps: 30,
        duration_secs: 1.0,
        quality: 80,
        output_path: output_path.to_string(),
    };

    let result = render_animated_gpu(&scene, &timeline, &config).unwrap();

    assert_eq!(result.total_frames, 30);
    assert!(result.avg_paint_ms > 0.0);
    assert_eq!(result.output_path, output_path);

    let size = std::fs::metadata(output_path).unwrap().len();
    assert!(size > 1000, "MP4 should be non-trivial, got {size} bytes");

    std::fs::remove_file(output_path).ok();
}

#[test]
fn render_animated_zero_frames_errors() {
    let scene = make_animated_scene();
    let timeline = BakedTimeline {
        fps: 30,
        duration: 0.0,
        total_frames: 0,
        frames: vec![],
    };

    let config = RenderConfig {
        fps: 30,
        duration_secs: 0.0,
        quality: 80,
        output_path: "/tmp/hyperframes-animated-zero.mp4".to_string(),
    };

    let result = render_animated(&scene, &timeline, &config);
    assert!(result.is_err());
}
