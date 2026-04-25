/**
 * Pre-baked timeline extraction — evaluates a GSAP timeline at every frame
 * timestamp via Chrome CDP and extracts per-frame property values for all
 * animated elements.
 *
 * The output JSON is consumed by the Rust native renderer, which applies
 * transform/opacity/visibility per-frame during paint — no V8 needed at
 * render time.
 */
import type { Page } from "puppeteer-core";
import type { BakedTimeline, BakedFrame, BakedElementState } from "./types";

// String-based evaluate avoids tsx/esbuild injecting `__name` helpers into the
// function body that Puppeteer serializes into the browser context.
const BAKE_FRAME_SCRIPT = `(() => {
  function decomposeMatrix(raw) {
    if (raw === "none") {
      return { translate_x: 0, translate_y: 0, scale_x: 1, scale_y: 1, rotate_deg: 0 };
    }
    const mat = raw.match(
      /matrix\\(\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+)\\)/,
    );
    if (!mat) {
      return { translate_x: 0, translate_y: 0, scale_x: 1, scale_y: 1, rotate_deg: 0 };
    }
    const a = +mat[1];
    const b = +mat[2];
    const c = +mat[3];
    const d = +mat[4];
    return {
      translate_x: +mat[5],
      translate_y: +mat[6],
      scale_x: Math.sqrt(a * a + b * b),
      scale_y: Math.sqrt(c * c + d * d),
      rotate_deg: (Math.atan2(b, a) * 180) / Math.PI,
    };
  }

  const result = {};
  const els = document.querySelectorAll("[id]");
  for (const el of els) {
    if (!(el instanceof HTMLElement)) continue;
    const cs = getComputedStyle(el);
    const transform = decomposeMatrix(cs.transform);

    result[el.id] = {
      opacity: parseFloat(cs.opacity) || 0,
      translate_x: transform.translate_x,
      translate_y: transform.translate_y,
      scale_x: transform.scale_x,
      scale_y: transform.scale_y,
      rotate_deg: transform.rotate_deg,
      visibility: cs.visibility !== "hidden" && cs.display !== "none",
    };
  }
  return result;
})()`;

/**
 * Bake a composition's GSAP timeline into per-frame property snapshots.
 *
 * For each frame (0..totalFrames), this:
 * 1. Seeks the composition to the frame's timestamp via `window.__hf.seek()`
 * 2. Reads computed styles from every `[id]` element in the page
 * 3. Decomposes the CSS transform matrix into translate/scale/rotate
 *
 * The caller must have already loaded and initialised the composition in the
 * page (i.e., the GSAP timeline and `window.__hf` must exist).
 */
export async function bakeTimeline(
  page: Page,
  fps: number,
  duration: number,
): Promise<BakedTimeline> {
  const totalFrames = Math.ceil(fps * duration);
  const frames: BakedFrame[] = [];

  for (let i = 0; i < totalFrames; i++) {
    const time = i / fps;

    // Seek the composition to this timestamp. The guard mirrors the pattern
    // used in packages/producer/src/services/renderOrchestrator.ts.
    await page.evaluate(
      `(() => {
        const hf = window.__hf;
        if (hf && typeof hf.seek === "function") {
          hf.seek(${JSON.stringify(time)});
        }
      })()`,
    );

    // Extract animated properties for all elements with IDs.
    // Everything inside page.evaluate runs in the browser context — helpers
    // must be inlined (no access to outer scope).
    const elements: Record<string, BakedElementState> = await page.evaluate(BAKE_FRAME_SCRIPT);

    frames.push({ frame_index: i, time, elements });
  }

  return { fps, duration, total_frames: totalFrames, frames };
}
