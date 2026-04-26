/**
 * Native renderer support detection.
 *
 * The native path must be conservative: if Chrome exposes a feature the Rust
 * compositor cannot paint faithfully yet, callers should fall back to the CDP
 * renderer instead of producing wrong frames.
 */
import type { Page } from "puppeteer-core";

export interface NativeUnsupportedReason {
  elementId: string;
  property: string;
  value: string;
  reason: string;
}

export interface NativeSupportReport {
  supported: boolean;
  reasons: NativeUnsupportedReason[];
}

const DETECT_NATIVE_SUPPORT_SCRIPT = `(() => {
  const supportedFilters = new Set(["blur", "brightness", "contrast", "saturate"]);
  const supportedBlendModes = new Set([
    "normal",
    "multiply",
    "screen",
    "overlay",
    "darken",
    "lighten",
    "color-dodge",
    "color-burn",
    "hard-light",
    "soft-light",
    "difference",
    "exclusion",
    "hue",
    "saturation",
    "color",
    "luminosity",
  ]);

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

  function elementId(el) {
    const tag = el.tagName.toLowerCase();
    const rect = el.getBoundingClientRect();
    return (
      el.getAttribute("data-name") ||
      el.id ||
      tag + "-" + Math.round(rect.x) + "-" + Math.round(rect.y)
    );
  }

  function isTransparentColor(value) {
    if (!value || value === "transparent") return true;
    const rgba = value.match(/^rgba?\\(([^)]+)\\)$/);
    if (!rgba) return false;
    const parts = rgba[1].split(",").map((part) => part.trim());
    if (parts.length < 4) return false;
    return Number(parts[3]) < 1;
  }

  function hasDirectText(el) {
    return Array.from(el.childNodes).some((node) => {
      return node.nodeType === Node.TEXT_NODE && !!node.textContent.trim();
    });
  }

  function directTextLineCount(el) {
    let count = 0;
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      count += range.getClientRects().length;
      range.detach();
    }
    return count;
  }

  const reasons = [];
  const compositionRoot = document.querySelector("[data-composition-id]");
  function add(el, property, value, reason) {
    reasons.push({
      elementId: elementId(el),
      property,
      value: String(value || ""),
      reason,
    });
  }

  if (!compositionRoot) {
    reasons.push({
      elementId: "document",
      property: "data-composition-id",
      value: "missing",
      reason: "native extraction requires a stable data-composition-id root",
    });
  }
  // Transparent roots are OK — the Rust renderer clears to black by default.
  // Sub-compositions provide their own backgrounds.

  function inspect(el) {
    const tag = el.tagName.toLowerCase();
    const cs = getComputedStyle(el);

    if (tag === "video") {
      const src = el.currentSrc || el.src;
      if (!src) {
        add(el, "video", "", "video element has no resolved source");
      }
      // Video with resolved source is supported: frames are extracted via
      // FFmpeg and composited as images by the Rust painter.
    }
    if (tag === "canvas" || tag === "svg" || tag === "iframe") {
      add(el, tag, tag, "embedded dynamic/vector surfaces require Chrome fallback");
    }

    // Relaxed: the scene extractor assigns positional IDs (tag-x-y) which
    // are deterministic for a given layout. Timeline baking queries [id]
    // after extraction, so these generated IDs work.

    // Relaxed: Skia's paragraph API (textlayout feature) handles multi-line
    // text and basic layout. Chrome extraction provides the computed bounds.

    if (cs.backgroundImage && cs.backgroundImage !== "none") {
      const layers = splitTopLevel(cs.backgroundImage);
      if (layers.length > 1) {
        add(el, "background-image", cs.backgroundImage, "multiple background layers are not supported");
      } else if (
        !/^(linear-gradient|radial-gradient|url)\\(/.test(layers[0]) ||
        (layers[0].startsWith("url(") && cs.backgroundRepeat !== "no-repeat")
      ) {
        add(el, "background-image", cs.backgroundImage, "only gradients and non-repeating URL backgrounds are supported");
      }
    }

    if (cs.boxShadow && cs.boxShadow !== "none") {
      // Multiple shadows: the Rust painter loops over each shadow layer.
      if (/\\binset\\b/.test(cs.boxShadow)) add(el, "box-shadow", cs.boxShadow, "inset shadows are not supported");
    }

    if (cs.textShadow && cs.textShadow !== "none") {
      const shadows = splitTopLevel(cs.textShadow);
      if (shadows.length > 1) add(el, "text-shadow", cs.textShadow, "multiple text shadows are not supported");
    }

    if (cs.filter && cs.filter !== "none") {
      for (const match of cs.filter.matchAll(/([a-z-]+)\\(/g)) {
        if (!supportedFilters.has(match[1])) {
          add(el, "filter", cs.filter, "only blur, brightness, contrast, and saturate filters are supported");
          break;
        }
      }
    }

    const backdropFilter = cs.backdropFilter || cs.webkitBackdropFilter;
    if (backdropFilter && backdropFilter !== "none") {
      add(el, "backdrop-filter", backdropFilter, "backdrop filters require render-to-texture fallback work");
    }

    const maskImage = cs.maskImage || cs.webkitMaskImage;
    if (maskImage && maskImage !== "none") {
      add(el, "mask-image", maskImage, "CSS masks are not supported by the native painter yet");
    }

    if (cs.clipPath && cs.clipPath !== "none" && !/^(polygon|circle|ellipse)\\(/.test(cs.clipPath)) {
      add(el, "clip-path", cs.clipPath, "only polygon, circle, and ellipse clip paths are supported");
    }

    if (!supportedBlendModes.has(cs.mixBlendMode)) {
      add(el, "mix-blend-mode", cs.mixBlendMode, "blend mode is not mapped to Skia");
    }

    for (const side of ["Top", "Right", "Bottom", "Left"]) {
      const style = cs["border" + side + "Style"];
      const width = parseFloat(cs["border" + side + "Width"]) || 0;
      if (width > 0 && style !== "solid" && style !== "dashed") {
        add(el, "border-style", style, "only solid and dashed borders are supported");
        break;
      }
    }

    if (cs.writingMode && cs.writingMode !== "horizontal-tb") {
      add(el, "writing-mode", cs.writingMode, "vertical writing mode is not implemented");
    }

    for (const child of Array.from(el.children)) inspect(child);
  }

  inspect(compositionRoot ?? document.body);
  return reasons;
})()`;

export async function detectNativeSupport(
  page: Page,
  width: number,
  height: number,
): Promise<NativeSupportReport> {
  await page.setViewport({ width, height });
  const reasons = (await page.evaluate(DETECT_NATIVE_SUPPORT_SCRIPT)) as NativeUnsupportedReason[];
  const uniqueReasons = Array.from(
    new Map(
      reasons.map((reason) => [
        `${reason.elementId}\u0000${reason.property}\u0000${reason.value}\u0000${reason.reason}`,
        reason,
      ]),
    ).values(),
  );
  return { supported: uniqueReasons.length === 0, reasons: uniqueReasons };
}
