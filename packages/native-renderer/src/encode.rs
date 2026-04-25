/// Hardware-accelerated encoder variants detected at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HwEncoder {
    /// macOS VideoToolbox HEVC encoder.
    VideoToolbox,
    /// NVIDIA NVENC H.264 encoder.
    Nvenc,
    /// VAAPI H.264 encoder (Linux Intel/AMD).
    Vaapi,
    /// CPU-only libx264 fallback.
    Software,
}

#[cfg(not(target_os = "macos"))]
fn ffmpeg_supports_encoder(name: &str) -> bool {
    std::process::Command::new("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .output()
        .ok()
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.contains(name))
        .unwrap_or(false)
}

fn codec_quality(quality: u32) -> u32 {
    if quality <= 51 {
        return quality;
    }

    let percent = quality.min(100) as f64;
    (35.0 - (percent / 100.0 * 23.0)).round() as u32
}

/// Probe the system for the best available hardware encoder.
///
/// On macOS, VideoToolbox is always available via the OS frameworks.
/// On Linux, we check FFmpeg's encoder list for NVENC support, then fall
/// back to VAAPI if `/dev/dri/renderD128` exists.
pub fn detect_hw_encoder() -> HwEncoder {
    #[cfg(target_os = "macos")]
    {
        return HwEncoder::VideoToolbox;
    }

    #[cfg(not(target_os = "macos"))]
    {
        if ffmpeg_supports_encoder("h264_nvenc") {
            return HwEncoder::Nvenc;
        }

        if std::path::Path::new("/dev/dri/renderD128").exists()
            && ffmpeg_supports_encoder("h264_vaapi")
        {
            return HwEncoder::Vaapi;
        }

        HwEncoder::Software
    }
}

/// Build FFmpeg CLI arguments for the given hardware encoder, frame rate,
/// and quality level.
///
/// The returned args include input format flags (`-f image2pipe -vcodec mjpeg`),
/// encoder-specific codec and quality flags, and a compatible pixel format.
/// The caller must append the output path.
pub fn encoder_args(encoder: HwEncoder, fps: u32, quality: u32) -> Vec<String> {
    let codec_q = codec_quality(quality);
    let mut args: Vec<String> = vec![
        "-y".into(),
        "-f".into(),
        "image2pipe".into(),
        "-vcodec".into(),
        "mjpeg".into(),
        "-framerate".into(),
        fps.to_string(),
        "-i".into(),
        "-".into(),
        "-threads".into(),
        "0".into(),
    ];

    match encoder {
        HwEncoder::VideoToolbox => {
            args.extend([
                "-c:v".into(),
                "hevc_videotoolbox".into(),
                "-q:v".into(),
                quality.to_string(),
                "-allow_sw".into(),
                "1".into(),
                "-tag:v".into(),
                "hvc1".into(),
            ]);
        }
        HwEncoder::Nvenc => {
            args.extend([
                "-c:v".into(),
                "h264_nvenc".into(),
                "-preset".into(),
                "p4".into(),
                "-cq".into(),
                codec_q.to_string(),
            ]);
        }
        HwEncoder::Vaapi => {
            args.extend([
                "-vaapi_device".into(),
                "/dev/dri/renderD128".into(),
                "-vf".into(),
                "format=nv12,hwupload".into(),
                "-c:v".into(),
                "h264_vaapi".into(),
                "-qp".into(),
                codec_q.to_string(),
            ]);
        }
        HwEncoder::Software => {
            args.extend([
                "-c:v".into(),
                "libx264".into(),
                "-preset".into(),
                "fast".into(),
                "-crf".into(),
                codec_q.to_string(),
            ]);
        }
    }

    let pix_fmt = match encoder {
        HwEncoder::Vaapi => "vaapi",
        HwEncoder::VideoToolbox | HwEncoder::Nvenc | HwEncoder::Software => "yuv420p",
    };
    args.extend(["-pix_fmt".into(), pix_fmt.into()]);
    args
}
