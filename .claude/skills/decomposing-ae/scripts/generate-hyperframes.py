#!/usr/bin/env python3
"""Generate a HyperFrames HTML composition from parsed .aepx JSON.

Usage:
    python3 parse-aepx.py input.aepx > project.json
    python3 generate-hyperframes.py project.json > index.html

Produces a single flat index.html with all animations driven by one GSAP timeline.
"""
import json
import sys
import html as html_mod


def easing_to_gsap(easing: dict) -> str:
    t = easing.get("type", "bezier")
    if t == "linear":
        return '"none"'
    return '"power2.inOut"'


def format_value_for_gsap(prop_name: str, value) -> str:
    """Convert a parsed value to GSAP tween property."""
    if prop_name == "opacity":
        return f"{value}"
    if prop_name == "rotation":
        return f"{value}"
    if prop_name == "scale":
        if isinstance(value, list) and len(value) >= 2:
            # GSAP scale is uniform — use average of X and Y
            sx, sy = value[0], value[1]
            if abs(sx - sy) < 0.01:
                return f"{sx}"
            return f"{sx}"  # use X scale
        return f"{value}"
    if prop_name == "position":
        if isinstance(value, list) and len(value) >= 2:
            return f"x: {value[0]}, y: {value[1]}"
        return f"{value}"
    if prop_name == "anchorPoint":
        if isinstance(value, list) and len(value) >= 2:
            return f"{value[0]}px {value[1]}px"
        return f"{value}"
    return f"{value}"


def generate_keyframe_tweens(
    element_id: str,
    prop_name: str,
    keyframes: list,
    parent_start: float,
) -> list[str]:
    """Generate GSAP tween lines from keyframe data."""
    lines = []
    gsap_prop = {
        "scale": "scale",
        "opacity": "opacity",
        "rotation": "rotation",
        "position": None,  # handled specially: x, y
    }.get(prop_name)

    if gsap_prop is None and prop_name == "position":
        # Generate x and y tweens
        for i, kf in enumerate(keyframes):
            t = round(parent_start + kf["time"], 4)
            val = kf["value"]
            ease = easing_to_gsap(kf.get("easing", {}))
            if isinstance(val, list) and len(val) >= 2:
                x, y = round(val[0], 2), round(val[1], 2)
            else:
                x, y = 0, 0
            if i == 0:
                lines.append(f'      tl.set("{element_id}", {{ x: {x}, y: {y} }}, {t});')
            else:
                prev_t = round(parent_start + keyframes[i - 1]["time"], 4)
                dur = round(t - prev_t, 4)
                if dur > 0:
                    lines.append(
                        f'      tl.to("{element_id}", {{ x: {x}, y: {y}, duration: {dur}, ease: {ease} }}, {prev_t});'
                    )
        return lines

    if gsap_prop is None:
        return lines

    for i, kf in enumerate(keyframes):
        t = round(parent_start + kf["time"], 4)
        val = kf["value"]
        ease = easing_to_gsap(kf.get("easing", {}))

        if gsap_prop == "scale":
            if isinstance(val, list) and len(val) >= 2:
                v = round(val[0], 4)
            else:
                v = round(val, 4) if isinstance(val, (int, float)) else val
        elif gsap_prop == "opacity":
            v = round(val, 4) if isinstance(val, (int, float)) else val
        elif gsap_prop == "rotation":
            v = round(val, 2) if isinstance(val, (int, float)) else val
        else:
            v = val

        if i == 0:
            lines.append(f'      tl.set("{element_id}", {{ {gsap_prop}: {v} }}, {t});')
        else:
            prev_t = round(parent_start + keyframes[i - 1]["time"], 4)
            dur = round(t - prev_t, 4)
            if dur > 0:
                lines.append(
                    f'      tl.to("{element_id}", {{ {gsap_prop}: {v}, duration: {dur}, ease: {ease} }}, {prev_t});'
                )

    return lines


def layer_to_html(layer: dict, comp: dict, comp_idx: int, layer_idx: int) -> tuple[str, list[str]]:
    """Convert a layer to HTML element + GSAP tween lines.

    Returns (html_string, list_of_gsap_lines).
    """
    el_id = f"c{comp_idx}-l{layer_idx}"
    ltype = layer["type"]
    name = layer.get("name", "")
    in_pt = layer.get("inPoint", 0)
    out_pt = layer.get("outPoint", 0)
    dur = round(out_pt - in_pt, 4) if out_pt > in_pt else round(out_pt, 4)

    transform = layer.get("transform", {})
    anchor = transform.get("anchorPoint", {}).get("value", [0, 0, 0])
    position = transform.get("position", {}).get("value", [0, 0, 0])
    scale_val = transform.get("scale", {}).get("value", [1, 1, 1])
    opacity_val = transform.get("opacity", {}).get("value", 1)
    rotation_val = transform.get("rotation", {}).get("value", 0)

    # CSS positioning from AE coordinates
    ax = anchor[0] if len(anchor) > 0 else 0
    ay = anchor[1] if len(anchor) > 1 else 0
    px = position[0] if len(position) > 0 else 0
    py = position[1] if len(position) > 1 else 0

    css_left = round(px - ax, 2)
    css_top = round(py - ay, 2)
    transform_origin = f"{round(ax, 2)}px {round(ay, 2)}px"

    sx = scale_val[0] if isinstance(scale_val, list) and len(scale_val) > 0 else 1
    sy = scale_val[1] if isinstance(scale_val, list) and len(scale_val) > 1 else 1
    op = opacity_val if isinstance(opacity_val, (int, float)) else 1
    rot = rotation_val if isinstance(rotation_val, (int, float)) else 0

    w = comp.get("width", 1920)
    h = comp.get("height", 1080)

    style_parts = [
        f"position:absolute",
        f"left:{css_left}px",
        f"top:{css_top}px",
        f"width:{w}px",
        f"height:{h}px",
        f"transform-origin:{transform_origin}",
        f"opacity:{round(op, 4)}",
    ]
    if abs(sx - 1) > 0.001 or abs(sy - 1) > 0.001:
        style_parts.append(f"transform:scale({round(sx, 4)},{round(sy, 4)})")
    if abs(rot) > 0.01:
        style_parts.append(f"transform:rotate({round(rot, 2)}deg)")

    gsap_lines = []

    # Content based on layer type
    if ltype == "text":
        text = html_mod.escape(layer.get("textContent", name))
        font = layer.get("fontFamily", "Montserrat")
        font_color = layer.get("fontColor", "#ffffff")
        font_size = layer.get("fontSize", 48)
        # Scale font size relative to comp height for visibility
        if h < 200:
            font_size = max(font_size, 36)

        inner = (
            f'<span style="font-family:\'{font}\',sans-serif;font-weight:900;'
            f"font-size:{font_size}px;color:{font_color};text-transform:uppercase;"
            f'letter-spacing:0.05em;white-space:nowrap;">{text}</span>'
        )
        style_parts.append("display:flex;align-items:center;justify-content:center")

    elif ltype == "solid":
        # Determine color from effects or default
        color = "#111111"
        for eff in layer.get("effects", []):
            eff_name = eff.get("displayName") or eff.get("name", "")
            if "Fill" in eff_name or "Tint" in eff_name:
                params = eff.get("params", {})
                if isinstance(params, list):
                    params = {str(i): p for i, p in enumerate(params)}
                for pname, pval in params.items():
                    if isinstance(pval, list) and len(pval) >= 3:
                        r, g, b = int(pval[0]), int(pval[1]), int(pval[2])
                        color = f"#{r:02x}{g:02x}{b:02x}"
                        break
        style_parts.append(f"background:{color}")
        inner = ""

    elif ltype == "shape":
        # Shape layers — render as colored div with border or background
        stroke = None
        fill_color = None
        for sg in layer.get("shapeGroups", []):
            if sg.get("stroke"):
                stroke = sg["stroke"]
            if sg.get("fill"):
                fill_color = sg["fill"]

        if stroke and stroke.get("color"):
            sc = stroke["color"]
            if isinstance(sc, list) and len(sc) >= 3:
                r, g, b = int(sc[0]), int(sc[1]), int(sc[2])
                sw = stroke.get("width", 2)
                if isinstance(sw, list):
                    sw = 2
                style_parts.append(f"border:{int(sw)}px solid #{r:02x}{g:02x}{b:02x}")
                style_parts.append("background:transparent")
        elif fill_color:
            style_parts.append(f"background:#ff3333")
        else:
            style_parts.append("border:2px solid #ffffff")
            style_parts.append("background:transparent")
        inner = ""

    elif ltype == "precomp":
        # Pre-comp reference — render as placeholder or nested content
        style_parts.append("background:rgba(30,30,30,0.8)")
        inner = (
            f'<span style="font-family:monospace;font-size:14px;color:#555;'
            f'position:absolute;bottom:8px;right:8px;">{html_mod.escape(name)}</span>'
        )

    elif ltype == "null":
        # Null object — invisible
        style_parts.append("pointer-events:none")
        inner = ""
        op = 0

    else:
        inner = ""
        style_parts.append("background:rgba(50,50,50,0.5)")

    style = ";".join(style_parts)
    element_html = (
        f'    <div id="{el_id}" data-start="{round(in_pt, 4)}" '
        f'data-duration="{round(dur, 4)}" data-track-index="{layer_idx}" '
        f'style="{style}">{inner}</div>'
    )

    # Generate GSAP tweens from keyframes
    for prop_name in ["scale", "opacity", "rotation", "position"]:
        prop_data = transform.get(prop_name, {})
        if isinstance(prop_data, dict) and prop_data.get("keyframes"):
            tweens = generate_keyframe_tweens(
                f"#{el_id}",
                prop_name,
                prop_data["keyframes"],
                0,  # parent_start=0 since we'll offset by scene start in the master timeline
            )
            gsap_lines.extend(tweens)

    return element_html, gsap_lines


def generate_html(data: dict) -> str:
    """Generate a complete HyperFrames index.html from parsed .aepx JSON."""
    compositions = data.get("compositions", {})
    fonts = data.get("fonts", [])

    # Find the root composition (Render or the one with most precomp references)
    root_comp = None
    root_cid = None
    for cid, comp in compositions.items():
        if comp["name"] == "Render":
            root_comp = comp
            root_cid = cid
            break

    if root_comp is None:
        # Fallback: find the comp with most precomp layers
        max_precomps = -1
        for cid, comp in compositions.items():
            pc = sum(1 for l in comp.get("layers", []) if l["type"] == "precomp")
            if pc > max_precomps:
                max_precomps = pc
                root_comp = comp
                root_cid = cid

    if root_comp is None:
        return "<!-- No root composition found -->"

    root_w = root_comp.get("width", 1920)
    root_h = root_comp.get("height", 1080)
    root_dur = root_comp.get("duration", 10)

    # Build name→comp lookup
    comp_by_name = {}
    for cid, comp in compositions.items():
        comp_by_name[comp["name"]] = comp

    # Build font import
    font_import = ""
    if fonts:
        families = "+".join(f.replace(" ", "+") + ":wght@900" for f in fonts)
        font_import = f'@import url("https://fonts.googleapis.com/css2?family={families}&display=swap");'

    # Generate all HTML elements and GSAP tweens
    all_html = []
    all_gsap = []
    comp_idx = 0

    # Process root comp layers — each precomp becomes a scene
    for layer_idx, layer in enumerate(root_comp.get("layers", [])):
        if layer["type"] == "precomp":
            scene_name = layer.get("name", "")
            scene_comp = comp_by_name.get(scene_name)
            scene_start = layer.get("inPoint", 0)
            scene_dur = layer.get("outPoint", 0)
            if scene_dur <= scene_start:
                scene_dur = scene_start + 5

            scene_id = f"scene-{comp_idx}"
            comp_idx += 1

            all_html.append(
                f'    <!-- ═══ {scene_name} ({scene_start:.1f}-{scene_dur:.1f}s) ═══ -->'
            )
            all_html.append(
                f'    <div id="{scene_id}" data-start="{round(scene_start, 4)}" '
                f'data-duration="{round(scene_dur - scene_start, 4)}" data-track-index="{layer_idx}" '
                f'style="position:absolute;top:0;left:0;width:{root_w}px;height:{root_h}px;'
                f'overflow:hidden;opacity:0;">'
            )

            # Scene fade in/out
            all_gsap.append(f'      /* {scene_name} */')
            all_gsap.append(f'      tl.to("#{scene_id}", {{ opacity: 1, duration: 0.01 }}, {round(scene_start, 4)});')

            if scene_comp:
                # Process scene layers
                for sl_idx, sl in enumerate(scene_comp.get("layers", [])):
                    if sl["type"] == "precomp":
                        # Nested precomp — check if it's a text comp
                        nested_comp = comp_by_name.get(sl.get("name", ""))
                        if nested_comp and nested_comp.get("layers"):
                            nested_layer = nested_comp["layers"][0]
                            if nested_layer.get("type") == "text":
                                # Inline the text content
                                sl_copy = dict(sl)
                                sl_copy["type"] = "text"
                                sl_copy["textContent"] = nested_layer.get("textContent", sl.get("name", ""))
                                sl_copy["fontFamily"] = nested_layer.get("fontFamily", "Montserrat")
                                sl_copy["fontColor"] = nested_layer.get("fontColor", "#ffffff")
                                sl_copy["fontSize"] = nested_layer.get("fontSize", 48)
                                el_html, el_gsap = layer_to_html(sl_copy, nested_comp, comp_idx, sl_idx)
                            else:
                                el_html, el_gsap = layer_to_html(sl, root_comp, comp_idx, sl_idx)
                        else:
                            el_html, el_gsap = layer_to_html(sl, root_comp, comp_idx, sl_idx)
                    else:
                        el_html, el_gsap = layer_to_html(sl, scene_comp, comp_idx, sl_idx)

                    all_html.append(el_html)

                    # Offset GSAP lines by scene start time
                    for line in el_gsap:
                        # Replace time values: tl.to/set("...", {...}, TIME)
                        # Add scene_start to the position parameter
                        import re
                        def offset_time(m):
                            t = float(m.group(1))
                            return f", {round(t + scene_start, 4)});"
                        line = re.sub(r',\s*([\d.]+)\);$', offset_time, line)
                        all_gsap.append(line)

            # Scene fade out
            fade_out_t = round(scene_dur - 0.3, 4)
            all_gsap.append(f'      tl.to("#{scene_id}", {{ opacity: 0, duration: 0.3 }}, {fade_out_t});')
            all_gsap.append("")

            all_html.append("    </div>")
            all_html.append("")

        elif layer["type"] == "solid":
            # Root-level solid (e.g., Color Control)
            el_html, el_gsap = layer_to_html(layer, root_comp, 999, layer_idx)
            all_html.append(el_html)
            all_gsap.extend(el_gsap)

    # Calculate total duration from the furthest scene end
    max_end = root_dur
    for layer in root_comp.get("layers", []):
        end = layer.get("inPoint", 0) + layer.get("outPoint", 0)
        max_end = max(max_end, end)

    html_output = f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>{root_comp.get('name', 'HyperFrames Composition')}</title>
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

    return html_output


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-hyperframes.py <project.json> [output.html]", file=sys.stderr)
        sys.exit(1)

    json_path = sys.argv[1]
    with open(json_path) as f:
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
