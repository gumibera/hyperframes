use skia_safe::{
    gradient_shader, image_filters, BlurStyle, Canvas, Color4f, ImageFilter, MaskFilter, Paint,
    PaintStyle, Point as SkPoint, RRect, Rect as SkRect, Shader, TileMode,
};

use crate::scene::{BoxShadow, Color, Gradient};

/// Convert a `Color` (u8 RGBA) to Skia's `Color4f` (f32 channels in 0..1).
fn to_color4f(c: &Color) -> Color4f {
    Color4f::new(
        c.r as f32 / 255.0,
        c.g as f32 / 255.0,
        c.b as f32 / 255.0,
        c.a as f32 / 255.0,
    )
}

/// Build a rounded-rect for the shadow shape, applying per-corner radii.
fn make_shadow_rrect(rect: &SkRect, radii: &[f32; 4]) -> RRect {
    let corner_radii: [SkPoint; 4] = [
        (radii[0], radii[0]).into(),
        (radii[1], radii[1]).into(),
        (radii[2], radii[2]).into(),
        (radii[3], radii[3]).into(),
    ];
    let mut rrect = RRect::new();
    rrect.set_rect_radii(*rect, &corner_radii);
    rrect
}

/// Paint a CSS box-shadow behind an element.
///
/// `rect` is the element's local bounding rect (origin at 0,0 after canvas
/// translate). `radii` contains the four corner radii from `border_radius`.
pub fn paint_box_shadow(canvas: &Canvas, rect: &SkRect, radii: &[f32; 4], shadow: &BoxShadow) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(PaintStyle::Fill);
    paint.set_color4f(to_color4f(&shadow.color), None);

    if shadow.blur_radius > 0.0 {
        let sigma = shadow.blur_radius / 2.0;
        if let Some(mf) = MaskFilter::blur(BlurStyle::Normal, sigma, false) {
            paint.set_mask_filter(mf);
        }
    }

    let shadow_rect = SkRect::from_xywh(
        rect.left + shadow.offset_x - shadow.spread_radius,
        rect.top + shadow.offset_y - shadow.spread_radius,
        rect.width() + shadow.spread_radius * 2.0,
        rect.height() + shadow.spread_radius * 2.0,
    );

    if radii.iter().any(|&r| r > 0.0) {
        let rrect = make_shadow_rrect(&shadow_rect, radii);
        canvas.draw_rrect(rrect, &paint);
    } else {
        canvas.draw_rect(shadow_rect, &paint);
    }
}

/// Create a Skia `ImageFilter` for CSS `filter: blur(Npx)`.
///
/// Returns `None` when `blur_radius` is zero or negative, or if Skia fails to
/// create the filter.
pub fn create_blur_image_filter(blur_radius: f32) -> Option<ImageFilter> {
    if blur_radius <= 0.0 {
        return None;
    }
    let sigma = blur_radius / 2.0;
    image_filters::blur((sigma, sigma), TileMode::Clamp, None, None)
}

/// Create a gradient `Shader` filling `rect` according to a `Gradient` spec.
///
/// Returns `None` if the gradient has fewer than two stops or if Skia fails to
/// create the shader.
pub fn create_gradient_shader(rect: &SkRect, gradient: &Gradient) -> Option<Shader> {
    match gradient {
        Gradient::Linear { angle_deg, stops } => {
            if stops.len() < 2 {
                return None;
            }
            let angle_rad = angle_deg.to_radians();
            let cx = rect.center_x();
            let cy = rect.center_y();
            let half_w = rect.width() / 2.0;
            let half_h = rect.height() / 2.0;

            let start = SkPoint::new(
                cx - half_w * angle_rad.sin(),
                cy + half_h * angle_rad.cos(),
            );
            let end = SkPoint::new(
                cx + half_w * angle_rad.sin(),
                cy - half_h * angle_rad.cos(),
            );

            let colors: Vec<Color4f> = stops.iter().map(|s| to_color4f(&s.color)).collect();
            let positions: Vec<f32> = stops.iter().map(|s| s.position).collect();

            gradient_shader::linear(
                (start, end),
                colors.as_slice(),
                positions.as_slice(),
                TileMode::Clamp,
                None,
                None,
            )
        }
        Gradient::Radial { stops } => {
            if stops.len() < 2 {
                return None;
            }
            let center = SkPoint::new(rect.center_x(), rect.center_y());
            let radius = rect.width().max(rect.height()) / 2.0;

            let colors: Vec<Color4f> = stops.iter().map(|s| to_color4f(&s.color)).collect();
            let positions: Vec<f32> = stops.iter().map(|s| s.position).collect();

            gradient_shader::radial(
                center,
                radius,
                colors.as_slice(),
                positions.as_slice(),
                TileMode::Clamp,
                None,
                None,
            )
        }
    }
}
