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

export interface ElementStyle {
  background_color: SceneColor | null;
  opacity: number;
  border_radius: [number, number, number, number];
  overflow_hidden: boolean;
  transform: Transform2D | null;
  visibility: boolean;
  font_family: string | null;
  font_size: number | null;
  font_weight: number | null;
  color: SceneColor | null;
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
}

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

  const elements = await page.evaluate(() => {
    // These helpers must be inlined — page.evaluate serializes the function
    // body and runs it in the browser context with no access to outer scope.

    function _parseColor(cssColor: string): { r: number; g: number; b: number; a: number } | null {
      const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return {
        r: +m[1],
        g: +m[2],
        b: +m[3],
        a: Math.round((m[4] !== undefined ? +m[4] : 1) * 255),
      };
    }

    function _parseTransform(raw: string) {
      if (raw === "none") return null;
      let tx = 0,
        ty = 0,
        sx = 1,
        sy = 1,
        rot = 0;
      const mat = raw.match(
        /matrix\(\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+),\s*([-\d.e]+)\)/,
      );
      if (mat) {
        const a = +mat[1],
          b = +mat[2],
          c = +mat[3],
          d = +mat[4];
        tx = +mat[5];
        ty = +mat[6];
        sx = Math.sqrt(a * a + b * b);
        sy = Math.sqrt(c * c + d * d);
        rot = (Math.atan2(b, a) * 180) / Math.PI;
      }
      if (tx === 0 && ty === 0 && sx === 1 && sy === 1 && rot === 0) return null;
      return { translate_x: tx, translate_y: ty, scale_x: sx, scale_y: sy, rotate_deg: rot };
    }

    type _Kind =
      | { type: "Container" }
      | { type: "Text"; content: string }
      | { type: "Image"; src: string }
      | { type: "Video"; src: string };

    interface _El {
      id: string;
      kind: _Kind;
      bounds: { x: number; y: number; width: number; height: number };
      style: {
        background_color: { r: number; g: number; b: number; a: number } | null;
        opacity: number;
        border_radius: [number, number, number, number];
        overflow_hidden: boolean;
        transform: {
          translate_x: number;
          translate_y: number;
          scale_x: number;
          scale_y: number;
          rotate_deg: number;
        } | null;
        visibility: boolean;
        font_family: string | null;
        font_size: number | null;
        font_weight: number | null;
        color: { r: number; g: number; b: number; a: number } | null;
      };
      children: _El[];
    }

    function _extract(el: HTMLElement): _El | null {
      const cs = getComputedStyle(el);
      if (cs.display === "none") return null;

      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();

      let kind: _Kind;
      if (tag === "video") {
        kind = {
          type: "Video",
          src: (el as HTMLVideoElement).currentSrc || (el as HTMLVideoElement).src || "",
        };
      } else if (tag === "img") {
        kind = {
          type: "Image",
          src: (el as HTMLImageElement).currentSrc || (el as HTMLImageElement).src || "",
        };
      } else if (
        el.childNodes.length > 0 &&
        Array.from(el.childNodes).every((n) => n.nodeType === Node.TEXT_NODE) &&
        (el.textContent?.trim() ?? "").length > 0
      ) {
        kind = { type: "Text", content: el.textContent!.trim() };
      } else {
        kind = { type: "Container" };
      }

      const id =
        el.getAttribute("data-name") ||
        el.id ||
        `${tag}-${Math.round(rect.x)}-${Math.round(rect.y)}`;

      const bgColor = _parseColor(cs.backgroundColor);
      const textColor = _parseColor(cs.color);
      const transform = _parseTransform(cs.transform);
      const opacity = parseFloat(cs.opacity) || 0;
      const visible = cs.visibility !== "hidden" && opacity > 0;
      const isText = kind.type === "Text";

      const style = {
        background_color: bgColor,
        opacity,
        border_radius: [
          parseFloat(cs.borderTopLeftRadius) || 0,
          parseFloat(cs.borderTopRightRadius) || 0,
          parseFloat(cs.borderBottomRightRadius) || 0,
          parseFloat(cs.borderBottomLeftRadius) || 0,
        ] as [number, number, number, number],
        overflow_hidden: cs.overflow === "hidden" || cs.overflow === "clip",
        transform,
        visibility: visible,
        font_family: isText
          ? cs.fontFamily.replace(/['"]/g, "").split(",")[0].trim() || null
          : null,
        font_size: isText ? parseFloat(cs.fontSize) || null : null,
        font_weight: isText ? parseInt(cs.fontWeight, 10) || null : null,
        color: isText ? textColor : null,
      };

      const children: _El[] = [];
      if (kind.type === "Container") {
        for (const child of Array.from(el.children) as HTMLElement[]) {
          const extracted = _extract(child);
          if (extracted) children.push(extracted);
        }
      }

      return {
        id,
        kind,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style,
        children,
      };
    }

    const root = document.querySelector<HTMLElement>("[data-composition-id]") ?? document.body;

    const results: _El[] = [];
    for (const child of Array.from(root.children) as HTMLElement[]) {
      const extracted = _extract(child);
      if (extracted) results.push(extracted);
    }
    return results;
  });

  return { width, height, elements };
}
