use std::collections::HashMap;

use criterion::{criterion_group, criterion_main, Criterion};
use hyperframes_native_renderer::paint::elements::paint_element;
use hyperframes_native_renderer::paint::{ImageCache, RenderSurface};
use hyperframes_native_renderer::scene::{
    BakedElementState, BakedFrame, BakedTimeline, Color, Element, ElementKind, Rect, Scene, Style,
};
use skia_safe::Color4f;

/// Build a realistic 1080p scene: dark background root with 20 overlapping
/// card-style containers, each containing a text child. This approximates
/// a typical composition slide with layered UI elements.
fn build_test_scene() -> Scene {
    let mut children = Vec::with_capacity(20);

    for i in 0..20u8 {
        let fi = i as f32;
        children.push(Element {
            id: format!("card-{i}"),
            kind: ElementKind::Container,
            bounds: Rect {
                x: 50.0 + fi * 10.0,
                y: 50.0 + fi * 15.0,
                width: 400.0,
                height: 200.0,
            },
            style: Style {
                background_color: Some(Color {
                    r: i.wrapping_mul(12),
                    g: 100,
                    b: 200,
                    a: 220,
                }),
                opacity: 0.8,
                border_radius: [12.0; 4],
                overflow_hidden: true,
                visibility: true,
                ..Default::default()
            },
            children: vec![Element {
                id: format!("text-{i}"),
                kind: ElementKind::Text {
                    content: format!("Card {i} — Hello World"),
                },
                bounds: Rect {
                    x: 20.0,
                    y: 20.0,
                    width: 360.0,
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
                    opacity: 1.0,
                    visibility: true,
                    ..Default::default()
                },
                children: vec![],
            }],
        });
    }

    Scene {
        width: 1920,
        height: 1080,
        fonts: vec![],
        elements: vec![Element {
            id: "root".into(),
            kind: ElementKind::Container,
            bounds: Rect {
                x: 0.0,
                y: 0.0,
                width: 1920.0,
                height: 1080.0,
            },
            style: Style {
                background_color: Some(Color {
                    r: 15,
                    g: 15,
                    b: 30,
                    a: 255,
                }),
                opacity: 1.0,
                visibility: true,
                ..Default::default()
            },
            children,
        }],
    }
}

fn bench_paint_frame(c: &mut Criterion) {
    let scene = build_test_scene();
    let mut surface = RenderSurface::new_raster(1920, 1080).unwrap();

    c.bench_function("paint_1080p_20_elements", |b| {
        let mut images = ImageCache::new();
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element, &mut images);
            }
        });
    });

    c.bench_function("paint_and_encode_jpeg_1080p", |b| {
        let mut images = ImageCache::new();
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element, &mut images);
            }
            let _jpeg = surface.encode_jpeg(80).unwrap();
        });
    });
}

fn bench_gpu_paint_frame(c: &mut Criterion) {
    let scene = build_test_scene();
    let mut surface = RenderSurface::new_gpu_or_raster(1920, 1080)
        .expect("GPU or raster surface required for this benchmark");

    c.bench_function("gpu_paint_1080p_20_elements", |b| {
        let mut images = ImageCache::new();
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element, &mut images);
            }
            surface.flush_and_submit();
        });
    });

    c.bench_function("gpu_paint_and_readback_rgba_1080p", |b| {
        let mut images = ImageCache::new();
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element, &mut images);
            }
            surface.flush_and_submit();
            let _pixels = surface.read_pixels_rgba();
        });
    });

    c.bench_function("gpu_paint_and_readback_bgra_1080p", |b| {
        let mut images = ImageCache::new();
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element, &mut images);
            }
            surface.flush_and_submit();
            let _pixels = surface.read_pixels_bgra();
        });
    });
}

/// Build a 30-frame timeline that slides all 20 cards upward with a fade-in.
/// Animates every card to stress the delta-apply + paint path realistically.
fn build_30_frame_timeline() -> BakedTimeline {
    let frames = (0..30)
        .map(|i| {
            let progress = i as f32 / 29.0;
            let mut elements = HashMap::new();
            for c in 0..20u8 {
                elements.insert(
                    format!("card-{c}"),
                    BakedElementState {
                        opacity: progress,
                        translate_x: 0.0,
                        translate_y: 40.0 * (1.0 - progress),
                        scale_x: 1.0,
                        scale_y: 1.0,
                        rotate_deg: 0.0,
                        visibility: true,
                    },
                );
            }
            BakedFrame {
                frame_index: i,
                time: i as f64 / 30.0,
                elements,
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

/// RENDER-ONLY: CPU paint + BGRA readback into pre-allocated buffer.
/// No I420 conversion, no encoding. Pure rendering throughput.
fn bench_render_only_30_frames(c: &mut Criterion) {
    use hyperframes_native_renderer::paint::{ImageCache, RenderSurface};
    use hyperframes_native_renderer::paint::elements::paint_element;

    let scene = build_test_scene();
    let timeline = build_30_frame_timeline();
    let mut surface = RenderSurface::new_raster(1920, 1080).unwrap();
    let mut bgra_buf = vec![0u8; 1920 * 1080 * 4];

    c.bench_function("render_only_30_frames_1080p", |b| {
        let mut images = ImageCache::new();
        b.iter(|| {
            for _frame in &timeline.frames {
                surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
                for element in &scene.elements {
                    paint_element(surface.canvas(), element, &mut images);
                }
                surface.read_pixels_bgra_into(&mut bgra_buf).unwrap();
            }
        });
    });
}

/// End-to-end RAW+ENCODE: fast render to I420 file, then FFmpeg batch.
fn bench_e2e_raw_encode_30_frames(c: &mut Criterion) {
    use hyperframes_native_renderer::pipeline::{render_animated_raw_then_encode, RenderConfig};

    let scene = build_test_scene();
    let timeline = build_30_frame_timeline();

    c.bench_function("e2e_raw_encode_30_frames_1080p", |b| {
        b.iter(|| {
            let config = RenderConfig {
                fps: 30,
                duration_secs: 1.0,
                quality: 80,
                output_path: "/tmp/hyperframes-bench-raw.mp4".to_string(),
            };
            let result = render_animated_raw_then_encode(&scene, &timeline, &config)
                .expect("render_animated_raw_then_encode must succeed");
            assert_eq!(result.total_frames, 30);
        });
    });
}

/// End-to-end NATIVE: CPU raster + openh264 + minimp4, NO FFmpeg.
fn bench_e2e_native_30_frames(c: &mut Criterion) {
    use hyperframes_native_renderer::pipeline::{render_animated_native, RenderConfig};

    let scene = build_test_scene();
    let timeline = build_30_frame_timeline();

    c.bench_function("e2e_native_30_frames_1080p", |b| {
        b.iter(|| {
            let config = RenderConfig {
                fps: 30,
                duration_secs: 1.0,
                quality: 80,
                output_path: "/tmp/hyperframes-bench-native.mp4".to_string(),
            };
            let result = render_animated_native(&scene, &timeline, &config)
                .expect("render_animated_native must succeed");
            assert_eq!(result.total_frames, 30);
        });
    });
}

/// End-to-end: CPU raster + JPEG encode + FFmpeg MJPEG pipe for 30 frames.
fn bench_e2e_gpu_jpeg_30_frames(c: &mut Criterion) {
    use hyperframes_native_renderer::pipeline::{render_animated, RenderConfig};

    let scene = build_test_scene();
    let timeline = build_30_frame_timeline();

    c.bench_function("e2e_gpu_jpeg_30_frames_1080p", |b| {
        b.iter(|| {
            let config = RenderConfig {
                fps: 30,
                duration_secs: 1.0,
                quality: 60,
                output_path: "/tmp/hyperframes-bench-e2e-jpeg.mp4".to_string(),
            };
            let result = render_animated(&scene, &timeline, &config)
                .expect("render_animated must succeed");
            assert_eq!(result.total_frames, 30);
        });
    });
}

/// End-to-end benchmark: GPU paint + raw pixel pipe + FFmpeg hw encode for 30 frames.
fn bench_e2e_gpu_30_frames(c: &mut Criterion) {
    use hyperframes_native_renderer::pipeline::{render_animated_gpu, RenderConfig};

    let scene = build_test_scene();
    let timeline = build_30_frame_timeline();

    c.bench_function("e2e_gpu_30_frames_1080p", |b| {
        b.iter(|| {
            let config = RenderConfig {
                fps: 30,
                duration_secs: 1.0,
                quality: 80,
                output_path: "/tmp/hyperframes-bench-e2e.mp4".to_string(),
            };
            let result = render_animated_gpu(&scene, &timeline, &config)
                .expect("render_animated_gpu must succeed");
            assert_eq!(result.total_frames, 30);
        });
    });
}

criterion_group!(
    benches,
    bench_paint_frame,
    bench_gpu_paint_frame,
    bench_render_only_30_frames,
    bench_e2e_raw_encode_30_frames,
    bench_e2e_native_30_frames,
    bench_e2e_gpu_jpeg_30_frames,
    bench_e2e_gpu_30_frames
);
#[cfg(any())] // dead code — kept for reference
criterion_group!(benches, bench_paint_frame);
criterion_main!(benches);
