mod parse;

pub use parse::{parse_scene_file, parse_scene_json};

use serde::{Deserialize, Serialize};

/// Top-level scene descriptor: a canvas with dimensions and a flat/nested element tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    pub elements: Vec<Element>,
    #[serde(default)]
    pub fonts: Vec<FontDescriptor>,
}

/// A font file reference that the Rust painter should load into Skia before
/// rendering.  The `path` is an absolute filesystem path to a .ttf/.otf/.woff2
/// file.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FontDescriptor {
    pub family: String,
    pub path: String,
    pub weight: u16,
    pub style: String,
}

/// A visual element in the scene graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub id: String,
    pub kind: ElementKind,
    pub bounds: Rect,
    #[serde(default)]
    pub style: Style,
    #[serde(default)]
    pub children: Vec<Element>,
}

/// Discriminated element type.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ElementKind {
    Container,
    Text { content: String },
    Image { src: String },
    Video { src: String },
}

/// Axis-aligned bounding rectangle.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// Visual style properties applied to an element.
///
/// `#[serde(default)]` at the struct level means any missing field falls back
/// to `Style::default()`, so partial style objects in JSON are valid.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Style {
    pub background_color: Option<Color>,
    pub opacity: f32,
    pub border_radius: [f32; 4],
    pub border: Option<Border>,
    pub overflow_hidden: bool,
    pub clip_path: Option<ClipPath>,
    pub transform: Option<Transform2D>,
    pub visibility: bool,
    pub font_family: Option<String>,
    pub font_size: Option<f32>,
    pub font_weight: Option<u16>,
    pub color: Option<Color>,
    pub text_shadow: Option<BoxShadow>,
    pub text_stroke: Option<TextStroke>,
    pub box_shadow: Option<BoxShadow>,
    pub filter_blur: Option<f32>,
    pub filter_adjust: Option<FilterAdjust>,
    pub background_image: Option<BackgroundImage>,
    pub background_gradient: Option<Gradient>,
    pub object_fit: Option<ObjectFit>,
    pub object_position: Option<ObjectPosition>,
    pub mix_blend_mode: Option<MixBlendMode>,
    pub letter_spacing: Option<f32>,
    pub line_height: Option<f32>,
    pub padding_left: Option<f32>,
    pub padding_top: Option<f32>,
    pub text_align: Option<String>,
    /// Timeline start time (seconds) — element is hidden before this time.
    pub data_start: Option<f32>,
    /// Timeline end time (seconds) — element is hidden after this time.
    pub data_end: Option<f32>,
    /// Path to directory of pre-extracted video frames (frame_00001.jpg, ...).
    pub video_frames_dir: Option<String>,
    /// FPS of the extracted video frames (defaults to 30 when frames_dir is set).
    pub video_fps: Option<f32>,
    /// Media offset in seconds — where in the source video playback starts.
    pub video_media_start: Option<f32>,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            background_color: None,
            opacity: 1.0,
            border_radius: [0.0; 4],
            border: None,
            overflow_hidden: false,
            clip_path: None,
            transform: None,
            visibility: true,
            font_family: None,
            font_size: None,
            font_weight: None,
            color: None,
            text_shadow: None,
            text_stroke: None,
            box_shadow: None,
            filter_blur: None,
            filter_adjust: None,
            background_image: None,
            background_gradient: None,
            object_fit: None,
            object_position: None,
            mix_blend_mode: None,
            letter_spacing: None,
            line_height: None,
            data_start: None,
            data_end: None,
            video_frames_dir: None,
            video_fps: None,
            video_media_start: None,
            padding_left: None,
            padding_top: None,
            text_align: None,
        }
    }
}

/// CSS border shorthand currently supports solid and dashed line styles.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Border {
    pub width: f32,
    pub color: Color,
    #[serde(default)]
    pub style: BorderLineStyle,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BorderLineStyle {
    #[default]
    Solid,
    Dashed,
}

/// CSS clip-path primitives.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ClipPath {
    Polygon {
        points: Vec<Point2D>,
    },
    Circle {
        x: f32,
        y: f32,
        radius: f32,
    },
    Ellipse {
        x: f32,
        y: f32,
        radius_x: f32,
        radius_y: f32,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Point2D {
    pub x: f32,
    pub y: f32,
}

/// CSS box-shadow equivalent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BoxShadow {
    pub offset_x: f32,
    pub offset_y: f32,
    pub blur_radius: f32,
    pub spread_radius: f32,
    pub color: Color,
}

/// CSS background-image URL layer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BackgroundImage {
    pub src: String,
    #[serde(default)]
    pub fit: BackgroundImageFit,
    #[serde(default)]
    pub position: ObjectPosition,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BackgroundImageFit {
    Fill,
    Contain,
    #[default]
    Cover,
    None,
}

/// CSS gradient background.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum Gradient {
    Linear {
        angle_deg: f32,
        stops: Vec<GradientStop>,
    },
    Radial {
        stops: Vec<GradientStop>,
    },
}

/// A single color stop within a gradient.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientStop {
    /// Position along the gradient, 0.0 to 1.0.
    pub position: f32,
    pub color: Color,
}

/// CSS filter color-adjust functions.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct FilterAdjust {
    #[serde(default = "one")]
    pub brightness: f32,
    #[serde(default = "one")]
    pub contrast: f32,
    #[serde(default = "one")]
    pub saturate: f32,
}

/// CSS text stroke equivalent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextStroke {
    pub width: f32,
    pub color: Color,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ObjectFit {
    Fill,
    Contain,
    Cover,
    None,
    ScaleDown,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct ObjectPosition {
    /// Horizontal position normalized from 0.0 (left) to 1.0 (right).
    pub x: f32,
    /// Vertical position normalized from 0.0 (top) to 1.0 (bottom).
    pub y: f32,
}

impl Default for ObjectPosition {
    fn default() -> Self {
        Self { x: 0.5, y: 0.5 }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MixBlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Hue,
    Saturation,
    Color,
    Luminosity,
}

/// RGBA color with 8-bit channels.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

/// 2D affine transform (translate, uniform/non-uniform scale, rotation).
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Transform2D {
    #[serde(default)]
    pub translate_x: f32,
    #[serde(default)]
    pub translate_y: f32,
    #[serde(default = "one")]
    pub scale_x: f32,
    #[serde(default = "one")]
    pub scale_y: f32,
    #[serde(default)]
    pub rotate_deg: f32,
}

fn one() -> f32 {
    1.0
}

// ── Baked Timeline Types ────────────────────────────────────────────────────

/// A pre-baked timeline: every frame carries the fully-resolved state of
/// every animated element, so the renderer does zero interpolation at paint time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BakedTimeline {
    pub fps: u32,
    pub duration: f64,
    pub total_frames: u32,
    pub frames: Vec<BakedFrame>,
}

/// Per-frame snapshot of animated element states, keyed by element id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BakedFrame {
    pub frame_index: u32,
    pub time: f64,
    pub elements: std::collections::HashMap<String, BakedElementState>,
}

/// Resolved visual state for a single element at a single frame.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BakedElementState {
    pub opacity: f32,
    pub translate_x: f32,
    pub translate_y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotate_deg: f32,
    pub visibility: bool,
}
