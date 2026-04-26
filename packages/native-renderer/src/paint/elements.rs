use std::{cell::RefCell, collections::HashMap};

use skia_safe::{
    canvas::{SaveLayerRec, SrcRectConstraint},
    dash_path_effect,
    font_style::{Slant, Weight, Width},
    BlendMode, Canvas, ClipOp, Color4f, Font, FontMgr, FontStyle, Paint, PaintStyle, PathBuilder,
    Point, RRect, Rect as SkRect, Typeface,
};

use crate::paint::effects;
use crate::paint::fonts::FontRegistry;
use crate::paint::images::ImageCache;
use crate::scene::{
    BackgroundImageFit, BorderLineStyle, ClipPath, Color, Element, ElementKind, MixBlendMode,
    ObjectFit, ObjectPosition, Rect,
};

thread_local! {
    static DEFAULT_TYPEFACE: RefCell<Option<Typeface>> = const { RefCell::new(None) };
    static TYPEFACE_CACHE: RefCell<HashMap<String, Typeface>> = RefCell::new(HashMap::new());
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

fn resolve_typeface(
    family: Option<&str>,
    weight: Option<u16>,
    font_registry: Option<&FontRegistry>,
) -> Typeface {
    let family_key = family.unwrap_or_default().trim();
    let weight_value = weight.unwrap_or(400);

    // Check the custom font registry first — these are fonts loaded from disk
    // (e.g. Google Fonts downloaded by the pipeline).
    if let Some(registry) = font_registry {
        if !family_key.is_empty() {
            if let Some(tf) = registry.get_typeface(family_key, weight_value, "normal") {
                return tf.clone();
            }
        }
    }

    let cache_key = format!("{family_key}:{weight_value}");

    TYPEFACE_CACHE.with(|cache| {
        if let Some(typeface) = cache.borrow().get(&cache_key) {
            return typeface.clone();
        }

        let font_style = FontStyle::new(
            Weight::from(weight_value as i32),
            Width::NORMAL,
            Slant::Upright,
        );
        let mgr = FontMgr::new();
        let typeface = if family_key.is_empty() {
            mgr.legacy_make_typeface(None, font_style)
        } else {
            mgr.match_family_style(family_key, font_style)
                .or_else(|| mgr.legacy_make_typeface(None, font_style))
        }
        .unwrap_or_else(cached_typeface);

        cache.borrow_mut().insert(cache_key, typeface.clone());
        typeface
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

fn build_clip_path(clip_path: &ClipPath) -> Option<skia_safe::Path> {
    let mut builder = PathBuilder::new();
    match clip_path {
        ClipPath::Polygon { points } => {
            if points.len() < 3 {
                return None;
            }
            let sk_points: Vec<Point> = points.iter().map(|p| Point::new(p.x, p.y)).collect();
            builder.add_polygon(&sk_points, true);
        }
        ClipPath::Circle { x, y, radius } => {
            if *radius <= 0.0 {
                return None;
            }
            builder.add_circle((*x, *y), *radius, None);
        }
        ClipPath::Ellipse {
            x,
            y,
            radius_x,
            radius_y,
        } => {
            if *radius_x <= 0.0 || *radius_y <= 0.0 {
                return None;
            }
            builder.add_oval(
                SkRect::from_xywh(x - radius_x, y - radius_y, radius_x * 2.0, radius_y * 2.0),
                None,
                None,
            );
        }
    }
    Some(builder.detach())
}

fn to_sk_blend_mode(mode: MixBlendMode) -> BlendMode {
    match mode {
        MixBlendMode::Normal => BlendMode::SrcOver,
        MixBlendMode::Multiply => BlendMode::Multiply,
        MixBlendMode::Screen => BlendMode::Screen,
        MixBlendMode::Overlay => BlendMode::Overlay,
        MixBlendMode::Darken => BlendMode::Darken,
        MixBlendMode::Lighten => BlendMode::Lighten,
        MixBlendMode::ColorDodge => BlendMode::ColorDodge,
        MixBlendMode::ColorBurn => BlendMode::ColorBurn,
        MixBlendMode::HardLight => BlendMode::HardLight,
        MixBlendMode::SoftLight => BlendMode::SoftLight,
        MixBlendMode::Difference => BlendMode::Difference,
        MixBlendMode::Exclusion => BlendMode::Exclusion,
        MixBlendMode::Hue => BlendMode::Hue,
        MixBlendMode::Saturation => BlendMode::Saturation,
        MixBlendMode::Color => BlendMode::Color,
        MixBlendMode::Luminosity => BlendMode::Luminosity,
    }
}

fn draw_border(
    canvas: &Canvas,
    rect: &SkRect,
    radii: &[f32; 4],
    has_radii: bool,
    element: &Element,
) {
    let Some(border) = element.style.border.as_ref() else {
        return;
    };
    if border.width <= 0.0 || border.color.a == 0 {
        return;
    }

    let inset = border.width / 2.0;
    let stroke_rect = SkRect::from_xywh(
        rect.left + inset,
        rect.top + inset,
        (rect.width() - border.width).max(0.0),
        (rect.height() - border.width).max(0.0),
    );

    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(border.width);
    paint.set_color4f(to_color4f(&border.color), None);

    if border.style == BorderLineStyle::Dashed {
        let dash = (border.width * 3.0).max(1.0);
        paint.set_path_effect(dash_path_effect::new(&[dash, dash], 0.0));
    }

    if has_radii {
        let rrect = make_rrect(&stroke_rect, radii);
        canvas.draw_rrect(rrect, &paint);
    } else {
        canvas.draw_rect(stroke_rect, &paint);
    }
}

fn object_position_or_center(position: Option<ObjectPosition>) -> ObjectPosition {
    position.unwrap_or(ObjectPosition { x: 0.5, y: 0.5 })
}

fn compute_image_rects(
    src_w: f32,
    src_h: f32,
    dest_rect: &SkRect,
    fit: ObjectFit,
    position: ObjectPosition,
) -> (SkRect, SkRect) {
    let dest_w = dest_rect.width();
    let dest_h = dest_rect.height();
    let full_src = SkRect::from_xywh(0.0, 0.0, src_w, src_h);

    match fit {
        ObjectFit::Fill => (full_src, *dest_rect),
        ObjectFit::Contain => {
            let scale = (dest_w / src_w).min(dest_h / src_h);
            let scaled_w = src_w * scale;
            let scaled_h = src_h * scale;
            let x = (dest_w - scaled_w) * position.x;
            let y = (dest_h - scaled_h) * position.y;
            (full_src, SkRect::from_xywh(x, y, scaled_w, scaled_h))
        }
        ObjectFit::Cover => {
            let scale = (dest_w / src_w).max(dest_h / src_h);
            let crop_w = dest_w / scale;
            let crop_h = dest_h / scale;
            let src_x = (src_w - crop_w) * position.x;
            let src_y = (src_h - crop_h) * position.y;
            (SkRect::from_xywh(src_x, src_y, crop_w, crop_h), *dest_rect)
        }
        ObjectFit::None => {
            let x = (dest_w - src_w) * position.x;
            let y = (dest_h - src_h) * position.y;
            (full_src, SkRect::from_xywh(x, y, src_w, src_h))
        }
        ObjectFit::ScaleDown => {
            if src_w <= dest_w && src_h <= dest_h {
                compute_image_rects(src_w, src_h, dest_rect, ObjectFit::None, position)
            } else {
                compute_image_rects(src_w, src_h, dest_rect, ObjectFit::Contain, position)
            }
        }
    }
}

fn background_fit_to_object_fit(fit: BackgroundImageFit) -> ObjectFit {
    match fit {
        BackgroundImageFit::Fill => ObjectFit::Fill,
        BackgroundImageFit::Contain => ObjectFit::Contain,
        BackgroundImageFit::Cover => ObjectFit::Cover,
        BackgroundImageFit::None => ObjectFit::None,
    }
}

fn draw_image(
    canvas: &Canvas,
    image: &skia_safe::Image,
    dest_rect: &SkRect,
    fit: ObjectFit,
    position: ObjectPosition,
) {
    let mut paint = Paint::default();
    paint.set_anti_alias(true);

    let src_w = image.width() as f32;
    let src_h = image.height() as f32;
    let (src_rect, target_rect) = compute_image_rects(src_w, src_h, dest_rect, fit, position);

    let image_save_count = canvas.save();
    canvas.clip_rect(*dest_rect, ClipOp::Intersect, true);
    canvas.draw_image_rect(
        image,
        Some((&src_rect, SrcRectConstraint::Strict)),
        target_rect,
        &paint,
    );
    canvas.restore_to_count(image_save_count);
}

/// Recursively paint an `Element` and its children onto a Skia `Canvas`.
///
/// The painting order follows the CSS box model:
/// 1. Position (translate to element bounds)
/// 2. Transform (rotate, scale around center)
/// 3. Box shadow (painted before element content)
/// 4. Opacity (layer alpha)
/// 5. Blur filter (save layer with ImageFilter)
/// 6. Clip (overflow hidden)
/// 7. Background (gradient takes priority over solid color)
/// 8. Border
/// 9. Content (text, image)
/// 10. Children (recursion)
pub fn paint_element(canvas: &Canvas, element: &Element, images: &mut ImageCache) {
    paint_element_at_time(canvas, element, images, 0.0);
}

/// Recursively paint an `Element` at a timeline time with custom fonts.
pub fn paint_element_at_time_with_fonts(
    canvas: &Canvas,
    element: &Element,
    images: &mut ImageCache,
    time_secs: f64,
    font_registry: Option<&FontRegistry>,
) {
    paint_element_inner(canvas, element, images, time_secs, font_registry);
}

/// Recursively paint an `Element` at a timeline time. `time_secs` is used for
/// video frame compositing.
pub fn paint_element_at_time(
    canvas: &Canvas,
    element: &Element,
    images: &mut ImageCache,
    time_secs: f64,
) {
    paint_element_inner(canvas, element, images, time_secs, None);
}

fn paint_element_inner(
    canvas: &Canvas,
    element: &Element,
    images: &mut ImageCache,
    time_secs: f64,
    font_registry: Option<&FontRegistry>,
) {
    let style = &element.style;

    // Skip invisible elements entirely.
    if !style.visibility {
        return;
    }

    // Skip elements outside their data-start..data-end time range.
    let t = time_secs as f32;
    if let Some(start) = style.data_start {
        if t < start {
            return;
        }
    }
    if let Some(end) = style.data_end {
        if t >= end {
            return;
        }
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

    let local_rect = to_sk_rect(&element.bounds);
    let has_radii = !radii_are_zero(&style.border_radius);

    // --- Box shadow (painted before opacity/blur so it sits behind the element) ---
    if let Some(ref shadow) = style.box_shadow {
        effects::paint_box_shadow(canvas, &local_rect, &style.border_radius, shadow);
    }

    // --- Stacking effects (applied to the whole element subtree on restore) ---
    let has_partial_opacity = style.opacity < 1.0;
    let has_blur = style.filter_blur.is_some_and(|b| b > 0.0);
    let has_filter_adjust = style.filter_adjust.is_some();
    let has_blend_mode = style
        .mix_blend_mode
        .is_some_and(|mode| mode != MixBlendMode::Normal);
    if has_partial_opacity || has_blur || has_filter_adjust || has_blend_mode {
        let mut layer_paint = Paint::default();

        if has_partial_opacity {
            layer_paint.set_alpha_f(style.opacity.clamp(0.0, 1.0));
        }

        if let Some(filter) = style
            .filter_blur
            .and_then(effects::create_blur_image_filter)
        {
            layer_paint.set_image_filter(filter);
        }

        if let Some(filter) = style
            .filter_adjust
            .as_ref()
            .and_then(effects::create_filter_adjust_color_filter)
        {
            layer_paint.set_color_filter(filter);
        }

        if let Some(mode) = style.mix_blend_mode {
            layer_paint.set_blend_mode(to_sk_blend_mode(mode));
        }

        let layer_bounds = if has_blur {
            let blur_pad = style.filter_blur.unwrap_or_default().max(0.0) * 2.0;
            Some(SkRect::from_xywh(
                -blur_pad,
                -blur_pad,
                local_rect.width() + blur_pad * 2.0,
                local_rect.height() + blur_pad * 2.0,
            ))
        } else if style.overflow_hidden {
            Some(local_rect)
        } else {
            None
        };

        let rec = SaveLayerRec::default().paint(&layer_paint);
        if let Some(ref bounds) = layer_bounds {
            let rec = rec.bounds(bounds);
            canvas.save_layer(&rec);
        } else {
            canvas.save_layer(&rec);
        }
    }

    // --- Clip path ---
    if let Some(ref clip_path) = style.clip_path {
        if let Some(path) = build_clip_path(clip_path) {
            canvas.clip_path(&path, ClipOp::Intersect, true);
        }
    }

    // --- Clip (overflow hidden) ---
    if style.overflow_hidden {
        if has_radii {
            let rrect = make_rrect(&local_rect, &style.border_radius);
            canvas.clip_rrect(rrect, ClipOp::Intersect, true);
        } else {
            canvas.clip_rect(local_rect, ClipOp::Intersect, true);
        }
    }

    // --- Background (CSS order: color, image/gradient) ---
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

    if let Some(ref gradient) = style.background_gradient {
        if let Some(shader) = effects::create_gradient_shader(&local_rect, gradient) {
            let mut paint = Paint::default();
            paint.set_anti_alias(true);
            paint.set_style(PaintStyle::Fill);
            paint.set_shader(shader);

            if has_radii {
                let rrect = make_rrect(&local_rect, &style.border_radius);
                canvas.draw_rrect(rrect, &paint);
            } else {
                canvas.draw_rect(local_rect, &paint);
            }
        }
    } else if let Some(ref background_image) = style.background_image {
        if let Some(image) = images.get_or_load(&background_image.src).cloned() {
            draw_image(
                canvas,
                &image,
                &local_rect,
                background_fit_to_object_fit(background_image.fit),
                background_image.position,
            );
        }
    }

    // --- Border ---
    draw_border(
        canvas,
        &local_rect,
        &style.border_radius,
        has_radii,
        element,
    );

    // --- Text content ---
    if let ElementKind::Text { ref content } = element.kind {
        let font_size = style.font_size.unwrap_or(16.0);
        let typeface = resolve_typeface(
            style.font_family.as_deref(),
            style.font_weight,
            font_registry,
        );
        let mut font = Font::new(&typeface, font_size);
        if let Some(spacing) = style.letter_spacing {
            // Skia does not have a direct `set_spacing` on Font.  The
            // textlayout Paragraph API handles letter-spacing natively, but
            // for the simple `draw_str` path we emulate it by adding the
            // extra advance to each glyph via `set_scale_x` would be wrong.
            // Instead, we use the skia_safe Font's underlying
            // `setEdging(kAntiAlias)` and manually adjust glyph positions
            // below when drawing (TODO: migrate to Paragraph for full
            // line-height / letter-spacing support).  For now, a reasonable
            // approximation: skew the glyph widths by adjusting scale_x.
            // A proper implementation would iterate glyphs.
            // As a first pass, bump the scale factor proportionally.
            let base_scale = font.scale_x();
            let advance_ratio = 1.0 + spacing / font_size;
            font.set_scale_x(base_scale * advance_ratio);
        }

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

        if let Some(ref shadow) = style.text_shadow {
            let mut shadow_paint = Paint::default();
            shadow_paint.set_anti_alias(true);
            shadow_paint.set_style(PaintStyle::Fill);
            shadow_paint.set_color4f(to_color4f(&shadow.color), None);
            if shadow.blur_radius > 0.0 {
                if let Some(mf) = skia_safe::MaskFilter::blur(
                    skia_safe::BlurStyle::Normal,
                    shadow.blur_radius / 2.0,
                    false,
                ) {
                    shadow_paint.set_mask_filter(mf);
                }
            }
            canvas.draw_str(
                content,
                (shadow.offset_x, y + shadow.offset_y),
                &font,
                &shadow_paint,
            );
        }

        if let Some(ref stroke) = style.text_stroke {
            if stroke.width > 0.0 && stroke.color.a > 0 {
                let mut stroke_paint = Paint::default();
                stroke_paint.set_anti_alias(true);
                stroke_paint.set_style(PaintStyle::Stroke);
                stroke_paint.set_stroke_width(stroke.width);
                stroke_paint.set_color4f(to_color4f(&stroke.color), None);
                canvas.draw_str(content, (0.0, y), &font, &stroke_paint);
            }
        }

        canvas.draw_str(content, (0.0, y), &font, &paint);
    }

    // --- Image content ---
    if let ElementKind::Image { ref src } = element.kind {
        if let Some(image) = images.get_or_load(src).cloned() {
            let dest_rect = to_sk_rect(&element.bounds);
            let position = object_position_or_center(style.object_position);
            draw_image(
                canvas,
                &image,
                &dest_rect,
                style.object_fit.unwrap_or(ObjectFit::Cover),
                position,
            );
        }
    }

    // --- Video content ---
    if let ElementKind::Video { ref src } = element.kind {
        let frame_image = if let Some(ref frames_dir) = style.video_frames_dir {
            // Pre-extracted frames: compute the frame index from the element's
            // own timeline position. `data_start` anchors the element on the
            // composition timeline; `video_media_start` offsets into the source.
            let media_start = style.video_media_start.unwrap_or(0.0);
            let video_fps = style.video_fps.unwrap_or(30.0);
            let element_start = style.data_start.unwrap_or(0.0);
            let video_time = (t - element_start + media_start).max(0.0);
            let frame_index = (video_time * video_fps).round() as u32;
            let frame_path = format!("{}/frame_{:05}.jpg", frames_dir, frame_index + 1);
            images.get_or_load(&frame_path).cloned()
        } else {
            // Fallback: extract frame on-demand via FFmpeg
            images.get_or_load_video_frame(src, time_secs).cloned()
        };

        if let Some(image) = frame_image {
            let dest_rect = to_sk_rect(&element.bounds);
            let position = object_position_or_center(style.object_position);
            draw_image(
                canvas,
                &image,
                &dest_rect,
                style.object_fit.unwrap_or(ObjectFit::Cover),
                position,
            );
        }
    }

    // --- Children ---
    for child in &element.children {
        paint_element_inner(canvas, child, images, time_secs, font_registry);
    }

    canvas.restore_to_count(save_count);
}
