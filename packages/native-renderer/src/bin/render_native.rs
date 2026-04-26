use std::env;
use std::fs;
use std::path::PathBuf;

use hyperframes_native_renderer::pipeline::render_animated_gpu;
use hyperframes_native_renderer::pipeline::{render_animated, render_static, RenderConfig};
use hyperframes_native_renderer::scene::{parse_scene_file, BakedTimeline};

fn usage() -> ! {
    eprintln!(
        "usage: render_native --scene <scene.json> --output <out.mp4> [--timeline <timeline.json>] [--fps 30] [--duration 1] [--quality 80] [--cpu]"
    );
    std::process::exit(2);
}

fn take_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2)
        .find_map(|pair| (pair[0] == name).then(|| pair[1].clone()))
}

fn has_flag(args: &[String], name: &str) -> bool {
    args.iter().any(|arg| arg == name)
}

fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.is_empty() || has_flag(&args, "--help") {
        usage();
    }

    let scene_path = PathBuf::from(take_value(&args, "--scene").unwrap_or_else(|| usage()));
    let output_path = take_value(&args, "--output").unwrap_or_else(|| usage());
    let timeline_path = take_value(&args, "--timeline").map(PathBuf::from);
    let fps: u32 = take_value(&args, "--fps")
        .unwrap_or_else(|| "30".to_string())
        .parse()
        .unwrap_or_else(|_| usage());
    let duration_secs: f64 = take_value(&args, "--duration")
        .unwrap_or_else(|| "1".to_string())
        .parse()
        .unwrap_or_else(|_| usage());
    let quality: u32 = take_value(&args, "--quality")
        .unwrap_or_else(|| "80".to_string())
        .parse()
        .unwrap_or_else(|_| usage());
    let force_cpu = has_flag(&args, "--cpu");

    let scene = parse_scene_file(&scene_path).unwrap_or_else(|err| {
        eprintln!("{err}");
        std::process::exit(1);
    });

    let config = RenderConfig {
        fps,
        duration_secs,
        quality,
        output_path,
    };

    let result = if let Some(path) = timeline_path {
        let timeline_json = fs::read_to_string(&path).unwrap_or_else(|err| {
            eprintln!("failed to read {}: {err}", path.display());
            std::process::exit(1);
        });
        let timeline: BakedTimeline = serde_json::from_str(&timeline_json).unwrap_or_else(|err| {
            eprintln!("invalid timeline JSON: {err}");
            std::process::exit(1);
        });

        if force_cpu {
            render_animated(&scene, &timeline, &config)
        } else {
            render_animated_gpu(&scene, &timeline, &config)
        }
    } else {
        render_static(&scene, &config)
    }
    .unwrap_or_else(|err| {
        eprintln!("{err}");
        std::process::exit(1);
    });

    println!(
        "{{\"frames\":{},\"totalMs\":{},\"avgPaintMs\":{},\"outputPath\":\"{}\"}}",
        result.total_frames, result.total_ms, result.avg_paint_ms, result.output_path
    );
}
