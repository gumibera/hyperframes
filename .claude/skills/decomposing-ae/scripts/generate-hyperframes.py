#!/usr/bin/env python3
"""Generate a HyperFrames HTML composition from parsed .aepx JSON.

Usage:
    python3 parse-aepx.py input.aepx > project.json
    python3 generate-hyperframes.py project.json > index.html

Produces a single flat index.html with all animations driven by one GSAP timeline.
"""
from __future__ import annotations

import json
import sys
import html as html_mod


# ── Helpers ──────────────────────────────────────────────────────────────────


def easing_to_gsap(easing: dict) -> str:
    t = easing.get("type", "bezier")
    if t == "linear":
        return '"none"'
    if t == "hold":
        return '"none"'
    return '"power2.inOut"'


def extract_fill_color(effects: list) -> str | None:
    """Extract a fill/tint color from effect parameters."""
    for eff in effects:
        name = (eff.get("displayName") or eff.get("name", "")).lower()
        if "fill" not in name and "tint" not in name:
            continue
        params = eff.get("params", [])
        if isinstance(params, dict):
            params = list(params.values())
        for p in params:
            val = p.get("value") if isinstance(p, dict) else p
            if isinstance(val, list) and len(val) >= 3:
                r, g, b = int(val[0]), int(val[1]), int(val[2])
                if r + g + b > 30:  # skip near-black
                    return f"#{r:02x}{g:02x}{b:02x}"
    return None


def extract_stroke_style(shape_groups: list) -> tuple[str, int]:
    """Extract stroke color and width from shape groups."""
    color = "#ffffff"
    width = 2
    for sg in shape_groups:
        if sg.get("stroke"):
            sc = sg["stroke"].get("color", [])
            if isinstance(sc, list) and len(sc) >= 3:
                color = f"#{int(sc[0]):02x}{int(sc[1]):02x}{int(sc[2]):02x}"
            sw = sg["stroke"].get("width", 2)
            if isinstance(sw, (int, float)):
                width = max(1, int(sw))
    return color, width


# ── Keyframe generation ──────────────────────────────────────────────────────


def generate_keyframe_tweens(
    element_id: str,
    prop_name: str,
    keyframes: list,
    abs_start: float,
) -> list[str]:
    """Generate GSAP tween lines from keyframe data.

    abs_start is the absolute time offset (scene_start + layer local time).
    """
    lines = []
    gsap_prop = {
        "scale": "scale",
        "opacity": "opacity",
        "rotation": "rotation",
        "position": None,
    }.get(prop_name)

    if gsap_prop is None and prop_name == "position":
        for i, kf in enumerate(keyframes):
            t = round(abs_start + kf["time"], 4)
            val = kf["value"]
            ease = easing_to_gsap(kf.get("easing", {}))
            x = round(val[0], 2) if isinstance(val, list) and len(val) > 0 else 0
            y = round(val[1], 2) if isinstance(val, list) and len(val) > 1 else 0
            if i == 0:
                lines.append(f'      tl.set("{element_id}", {{ x: {x}, y: {y} }}, {t});')
            else:
                prev_t = round(abs_start + keyframes[i - 1]["time"], 4)
                dur = round(t - prev_t, 4)
                if dur > 0:
                    lines.append(
                        f'      tl.to("{element_id}", {{ x: {x}, y: {y}, duration: {dur}, ease: {ease} }}, {prev_t});'
                    )
        return lines

    if gsap_prop is None:
        return lines

    for i, kf in enumerate(keyframes):
        t = round(abs_start + kf["time"], 4)
        val = kf["value"]
        ease = easing_to_gsap(kf.get("easing", {}))

        if gsap_prop == "scale":
            v = round(val[0], 4) if isinstance(val, list) and len(val) > 0 else (round(val, 4) if isinstance(val, (int, float)) else 1)
        elif gsap_prop in ("opacity", "rotation"):
            v = round(val, 4) if isinstance(val, (int, float)) else val
        else:
            v = val

        if i == 0:
            lines.append(f'      tl.set("{element_id}", {{ {gsap_prop}: {v} }}, {t});')
        else:
            prev_t = round(abs_start + keyframes[i - 1]["time"], 4)
            dur = round(t - prev_t, 4)
            if dur > 0:
                lines.append(
                    f'      tl.to("{element_id}", {{ {gsap_prop}: {v}, duration: {dur}, ease: {ease} }}, {prev_t});'
                )

    return lines


# ── Layer rendering ──────────────────────────────────────────────────────────


def layer_to_html(
    layer: dict,
    source_comp: dict,
    parent_w: int,
    parent_h: int,
    comp_idx: int,
    layer_idx: int,
    total_layers: int,
    scene_start: float,
) -> tuple[str, list[str]]:
    """Convert a layer to HTML element + GSAP tween lines.

    scene_start: absolute start time of the parent scene in the root timeline.
    All GSAP times are absolute (scene_start + local layer time).
    """
    el_id = f"c{comp_idx}-l{layer_idx}"
    ltype = layer["type"]
    name = layer.get("name", "")
    in_pt = layer.get("inPoint", 0)
    out_pt = layer.get("outPoint", 0)
    dur = round(out_pt - in_pt, 4) if out_pt > in_pt else round(out_pt, 4)

    # Absolute times for GSAP
    abs_in = round(scene_start + in_pt, 4)
    abs_out = round(abs_in + dur, 4)

    transform = layer.get("transform", {})
    anchor = transform.get("anchorPoint", {}).get("value", [0, 0, 0])
    position = transform.get("position", {}).get("value", [0, 0, 0])
    scale_val = transform.get("scale", {}).get("value", [1, 1, 1])
    opacity_val = transform.get("opacity", {}).get("value", 1)

    ax = anchor[0] if len(anchor) > 0 else 0
    ay = anchor[1] if len(anchor) > 1 else 0
    px = position[0] if len(position) > 0 else 0
    py = position[1] if len(position) > 1 else 0

    sx = scale_val[0] if isinstance(scale_val, list) and len(scale_val) > 0 else 1
    sy = scale_val[1] if isinstance(scale_val, list) and len(scale_val) > 1 else 1
    op = opacity_val if isinstance(opacity_val, (int, float)) else 1

    # Source comp dimensions
    src_w = source_comp.get("width", parent_w)
    src_h = source_comp.get("height", parent_h)

    # Z-index: AE first layer = top, so invert
    z_index = total_layers - layer_idx

    gsap_lines = []
    inner = ""

    # ── Text layers ──────────────────────────────────────────────────────
    if ltype == "text":
        text = html_mod.escape(layer.get("textContent", name))
        font = layer.get("fontFamily", "Montserrat")
        font_color = layer.get("fontColor", "#ffffff")
        raw_size = layer.get("fontSize", 27)

        # Scale font size: source comp is small (text-sized), scale to parent viewport
        if src_h > 0 and src_h < parent_h:
            scale_factor = parent_h / src_h
            font_size = min(int(raw_size * scale_factor * 0.5), 140)
            font_size = max(font_size, 36)
        else:
            font_size = max(raw_size, 36)

        # Center text in parent viewport
        css_left = 0
        css_top = round((parent_h - font_size * 2) / 2, 2)
        w = parent_w
        h = font_size * 3

        inner = (
            f'<span style="font-family:\'{font}\',sans-serif;font-weight:900;'
            f"font-size:{font_size}px;color:{font_color};text-transform:uppercase;"
            f'letter-spacing:0.08em;white-space:nowrap;">{text}</span>'
        )
        style = (
            f"position:absolute;left:{css_left}px;top:{css_top}px;"
            f"width:{w}px;height:{h}px;"
            f"display:flex;align-items:center;justify-content:center;"
            f"z-index:{z_index};visibility:hidden"
        )

    # ── Solid layers ─────────────────────────────────────────────────────
    elif ltype == "solid":
        # Use Fill effect color, but skip if layer has expressions (colors are expression-driven)
        color = "#1a1a1a"
        if not layer.get("expression"):
            color = extract_fill_color(layer.get("effects", [])) or "#1a1a1a"
        css_left = round(px - ax, 2)
        css_top = round(py - ay, 2)
        w, h = parent_w, parent_h
        style = (
            f"position:absolute;left:{css_left}px;top:{css_top}px;"
            f"width:{w}px;height:{h}px;"
            f"background:{color};z-index:{z_index};visibility:hidden"
        )
        if abs(sx - 1) > 0.01 or abs(sy - 1) > 0.01:
            style += f";transform:scale({round(sx, 3)},{round(sy, 3)})"

    # ── Shape layers ─────────────────────────────────────────────────────
    elif ltype == "shape":
        stroke_color, stroke_width = extract_stroke_style(layer.get("shapeGroups", []))
        # Also check Fill effect for override color (skip if expression-driven)
        if not layer.get("expression"):
            fill_eff_color = extract_fill_color(layer.get("effects", []))
            if fill_eff_color:
                stroke_color = fill_eff_color

        css_left = round(px - ax, 2)
        css_top = round(py - ay, 2)
        w, h = parent_w, parent_h
        style = (
            f"position:absolute;left:{css_left}px;top:{css_top}px;"
            f"width:{w}px;height:{h}px;"
            f"border:{min(stroke_width, 20)}px solid {stroke_color};"
            f"background:transparent;z-index:{z_index};visibility:hidden"
        )
        if abs(sx - 1) > 0.01 or abs(sy - 1) > 0.01:
            style += f";transform:scale({round(sx, 3)},{round(sy, 3)})"

    # ── Pre-comp layers (photo/video placeholders) ───────────────────────
    elif ltype == "precomp":
        css_left = round(px - ax, 2)
        css_top = round(py - ay, 2)
        w, h = parent_w, parent_h
        style = (
            f"position:absolute;left:{css_left}px;top:{css_top}px;"
            f"width:{w}px;height:{h}px;"
            f"background:#222;border:1px solid #333;"
            f"display:flex;align-items:center;justify-content:center;"
            f"z-index:{z_index};visibility:hidden"
        )
        inner = (
            f'<span style="font-family:sans-serif;font-size:16px;color:#555;">'
            f'{html_mod.escape(name)}</span>'
        )
        if abs(sx - 1) > 0.01 or abs(sy - 1) > 0.01:
            style += f";transform:scale({round(sx, 3)},{round(sy, 3)})"

    # ── Null layers (invisible) ──────────────────────────────────────────
    elif ltype == "null":
        style = "position:absolute;visibility:hidden;pointer-events:none"
        w, h = 0, 0

    # ── Unknown ──────────────────────────────────────────────────────────
    else:
        w, h = parent_w, parent_h
        style = (
            f"position:absolute;left:0;top:0;width:{w}px;height:{h}px;"
            f"background:rgba(50,50,50,0.3);z-index:{z_index};visibility:hidden"
        )

    element_html = (
        f'      <div id="{el_id}" data-start="{round(in_pt, 4)}" '
        f'data-duration="{round(dur, 4)}" data-track-index="{layer_idx}" '
        f'style="{style}">{inner}</div>'
    )

    # ── Mount/unmount via GSAP ───────────────────────────────────────────
    if ltype != "null":
        gsap_lines.append(
            f'      tl.set("#{el_id}", {{ visibility: "visible", opacity: {round(op, 4)} }}, {abs_in});'
        )
        if dur > 0:
            gsap_lines.append(
                f'      tl.set("#{el_id}", {{ visibility: "hidden" }}, {abs_out});'
            )

    # ── Keyframe animations ──────────────────────────────────────────────
    for prop_name in ["scale", "opacity", "rotation", "position"]:
        prop_data = transform.get(prop_name, {})
        if isinstance(prop_data, dict) and prop_data.get("keyframes"):
            tweens = generate_keyframe_tweens(
                f"#{el_id}",
                prop_name,
                prop_data["keyframes"],
                scene_start,  # absolute offset
            )
            gsap_lines.extend(tweens)

    return element_html, gsap_lines


# ── HTML generation ──────────────────────────────────────────────────────────


def generate_html(data: dict) -> str:
    """Generate a complete HyperFrames index.html from parsed .aepx JSON."""
    compositions = data.get("compositions", {})
    fonts = data.get("fonts", [])

    # Find the root composition
    root_comp = None
    for cid, comp in compositions.items():
        if comp["name"] == "Render":
            root_comp = comp
            break
    if root_comp is None:
        max_pc = -1
        for cid, comp in compositions.items():
            pc = sum(1 for l in comp.get("layers", []) if l["type"] == "precomp")
            if pc > max_pc:
                max_pc = pc
                root_comp = comp
    if root_comp is None:
        return "<!-- No root composition found -->"

    root_w = root_comp.get("width", 1920)
    root_h = root_comp.get("height", 1080)

    comp_by_name = {comp["name"]: comp for comp in compositions.values()}

    font_import = ""
    if fonts:
        families = "+".join(f.replace(" ", "+") + ":wght@900" for f in fonts)
        font_import = f'@import url("https://fonts.googleapis.com/css2?family={families}&display=swap");'

    all_html = []
    all_gsap = []
    comp_idx = 0
    num_scenes = sum(1 for l in root_comp.get("layers", []) if l["type"] == "precomp")

    for layer_idx, layer in enumerate(root_comp.get("layers", [])):
        if layer["type"] == "precomp":
            scene_name = layer.get("name", "")
            scene_comp = comp_by_name.get(scene_name)
            scene_start = layer.get("inPoint", 0)
            scene_duration = layer.get("outPoint", 0)
            if scene_duration <= 0:
                scene_duration = 5
            scene_end = round(scene_start + scene_duration, 4)

            scene_id = f"scene-{comp_idx}"
            scene_z = num_scenes - comp_idx  # first scene = highest z
            comp_idx += 1

            # Scene background: dark by default.
            # AE solid backgrounds often have expression-driven colors
            # that we can't resolve, so use a safe dark default.
            scene_bg = "#111111"

            initial_opacity = 1 if scene_start < 0.01 else 0
            all_html.append(
                f'    <!-- ═══ {scene_name} ({scene_start:.1f}-{scene_end:.1f}s) ═══ -->'
            )
            all_html.append(
                f'    <div id="{scene_id}" data-start="{round(scene_start, 4)}" '
                f'data-duration="{round(scene_duration, 4)}" data-track-index="{layer_idx}" '
                f'style="position:absolute;top:0;left:0;width:{root_w}px;height:{root_h}px;'
                f'overflow:hidden;background:{scene_bg};opacity:{initial_opacity};z-index:{scene_z};">'
            )

            all_gsap.append(f'      /* ═══ {scene_name} ({scene_start:.1f}-{scene_end:.1f}s) ═══ */')
            if initial_opacity == 0:
                all_gsap.append(f'      tl.set("#{scene_id}", {{ opacity: 1 }}, {round(scene_start, 4)});')

            if scene_comp:
                scene_layers = scene_comp.get("layers", [])
                total_layers = len(scene_layers)

                for sl_idx, sl in enumerate(scene_layers):
                    # Determine source comp for this layer
                    src_comp = scene_comp

                    if sl["type"] == "precomp":
                        nested_comp = comp_by_name.get(sl.get("name", ""))
                        if nested_comp and nested_comp.get("layers"):
                            nested_layer = nested_comp["layers"][0]
                            if nested_layer.get("type") == "text":
                                # Inline text content
                                sl = dict(sl)
                                sl["type"] = "text"
                                sl["textContent"] = nested_layer.get("textContent", sl.get("name", ""))
                                sl["fontFamily"] = nested_layer.get("fontFamily", "Montserrat")
                                sl["fontColor"] = nested_layer.get("fontColor", "#ffffff")
                                sl["fontSize"] = nested_layer.get("fontSize", 27)
                                src_comp = nested_comp

                    el_html, el_gsap = layer_to_html(
                        sl, src_comp, root_w, root_h,
                        comp_idx, sl_idx, total_layers,
                        scene_start,
                    )
                    all_html.append(el_html)
                    all_gsap.extend(el_gsap)

            fade_out_t = round(scene_end - 0.3, 4)
            all_gsap.append(f'      tl.to("#{scene_id}", {{ opacity: 0, duration: 0.3 }}, {fade_out_t});')
            all_gsap.append("")

            all_html.append("    </div>")
            all_html.append("")

        elif layer["type"] == "solid":
            el_html, el_gsap = layer_to_html(
                layer, root_comp, root_w, root_h,
                999, layer_idx, len(root_comp.get("layers", [])),
                0,
            )
            all_html.append(el_html)
            all_gsap.extend(el_gsap)

    max_end = max(
        (layer.get("inPoint", 0) + layer.get("outPoint", 0) for layer in root_comp.get("layers", [])),
        default=10,
    )

    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>{html_mod.escape(root_comp.get('name', 'HyperFrames'))}</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
    <style>
      {font_import}
      body, html {{
        margin: 0; padding: 0;
        background: #111; overflow: hidden;
        width: {root_w}px; height: {root_h}px;
      }}
      #root {{
        position: relative;
        width: {root_w}px; height: {root_h}px;
        background: #111; overflow: hidden;
      }}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="render"
      data-width="{root_w}" data-height="{root_h}" data-duration="{round(max_end, 2)}">
{chr(10).join(all_html)}
    </div>
    <script>
      window.__timelines = window.__timelines || {{}};
      var tl = gsap.timeline({{ paused: true }});

{chr(10).join(all_gsap)}

      window.__timelines["render"] = tl;
      window.__timeline = tl;
    </script>
  </body>
</html>"""


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-hyperframes.py <project.json> [output.html]", file=sys.stderr)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        data = json.load(f)

    html = generate_html(data)

    if len(sys.argv) >= 3:
        with open(sys.argv[2], "w") as f:
            f.write(html)
        print(f"Written to {sys.argv[2]}", file=sys.stderr)
    else:
        print(html)


if __name__ == "__main__":
    main()
