use std::cell::RefCell;

use skia_safe::{
    canvas::SrcRectConstraint, Canvas, ClipOp, Color4f, Font, FontMgr, FontStyle, Paint,
    PaintStyle, Point, RRect, Rect as SkRect, Typeface,
};

use crate::paint::images::ImageCache;
use crate::scene::{Color, Element, ElementKind, Rect};

thread_local! {
    static DEFAULT_TYPEFACE: RefCell<Option<Typeface>> = const { RefCell::new(None) };
}

fn cached_typeface() -> Typeface {
    DEFAULT_TYPEFACE.with(|cell| {
        let mut opt = cell.borrow_mut();
        if opt.is_none() {
            let mgr = FontMgr::new();
            *opt = Some(
                mgr.legacy_make_typeface(None, FontStyle::normal())
                    .expect("platform must provide a default typeface"),
            );
        }
        opt.as_ref().unwrap().clone()
    })
}

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
pub fn paint_element(canvas: &Canvas, element: &Element, images: &mut ImageCache) {
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
        let font = Font::new(&cached_typeface(), font_size);

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

    // --- Image content (object-fit: cover) ---
    if let ElementKind::Image { ref src } = element.kind {
        if let Some(image) = images.get_or_load(src) {
            let image = image.clone();
            let dest_rect = to_sk_rect(&element.bounds);
            let mut paint = Paint::default();
            paint.set_anti_alias(true);

            let src_w = image.width() as f32;
            let src_h = image.height() as f32;
            let dest_w = dest_rect.width();
            let dest_h = dest_rect.height();

            // Scale to fill the destination, cropping any overflow (cover).
            let scale = (dest_w / src_w).max(dest_h / src_h);
            let scaled_w = src_w * scale;
            let scaled_h = src_h * scale;

            // Center the crop region within the source image.
            let src_rect = SkRect::from_xywh(
                (scaled_w - dest_w) / (2.0 * scale),
                (scaled_h - dest_h) / (2.0 * scale),
                dest_w / scale,
                dest_h / scale,
            );

            canvas.draw_image_rect(
                &image,
                Some((&src_rect, SrcRectConstraint::Strict)),
                dest_rect,
                &paint,
            );
        }
    }

    // --- Children ---
    for child in &element.children {
        paint_element(canvas, child, images);
    }

    canvas.restore_to_count(save_count);
}
