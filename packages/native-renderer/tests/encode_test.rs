use hyperframes_native_renderer::encode::{
    detect_hw_encoder, encoder_args, raw_rgba_encoder_args, HwEncoder,
};

fn arg_after(args: &[String], flag: &str) -> String {
    let index = args
        .iter()
        .position(|arg| arg == flag)
        .unwrap_or_else(|| panic!("missing flag {flag} in {args:?}"));
    args.get(index + 1)
        .unwrap_or_else(|| panic!("missing value after {flag} in {args:?}"))
        .clone()
}

#[test]
fn detect_hw_encoder_returns_valid() {
    let encoder = detect_hw_encoder();
    // Must be one of the known variants — mainly checking it doesn't panic.
    assert!(matches!(
        encoder,
        HwEncoder::VideoToolbox | HwEncoder::Nvenc | HwEncoder::Vaapi | HwEncoder::Software
    ));
}

#[test]
fn encoder_args_software_contains_libx264() {
    let args = encoder_args(HwEncoder::Software, 30, 18);

    assert!(args.contains(&"-c:v".to_string()));
    assert!(args.contains(&"libx264".to_string()));
    assert!(args.contains(&"-crf".to_string()));
    assert!(args.contains(&"18".to_string()));
    assert!(args.contains(&"-pix_fmt".to_string()));
    assert!(args.contains(&"yuv420p".to_string()));
    // Input format flags
    assert!(args.contains(&"image2pipe".to_string()));
    assert!(args.contains(&"mjpeg".to_string()));
    assert!(args.contains(&"30".to_string())); // framerate
}

#[test]
fn encoder_args_software_maps_jpeg_quality_to_valid_crf() {
    let args = encoder_args(HwEncoder::Software, 30, 80);
    let crf = arg_after(&args, "-crf");

    assert_ne!(crf, "80", "JPEG quality must not be passed through as CRF");
    assert!(
        crf.parse::<u32>().unwrap() <= 51,
        "libx264 CRF must stay within FFmpeg's valid 0..51 range"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn encoder_args_videotoolbox_contains_hevc() {
    let args = encoder_args(HwEncoder::VideoToolbox, 30, 65);

    assert!(args.contains(&"-c:v".to_string()));
    assert!(args.contains(&"hevc_videotoolbox".to_string()));
    assert!(args.contains(&"-allow_sw".to_string()));
    assert!(args.contains(&"1".to_string()));
    assert!(args.contains(&"-tag:v".to_string()));
    assert!(args.contains(&"hvc1".to_string()));
    assert!(args.contains(&"-q:v".to_string()));
    assert!(args.contains(&"65".to_string()));
}

#[test]
fn encoder_args_nvenc_contains_nvenc() {
    let args = encoder_args(HwEncoder::Nvenc, 60, 23);

    assert!(args.contains(&"-c:v".to_string()));
    assert!(args.contains(&"h264_nvenc".to_string()));
    assert!(args.contains(&"-preset".to_string()));
    assert!(args.contains(&"p4".to_string()));
    assert!(args.contains(&"-cq".to_string()));
    assert!(args.contains(&"23".to_string()));
}

#[test]
fn encoder_args_vaapi_contains_vaapi() {
    let args = encoder_args(HwEncoder::Vaapi, 24, 28);

    assert!(args.contains(&"-c:v".to_string()));
    assert!(args.contains(&"h264_vaapi".to_string()));
    assert!(args.contains(&"-vaapi_device".to_string()));
    assert!(args.contains(&"/dev/dri/renderD128".to_string()));
    assert!(args.contains(&"-qp".to_string()));
    assert!(args.contains(&"28".to_string()));
}

#[test]
fn encoder_args_vaapi_uploads_software_frames_to_gpu() {
    let args = encoder_args(HwEncoder::Vaapi, 24, 80);

    assert_eq!(arg_after(&args, "-vf"), "format=nv12,hwupload");
    assert_eq!(arg_after(&args, "-pix_fmt"), "vaapi");
}

#[cfg(target_os = "macos")]
#[test]
fn detect_returns_videotoolbox_on_macos() {
    // On macOS, VideoToolbox is always the detected encoder.
    assert_eq!(detect_hw_encoder(), HwEncoder::VideoToolbox);
}

#[test]
fn encoder_args_all_start_with_overwrite_flag() {
    for encoder in [
        HwEncoder::Software,
        HwEncoder::Nvenc,
        HwEncoder::Vaapi,
        HwEncoder::VideoToolbox,
    ] {
        let args = encoder_args(encoder, 30, 20);
        assert_eq!(args[0], "-y", "first arg must be -y for {encoder:?}");
    }
}

#[test]
fn encoder_args_all_end_with_pix_fmt() {
    for encoder in [
        HwEncoder::Software,
        HwEncoder::Nvenc,
        HwEncoder::Vaapi,
        HwEncoder::VideoToolbox,
    ] {
        let args = encoder_args(encoder, 30, 20);
        let len = args.len();
        assert_eq!(
            args[len - 2],
            "-pix_fmt",
            "penultimate must be -pix_fmt for {encoder:?}"
        );
        let expected = if encoder == HwEncoder::Vaapi {
            "vaapi"
        } else {
            "yuv420p"
        };
        assert_eq!(
            args[len - 1],
            expected,
            "last must be {expected} for {encoder:?}"
        );
    }
}

#[test]
fn raw_rgba_encoder_args_use_rawvideo_input() {
    let args = raw_rgba_encoder_args(HwEncoder::Software, 30, 80, 640, 360);

    assert_eq!(arg_after(&args, "-f"), "rawvideo");
    assert_eq!(arg_after(&args, "-pix_fmt"), "rgba");
    assert_eq!(arg_after(&args, "-s:v"), "640x360");
    assert_eq!(arg_after(&args, "-framerate"), "30");
    assert!(!args.contains(&"image2pipe".to_string()));
    assert!(!args.contains(&"mjpeg".to_string()));
    assert!(args.contains(&"libx264".to_string()));
}
