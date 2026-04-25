mod parse;

pub use parse::{parse_scene_file, parse_scene_json};

use serde::{Deserialize, Serialize};

/// Top-level scene descriptor: a canvas with dimensions and a flat/nested element tree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub width: u32,
    pub height: u32,
    pub elements: Vec<Element>,
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
    pub overflow_hidden: bool,
    pub transform: Option<Transform2D>,
    pub visibility: bool,
    pub font_family: Option<String>,
    pub font_size: Option<f32>,
    pub font_weight: Option<u16>,
    pub color: Option<Color>,
}

impl Default for Style {
    fn default() -> Self {
        Self {
            background_color: None,
            opacity: 1.0,
            border_radius: [0.0; 4],
            overflow_hidden: false,
            transform: None,
            visibility: true,
            font_family: None,
            font_size: None,
            font_weight: None,
            color: None,
        }
    }
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
