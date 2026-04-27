/**
 * Pre-baked timeline extraction — evaluates a GSAP timeline at every frame
 * timestamp via Chrome CDP and extracts per-frame property values.
 *
 * Batches multiple frames per CDP call to reduce round-trip overhead.
 * A 141s video at 30fps (4,230 frames) would need 8,460 CDP calls at 1 per
 * frame. Batching 10 frames per call reduces this to 423 calls.
 */
import type { Page } from "puppeteer-core";
import type { BakedTimeline, BakedFrame, BakedElementState } from "./types";

const BATCH_SIZE = 10;

const BAKE_BATCH_SCRIPT = `(frameTimes) => {
  function decomposeMatrix(raw) {
    if (!raw || raw === "none") {
      return { translate_x: 0, translate_y: 0, scale_x: 1, scale_y: 1, rotate_deg: 0 };
    }
    const mat = raw.match(
      /matrix\\(\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+),\\s*([-\\d.e]+)\\)/,
    );
    if (!mat) {
      return { translate_x: 0, translate_y: 0, scale_x: 1, scale_y: 1, rotate_deg: 0 };
    }
    const a = +mat[1], b = +mat[2], c = +mat[3], d = +mat[4];
    return {
      translate_x: +mat[5],
      translate_y: +mat[6],
      scale_x: Math.sqrt(a * a + b * b),
      scale_y: Math.sqrt(c * c + d * d),
      rotate_deg: (Math.atan2(b, a) * 180) / Math.PI,
    };
  }

  function parseColor(val) {
    if (!val || val === "transparent" || val === "rgba(0, 0, 0, 0)") return null;
    const m = val.match(/rgba?\\(\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\s*\\)/);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: Math.round((m[4] !== undefined ? +m[4] : 1) * 255) };
  }

  function extractFrame() {
    const result = {};
    const els = document.querySelectorAll("[id]");
    for (const el of els) {
      if (!(el instanceof HTMLElement)) continue;
      const cs = getComputedStyle(el);
      const transform = decomposeMatrix(cs.transform);
      const rect = el.getBoundingClientRect();
      result[el.id] = {
        opacity: parseFloat(cs.opacity) || 0,
        translate_x: transform.translate_x,
        translate_y: transform.translate_y,
        scale_x: transform.scale_x,
        scale_y: transform.scale_y,
        rotate_deg: transform.rotate_deg,
        visibility: cs.visibility !== "hidden" && cs.display !== "none",
        bounds_x: rect.left,
        bounds_y: rect.top,
        bounds_w: rect.width,
        bounds_h: rect.height,
        background_color: parseColor(cs.backgroundColor),
        color: parseColor(cs.color),
        border_radius: [
          parseFloat(cs.borderTopLeftRadius) || 0,
          parseFloat(cs.borderTopRightRadius) || 0,
          parseFloat(cs.borderBottomRightRadius) || 0,
          parseFloat(cs.borderBottomLeftRadius) || 0,
        ],
      };
    }
    return result;
  }

  const results = [];
  const hf = window.__hf;
  for (const t of frameTimes) {
    if (hf && typeof hf.seek === "function") hf.seek(t);
    results.push(extractFrame());
  }
  return results;
}`;

export async function bakeTimeline(
  page: Page,
  fps: number,
  duration: number,
): Promise<BakedTimeline> {
  const totalFrames = Math.ceil(fps * duration);
  const frames: BakedFrame[] = [];

  for (let batchStart = 0; batchStart < totalFrames; batchStart += BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + BATCH_SIZE, totalFrames);
    const frameTimes: number[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
      frameTimes.push(i / fps);
    }

    const inlinedScript = `(${BAKE_BATCH_SCRIPT})(${JSON.stringify(frameTimes)})`;
    const batchResults = (await page.evaluate(inlinedScript)) as Array<
      Record<string, BakedElementState>
    >;

    for (let j = 0; j < batchResults.length; j++) {
      const i = batchStart + j;
      frames.push({
        frame_index: i,
        time: frameTimes[j],
        elements: batchResults[j],
      });
    }
  }

  return { fps, duration, total_frames: totalFrames, frames };
}

const VIDEO_BAKE_BATCH_SIZE = 50;

const VIDEO_BAKE_SCRIPT = `(frameTimes, videoIds) => {
  const results = [];
  const hf = window.__hf;
  for (const t of frameTimes) {
    if (hf && typeof hf.seek === "function") hf.seek(t);
    const frame = {};
    for (const id of videoIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      frame[id] = {
        opacity: parseFloat(cs.opacity) || 0,
        translate_x: 0,
        translate_y: 0,
        scale_x: 1,
        scale_y: 1,
        rotate_deg: 0,
        visibility: cs.visibility !== "hidden" && cs.display !== "none",
        bounds_x: rect.left,
        bounds_y: rect.top,
        bounds_w: rect.width,
        bounds_h: rect.height,
        border_radius: [
          parseFloat(cs.borderTopLeftRadius) || 0,
          parseFloat(cs.borderTopRightRadius) || 0,
          parseFloat(cs.borderBottomRightRadius) || 0,
          parseFloat(cs.borderBottomLeftRadius) || 0,
        ],
      };
    }
    results.push(frame);
  }
  return results;
}`;

export async function bakeVideoTimeline(
  page: Page,
  fps: number,
  duration: number,
  videoIds: string[],
): Promise<BakedTimeline> {
  const uniqueIds = [...new Set(videoIds)];
  const totalFrames = Math.ceil(fps * duration);
  const frames: BakedFrame[] = [];

  for (let batchStart = 0; batchStart < totalFrames; batchStart += VIDEO_BAKE_BATCH_SIZE) {
    const batchEnd = Math.min(batchStart + VIDEO_BAKE_BATCH_SIZE, totalFrames);
    const frameTimes: number[] = [];
    for (let i = batchStart; i < batchEnd; i++) {
      frameTimes.push(i / fps);
    }

    const inlinedScript = `(${VIDEO_BAKE_SCRIPT})(${JSON.stringify(frameTimes)}, ${JSON.stringify(uniqueIds)})`;
    const batchResults = (await page.evaluate(inlinedScript)) as Array<
      Record<string, BakedElementState>
    >;

    for (let j = 0; j < batchResults.length; j++) {
      const i = batchStart + j;
      frames.push({
        frame_index: i,
        time: frameTimes[j]!,
        elements: batchResults[j]!,
      });
    }
  }

  return { fps, duration, total_frames: totalFrames, frames };
}
