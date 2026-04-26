/**
 * CDP scene extraction — walks a Chrome page's DOM via Puppeteer and produces
 * a JSON scene graph that the Rust `parse_scene_json()` function can consume.
 */
import type { Page } from "puppeteer-core";

// ---------------------------------------------------------------------------
// Types — mirrors the Rust scene graph in packages/native-renderer/src/scene/mod.rs
// ---------------------------------------------------------------------------

export interface SceneColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Transform2D {
  translate_x: number;
  translate_y: number;
  scale_x: number;
  scale_y: number;
  rotate_deg: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BoxShadow {
  offset_x: number;
  offset_y: number;
  blur_radius: number;
  spread_radius: number;
  color: SceneColor;
}

export interface Border {
  width: number;
  color: SceneColor;
  style: "solid" | "dashed";
}

export type ClipPath =
  | { type: "Polygon"; points: Array<{ x: number; y: number }> }
  | { type: "Circle"; x: number; y: number; radius: number }
  | { type: "Ellipse"; x: number; y: number; radius_x: number; radius_y: number };

export type Gradient =
  | { type: "Linear"; angle_deg: number; stops: GradientStop[] }
  | { type: "Radial"; stops: GradientStop[] };

export interface GradientStop {
  position: number;
  color: SceneColor;
}

export interface FilterAdjust {
  brightness: number;
  contrast: number;
  saturate: number;
}

export interface TextStroke {
  width: number;
  color: SceneColor;
}

export type ObjectFit = "fill" | "contain" | "cover" | "none" | "scale_down";

export type BackgroundImageFit = "fill" | "contain" | "cover" | "none";

export interface ObjectPosition {
  x: number;
  y: number;
}

export interface BackgroundImage {
  src: string;
  fit: BackgroundImageFit;
  position: ObjectPosition;
}

export type MixBlendMode =
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color_dodge"
  | "color_burn"
  | "hard_light"
  | "soft_light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export interface ElementStyle {
  background_color: SceneColor | null;
  opacity: number;
  border_radius: [number, number, number, number];
  border?: Border | null;
  overflow_hidden: boolean;
  clip_path?: ClipPath | null;
  transform: Transform2D | null;
  visibility: boolean;
  font_family: string | null;
  font_size: number | null;
  font_weight: number | null;
  color: SceneColor | null;
  text_shadow?: BoxShadow | null;
  text_stroke?: TextStroke | null;
  box_shadow?: BoxShadow | null;
  filter_blur?: number | null;
  filter_adjust?: FilterAdjust | null;
  background_image?: BackgroundImage | null;
  background_gradient?: Gradient | null;
  object_fit?: ObjectFit | null;
  object_position?: ObjectPosition | null;
  mix_blend_mode?: MixBlendMode | null;
  letter_spacing?: number | null;
  line_height?: number | null;
  padding_left?: number | null;
  padding_top?: number | null;
  text_align?: string | null;
  data_start?: number | null;
  data_end?: number | null;
  video_frames_dir?: string | null;
  video_fps?: number | null;
  video_media_start?: number | null;
}

export interface FontDescriptor {
  family: string;
  path: string;
  weight: number;
  style: string;
}

/**
 * Discriminated element kind — matches Rust `ElementKind` which uses
 * `#[serde(tag = "type")]` internally-tagged enum.
 */
export type ElementKind =
  | { type: "Container" }
  | { type: "Text"; content: string }
  | { type: "Image"; src: string }
  | { type: "Video"; src: string };

export interface SceneElement {
  id: string;
  kind: ElementKind;
  bounds: Rect;
  style: ElementStyle;
  children: SceneElement[];
}

export interface ExtractedScene {
  width: number;
  height: number;
  elements: SceneElement[];
  fonts: FontDescriptor[];
}

// String-based evaluate avoids tsx/esbuild injecting `__name` helpers into the
// function body that Puppeteer serializes into the browser context.
const EXTRACT_SCENE_SCRIPT = `(() => {
  function parseColor(cssColor) {
    if (!cssColor || cssColor === "transparent") return null;
    const m = cssColor.match(/rgba?\\(\\s*([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\s*\\)/);
    if (!m) return null;
    return {
      r: Math.round(+m[1]),
      g: Math.round(+m[2]),
      b: Math.round(+m[3]),
      a: Math.round((m[4] !== undefined ? +m[4] : 1) * 255),
    };
  }

  function parseTransform(raw) {
    if (raw === "none") return null;
    let tx = 0;
    let ty = 0;
    let sx = 1;
    let sy = 1;
    let rot = 0;
    const mat = raw.match(
      /matrix\\(\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+)\\)/,
    );
    if (mat) {
      const a = +mat[1];
      const b = +mat[2];
      const c = +mat[3];
      const d = +mat[4];
      tx = +mat[5];
      ty = +mat[6];
      sx = Math.sqrt(a * a + b * b);
      sy = Math.sqrt(c * c + d * d);
      rot = (Math.atan2(b, a) * 180) / Math.PI;
    }
    if (tx === 0 && ty === 0 && sx === 1 && sy === 1 && rot === 0) return null;
    return { translate_x: tx, translate_y: ty, scale_x: sx, scale_y: sy, rotate_deg: rot };
  }

  function splitTopLevel(input) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        parts.push(input.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(input.slice(start).trim());
    return parts.filter(Boolean);
  }

  function firstColorToken(raw) {
    return raw.match(/rgba?\\([^)]*\\)/)?.[0] ?? null;
  }

  function parseShadow(raw) {
    if (!raw || raw === "none") return null;
    const firstShadow = splitTopLevel(raw)[0];
    if (!firstShadow || /\\binset\\b/.test(firstShadow)) return null;
    const colorToken = firstColorToken(firstShadow);
    const color = colorToken ? parseColor(colorToken) : { r: 0, g: 0, b: 0, a: 255 };
    if (!color) return null;
    const withoutColor = colorToken ? firstShadow.replace(colorToken, "") : firstShadow;
    const lengths = Array.from(withoutColor.matchAll(/(-?[\\d.]+)px/g)).map((m) => +m[1]);
    if (lengths.length < 2) return null;
    return {
      offset_x: lengths[0] || 0,
      offset_y: lengths[1] || 0,
      blur_radius: lengths[2] || 0,
      spread_radius: lengths[3] || 0,
      color,
    };
  }

  function parseFilterValue(raw) {
    const value = raw.trim();
    if (value.endsWith("%")) return (parseFloat(value) || 0) / 100;
    return Number.isFinite(parseFloat(value)) ? parseFloat(value) : 1;
  }

  function parseFilter(raw) {
    if (!raw || raw === "none") return { blur: null, adjust: null };
    let blur = null;
    let brightness = 1;
    let contrast = 1;
    let saturate = 1;

    for (const match of raw.matchAll(/([a-z-]+)\\(([^)]*)\\)/g)) {
      const name = match[1];
      const value = match[2];
      if (name === "blur") blur = parseFloat(value) || null;
      if (name === "brightness") brightness = parseFilterValue(value);
      if (name === "contrast") contrast = parseFilterValue(value);
      if (name === "saturate") saturate = parseFilterValue(value);
    }

    const adjust =
      brightness !== 1 || contrast !== 1 || saturate !== 1
        ? { brightness, contrast, saturate }
        : null;
    return { blur, adjust };
  }

  function parseGradientStop(raw, index, total) {
    const colorToken = firstColorToken(raw);
    const color = colorToken ? parseColor(colorToken) : null;
    if (!color) return null;
    const withoutColor = raw.replace(colorToken, "").trim();
    const stopMatch = withoutColor.match(/(-?[\\d.]+)%/);
    const fallback = total <= 1 ? 0 : index / (total - 1);
    return {
      position: stopMatch ? Math.max(0, Math.min(1, +stopMatch[1] / 100)) : fallback,
      color,
    };
  }

  function parseGradient(raw) {
    if (!raw || raw === "none") return null;

    const linear = raw.match(/^linear-gradient\\((.*)\\)$/);
    if (linear) {
      const parts = splitTopLevel(linear[1]);
      let angleDeg = 180;
      let stopParts = parts;
      const first = parts[0] || "";
      if (/^-?[\\d.]+deg$/.test(first)) {
        angleDeg = parseFloat(first);
        stopParts = parts.slice(1);
      } else if (first.startsWith("to ")) {
        if (first.includes("right")) angleDeg = 90;
        else if (first.includes("left")) angleDeg = 270;
        else if (first.includes("top")) angleDeg = 0;
        else if (first.includes("bottom")) angleDeg = 180;
        stopParts = parts.slice(1);
      }
      const stops = stopParts
        .map((part, index) => parseGradientStop(part, index, stopParts.length))
        .filter(Boolean);
      return stops.length >= 2 ? { type: "Linear", angle_deg: angleDeg, stops } : null;
    }

    const radial = raw.match(/^radial-gradient\\((.*)\\)$/);
    if (radial) {
      const parts = splitTopLevel(radial[1]);
      const stopParts = parts.filter((part) => firstColorToken(part));
      const stops = stopParts
        .map((part, index) => parseGradientStop(part, index, stopParts.length))
        .filter(Boolean);
      return stops.length >= 2 ? { type: "Radial", stops } : null;
    }

    return null;
  }

  function parseCssUrl(raw) {
    const firstLayer = splitTopLevel(raw || "")[0];
    const match = firstLayer?.match(/^url\\((.*)\\)$/);
    if (!match) return null;
    const unquoted = match[1].trim().replace(/^['"]|['"]$/g, "");
    try {
      const url = new URL(unquoted, document.baseURI);
      if (url.protocol === "file:") return decodeURIComponent(url.pathname);
      return url.href;
    } catch {
      return unquoted || null;
    }
  }

  function parseBackgroundSize(raw) {
    const first = splitTopLevel(raw || "")[0] || "cover";
    if (first === "cover" || first === "contain") return first;
    if (first === "auto") return "none";
    if (first === "100% 100%" || first === "100%") return "fill";
    return "cover";
  }

  function parseBackgroundImage(cs, width, height) {
    if (!cs.backgroundImage || cs.backgroundImage === "none") return null;
    if (/^(linear-gradient|radial-gradient)\\(/.test(cs.backgroundImage)) return null;
    const src = parseCssUrl(cs.backgroundImage);
    if (!src) return null;
    return {
      src,
      fit: parseBackgroundSize(cs.backgroundSize),
      position: parseObjectPosition(cs.backgroundPosition, width, height),
    };
  }

  function parseBorder(cs) {
    const width = parseFloat(cs.borderTopWidth) || 0;
    const style = cs.borderTopStyle;
    if (width <= 0 || (style !== "solid" && style !== "dashed")) return null;
    const color = parseColor(cs.borderTopColor);
    if (!color || color.a === 0) return null;
    return { width, color, style };
  }

  function lengthOrPercent(token, basis) {
    const value = token.trim();
    if (value.endsWith("%")) return (parseFloat(value) / 100) * basis;
    if (value.endsWith("px")) return parseFloat(value) || 0;
    const number = parseFloat(value);
    return Number.isFinite(number) ? number : 0;
  }

  function parseClipPath(raw, width, height) {
    if (!raw || raw === "none") return null;

    const polygon = raw.match(/^polygon\\((.*)\\)$/);
    if (polygon) {
      const points = splitTopLevel(polygon[1])
        .map((pair) => pair.trim().split(/\\s+/))
        .filter((pair) => pair.length >= 2)
        .map(([x, y]) => ({ x: lengthOrPercent(x, width), y: lengthOrPercent(y, height) }));
      return points.length >= 3 ? { type: "Polygon", points } : null;
    }

    const circle = raw.match(/^circle\\((.*)\\)$/);
    if (circle) {
      const parts = circle[1].split(/\\s+at\\s+/);
      const radius = lengthOrPercent(parts[0] || "50%", Math.min(width, height));
      const center = (parts[1] || "50% 50%").trim().split(/\\s+/);
      return {
        type: "Circle",
        x: lengthOrPercent(center[0] || "50%", width),
        y: lengthOrPercent(center[1] || "50%", height),
        radius,
      };
    }

    const ellipse = raw.match(/^ellipse\\((.*)\\)$/);
    if (ellipse) {
      const parts = ellipse[1].split(/\\s+at\\s+/);
      const radii = (parts[0] || "50% 50%").trim().split(/\\s+/);
      const center = (parts[1] || "50% 50%").trim().split(/\\s+/);
      return {
        type: "Ellipse",
        x: lengthOrPercent(center[0] || "50%", width),
        y: lengthOrPercent(center[1] || "50%", height),
        radius_x: lengthOrPercent(radii[0] || "50%", width),
        radius_y: lengthOrPercent(radii[1] || radii[0] || "50%", height),
      };
    }

    return null;
  }

  function parseObjectFit(raw) {
    if (raw === "scale-down") return "scale_down";
    if (raw === "fill" || raw === "contain" || raw === "cover" || raw === "none") return raw;
    return null;
  }

  function parsePositionToken(token, basis, axis) {
    const value = token.trim();
    if (value === "left" || value === "top") return 0;
    if (value === "center") return 0.5;
    if (value === "right" || value === "bottom") return 1;
    if (value.endsWith("%")) return Math.max(0, Math.min(1, parseFloat(value) / 100));
    if (value.endsWith("px")) return Math.max(0, Math.min(1, (parseFloat(value) || 0) / basis));
    if (axis === "x" && value === "start") return 0;
    if (axis === "x" && value === "end") return 1;
    return 0.5;
  }

  function parseObjectPosition(raw, width, height) {
    const parts = (raw || "50% 50%").trim().split(/\\s+/);
    if (parts.length === 1) parts.push("50%");
    return {
      x: parsePositionToken(parts[0], width, "x"),
      y: parsePositionToken(parts[1], height, "y"),
    };
  }

  function parseTextStroke(cs) {
    const width = parseFloat(cs.getPropertyValue("-webkit-text-stroke-width")) || 0;
    if (width <= 0) return null;
    const color = parseColor(cs.getPropertyValue("-webkit-text-stroke-color"));
    return color ? { width, color } : null;
  }

  function parseMixBlendMode(raw) {
    if (!raw || raw === "normal") return null;
    const mapped = raw.replace(/-/g, "_");
    const supported = new Set([
      "multiply",
      "screen",
      "overlay",
      "darken",
      "lighten",
      "color_dodge",
      "color_burn",
      "hard_light",
      "soft_light",
      "difference",
      "exclusion",
      "hue",
      "saturation",
      "color",
      "luminosity",
    ]);
    return supported.has(mapped) ? mapped : null;
  }

  function extract(el, parentRect) {
    const cs = getComputedStyle(el);
    if (cs.display === "none") return null;

    const tag = el.tagName.toLowerCase();
    const rect = el.getBoundingClientRect();
    const bounds = {
      x: rect.x - parentRect.x,
      y: rect.y - parentRect.y,
      width: rect.width,
      height: rect.height,
    };

    let kind;
    if (tag === "video") {
      kind = {
        type: "Video",
        src: el.currentSrc || el.src || "",
      };
    } else if (tag === "img") {
      kind = {
        type: "Image",
        src: el.currentSrc || el.src || "",
      };
    } else if (
      el.childNodes.length > 0 &&
      Array.from(el.childNodes).every((n) => n.nodeType === Node.TEXT_NODE) &&
      (el.textContent?.trim() ?? "").length > 0
    ) {
      kind = { type: "Text", content: el.textContent.trim() };
    } else {
      kind = { type: "Container" };
    }

    const id =
      el.getAttribute("data-name") ||
      el.id ||
      tag + "-" + Math.round(rect.x) + "-" + Math.round(rect.y);

    const bgColor = parseColor(cs.backgroundColor);
    const textColor = parseColor(cs.color);
    const transform = parseTransform(cs.transform);
    const opacity = parseFloat(cs.opacity) || 0;
    const visible = cs.visibility !== "hidden" && opacity > 0;
    const isText = kind.type === "Text";
    const filter = parseFilter(cs.filter);
    const backgroundGradient = parseGradient(cs.backgroundImage);
    const backgroundImage = parseBackgroundImage(cs, rect.width, rect.height);

    const style = {
      background_color: bgColor,
      opacity,
      border_radius: [
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderTopRightRadius) || 0,
        parseFloat(cs.borderBottomRightRadius) || 0,
        parseFloat(cs.borderBottomLeftRadius) || 0,
      ],
      border: parseBorder(cs),
      overflow_hidden: cs.overflow === "hidden" || cs.overflow === "clip",
      clip_path: parseClipPath(cs.clipPath, rect.width, rect.height),
      transform,
      visibility: visible,
      font_family: isText
        ? cs.fontFamily.replace(/['"]/g, "").split(",")[0].trim() || null
        : null,
      font_size: isText ? parseFloat(cs.fontSize) || null : null,
      font_weight: isText ? parseInt(cs.fontWeight, 10) || null : null,
      color: isText ? textColor : null,
      text_shadow: isText ? parseShadow(cs.textShadow) : null,
      text_stroke: isText ? parseTextStroke(cs) : null,
      box_shadow: parseShadow(cs.boxShadow),
      filter_blur: filter.blur,
      filter_adjust: filter.adjust,
      background_image: backgroundImage,
      background_gradient: backgroundGradient,
      object_fit: kind.type === "Image" || kind.type === "Video" ? parseObjectFit(cs.objectFit) : null,
      object_position:
        kind.type === "Image" || kind.type === "Video"
          ? parseObjectPosition(cs.objectPosition, rect.width, rect.height)
          : null,
      mix_blend_mode: parseMixBlendMode(cs.mixBlendMode),
      letter_spacing: isText ? (parseFloat(cs.letterSpacing) || null) : null,
      line_height: isText && cs.lineHeight !== "normal" ? (parseFloat(cs.lineHeight) || null) : null,
      padding_left: parseFloat(cs.paddingLeft) || null,
      padding_top: parseFloat(cs.paddingTop) || null,
      text_align: cs.textAlign !== "start" ? cs.textAlign : null,
      data_start: el.hasAttribute("data-start") ? parseFloat(el.getAttribute("data-start")) || null : null,
      data_end: el.hasAttribute("data-end") ? parseFloat(el.getAttribute("data-end")) || null : null,
      video_frames_dir: el.getAttribute("data-video-frames-dir") || null,
      video_fps: el.hasAttribute("data-video-fps") ? parseFloat(el.getAttribute("data-video-fps")) || null : null,
      video_media_start: el.hasAttribute("data-media-start") ? parseFloat(el.getAttribute("data-media-start")) || null : null,
    };

    const children = [];
    if (kind.type === "Container") {
      for (const child of Array.from(el.children)) {
        const extracted = extract(child, rect);
        if (extracted) children.push(extracted);
      }
    }

    return {
      id,
      kind,
      bounds,
      style,
      children,
    };
  }

  function collectFontFamilies(elements) {
    const seen = new Set();
    function walk(els) {
      for (const el of els) {
        if (el.style.font_family) seen.add(el.style.font_family + ":" + (el.style.font_weight || 400));
        walk(el.children);
      }
    }
    walk(elements);
    return Array.from(seen).map((entry) => {
      const [family, weight] = entry.split(":");
      return { family, path: "", weight: parseInt(weight, 10) || 400, style: "normal" };
    });
  }

  const root = document.querySelector("[data-composition-id]") ?? document.body;
  const rootRect = root.getBoundingClientRect();

  const extractedRoot = extract(root, { x: 0, y: 0 });
  const elements = extractedRoot ? [extractedRoot] : [];
  const fonts = collectFontFamilies(elements);
  return { elements, fonts };
})()`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract a scene graph from a Chrome page via CDP.
 *
 * Walks the DOM starting at `[data-composition-id]` (or `document.body`) and
 * produces a JSON-serializable object that the Rust `parse_scene_json()` can
 * consume directly.
 */
export async function extractScene(
  page: Page,
  width: number,
  height: number,
): Promise<ExtractedScene> {
  await page.setViewport({ width, height });

  const result = (await page.evaluate(EXTRACT_SCENE_SCRIPT)) as {
    elements: SceneElement[];
    fonts: FontDescriptor[];
  };

  return { width, height, elements: result.elements, fonts: result.fonts };
}

/**
 * Map of video `src` URL to pre-extracted frame metadata, used by the producer
 * to inject frame directory paths after extraction but before serialisation to
 * the Rust renderer.
 */
export interface VideoFramesMeta {
  framesDir: string;
  fps: number;
  mediaStart?: number;
}

/**
 * Walk a scene and inject pre-extracted video frame metadata into every
 * `Video` element whose `src` matches a key in `videoFramesMap`.
 *
 * Mutates the scene in-place and returns it for chaining.
 */
export function injectVideoFramesMeta(
  scene: ExtractedScene,
  videoFramesMap: Record<string, VideoFramesMeta>,
): ExtractedScene {
  function walk(elements: SceneElement[]) {
    for (const el of elements) {
      if (el.kind.type === "Video" && el.kind.src in videoFramesMap) {
        const meta = videoFramesMap[el.kind.src];
        el.style.video_frames_dir = meta.framesDir;
        el.style.video_fps = meta.fps;
        if (meta.mediaStart !== undefined) {
          el.style.video_media_start = meta.mediaStart;
        }
      }
      walk(el.children);
    }
  }
  walk(scene.elements);
  return scene;
}
