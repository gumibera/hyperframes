use skia_safe::{
    Canvas, ClipOp, Color4f, Font, FontMgr, FontStyle, Paint, PaintStyle, Point, RRect,
    Rect as SkRect,
};

use crate::scene::{Color, Element, ElementKind, Rect};

/// Convert a `Color` (u8 RGBA) to Skia's `Color4f` (f32 channels in 0.0..1.0).
fn to_color4f(c: &Color) -> Color4f {
    Color4f::new(
        c.r as f32 / 255.0,
        c.g as f32 / 255.0,
        c.b as f32 / 255.0,
        c.a as f32 / 255.0,
    )
}

/// Convert element bounds to a Skia rect at the origin. We translate the canvas
/// to `(bounds.x, bounds.y)` before painting, so the local rect is `(0, 0, w, h)`.
fn to_sk_rect(bounds: &Rect) -> SkRect {
    SkRect::from_xywh(0.0, 0.0, bounds.width, bounds.height)
}

/// Build a rounded rect with per-corner radii `[top-left, top-right, bottom-right, bottom-left]`.
fn make_rrect(rect: &SkRect, radii: &[f32; 4]) -> RRect {
    let corner_radii: [Point; 4] = [
        (radii[0], radii[0]).into(),
        (radii[1], radii[1]).into(),
        (radii[2], radii[2]).into(),
        (radii[3], radii[3]).into(),
    ];
    let mut rrect = RRect::new();
    rrect.set_rect_radii(*rect, &corner_radii);
    rrect
}

/// Returns true when all four corner radii are zero.
fn radii_are_zero(radii: &[f32; 4]) -> bool {
    radii.iter().all(|&r| r == 0.0)
}

/// Recursively paint an `Element` and its children onto a Skia `Canvas`.
///
/// The painting order follows the CSS box model:
/// 1. Position (translate to element bounds)
/// 2. Transform (rotate, scale around center)
/// 3. Opacity (layer alpha)
/// 4. Clip (overflow hidden)
/// 5. Background
/// 6. Content (text)
/// 7. Children (recursion)
pub fn paint_element(canvas: &Canvas, element: &Element) {
    let style = &element.style;

    // Skip invisible elements entirely.
    if !style.visibility {
        return;
    }

    let save_count = canvas.save();

    // --- Position & Transform ---
    canvas.translate((element.bounds.x, element.bounds.y));

    if let Some(ref t) = style.transform {
        let cx = element.bounds.width / 2.0;
        let cy = element.bounds.height / 2.0;

        canvas.translate((cx, cy));
        canvas.rotate(t.rotate_deg, None);
        canvas.scale((t.scale_x, t.scale_y));
        canvas.translate((-cx, -cy));
        canvas.translate((t.translate_x, t.translate_y));
    }

    // --- Opacity (save layer) ---
    let has_partial_opacity = style.opacity < 1.0;
    if has_partial_opacity {
        let alpha = (style.opacity.clamp(0.0, 1.0) * 255.0) as u32;
        canvas.save_layer_alpha(None, alpha);
    }

    let local_rect = to_sk_rect(&element.bounds);
    let has_radii = !radii_are_zero(&style.border_radius);

    // --- Clip (overflow hidden) ---
    if style.overflow_hidden {
        if has_radii {
            let rrect = make_rrect(&local_rect, &style.border_radius);
            canvas.clip_rrect(rrect, ClipOp::Intersect, true);
        } else {
            canvas.clip_rect(local_rect, ClipOp::Intersect, true);
        }
    }

    // --- Background ---
    if let Some(ref bg) = style.background_color {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_style(PaintStyle::Fill);
        paint.set_color4f(to_color4f(bg), None);

        if has_radii {
            let rrect = make_rrect(&local_rect, &style.border_radius);
            canvas.draw_rrect(rrect, &paint);
        } else {
            canvas.draw_rect(local_rect, &paint);
        }
    }

    // --- Text content ---
    if let ElementKind::Text { ref content } = element.kind {
        let font_size = style.font_size.unwrap_or(16.0);
        let mgr = FontMgr::new();
        let typeface = mgr
            .legacy_make_typeface(None, FontStyle::normal())
            .expect("platform must provide a default typeface");
        let font = Font::new(typeface, font_size);

        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_style(PaintStyle::Fill);

        let text_color = style.color.unwrap_or(Color {
            r: 255,
            g: 255,
            b: 255,
            a: 255,
        });
        paint.set_color4f(to_color4f(&text_color), None);

        let (_, metrics) = font.metrics();
        // `metrics.ascent` is negative (distance above baseline), so negate it to
        // get the y-offset where the baseline sits.
        let y = -metrics.ascent;

        canvas.draw_str(content, (0.0, y), &font, &paint);
    }

    // --- Children ---
    for child in &element.children {
        paint_element(canvas, child);
    }

    canvas.restore_to_count(save_count);
}
