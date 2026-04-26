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

#[cfg(target_os = "macos")]
fn bench_gpu_paint_frame(c: &mut Criterion) {
    let scene = build_test_scene();
    let mut surface = RenderSurface::new_metal_gpu(1920, 1080)
        .expect("Metal GPU surface required for this benchmark");

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

/// End-to-end: GPU paint + JPEG encode + FFmpeg MJPEG pipe for 30 frames.
/// Uses JPEG to minimize pipe data (50KB/frame vs 8.3MB/frame raw).
#[cfg(target_os = "macos")]
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

/// End-to-end benchmark: GPU paint + raw BGRA + FFmpeg write for 30 frames.
///
/// This measures the complete `render_animated_gpu` pipeline on a realistic
/// 1080p scene so we can track total per-frame cost including encode and I/O.
#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
criterion_group!(
    benches,
    bench_paint_frame,
    bench_gpu_paint_frame,
    bench_e2e_gpu_jpeg_30_frames,
    bench_e2e_gpu_30_frames
);
#[cfg(not(target_os = "macos"))]
criterion_group!(benches, bench_paint_frame);
criterion_main!(benches);
