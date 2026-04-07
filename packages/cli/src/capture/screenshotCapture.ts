/**
 * Full-page screenshot capture.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SCROLL_PAD = 200;

export async function captureScreenshots(
  page: Page,
  outputDir: string,
  opts: { maxScreenshots?: number } = {},
): Promise<string[]> {
  const maxScreenshots = opts.maxScreenshots ?? 24;
  const screenshotsDir = join(outputDir, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });

  // Step 1: Calculate capture positions
  const positions = (await page.evaluate(`(() => {
    var de = document.documentElement;
    var body = document.body;
    var fullHeight = Math.max(de.clientHeight, body.scrollHeight, de.scrollHeight, body.offsetHeight, de.offsetHeight);
    var viewportH = window.innerHeight;
    var yDelta = viewportH - (viewportH > ${SCROLL_PAD} ? ${SCROLL_PAD} : 0);
    var positions = [];
    for (var y = 0; y < fullHeight; y += yDelta) positions.push(y);
    var lastPos = fullHeight - viewportH;
    if (lastPos > 0 && (positions.length === 0 || positions[positions.length - 1] < lastPos - 10)) positions.push(lastPos);
    if (positions.length > ${maxScreenshots}) {
      var sampled = [positions[0]];
      var stride = (positions.length - 1) / (${maxScreenshots} - 1);
      for (var i = 1; i < ${maxScreenshots} - 1; i++) sampled.push(positions[Math.round(i * stride)]);
      sampled.push(positions[positions.length - 1]);
      return sampled;
    }
    return positions;
  })()`)) as number[];

  // Step 2: Disable fixed/sticky elements
  await page.evaluate(`(() => {
    var style = document.createElement("style");
    style.id = "__hf_capture_style";
    style.textContent = "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }";
    document.head.appendChild(style);
    document.querySelectorAll("*").forEach(function(el) {
      var cs = getComputedStyle(el);
      if (cs.position === "fixed" || cs.position === "sticky") {
        el.dataset.hfOrigPos = cs.position;
        el.style.setProperty("position", "absolute", "important");
      }
    });
  })()`);

  // Step 3: Capture each position
  await page.evaluate(`window.scrollTo(0, 0)`);
  await new Promise((r) => setTimeout(r, 200));

  const filePaths: string[] = [];

  for (let i = 0; i < positions.length; i++) {
    await page.evaluate(`window.scrollTo(0, ${positions[i]})`);
    await new Promise((r) => setTimeout(r, 350));

    const filename = `section-${String(i).padStart(2, "0")}.png`;
    const filePath = join(screenshotsDir, filename);

    const buffer = await page.screenshot({ type: "png" });
    writeFileSync(filePath, buffer);
    filePaths.push(`screenshots/${filename}`);
  }

  // Step 4: Restore
  await page.evaluate(`(() => {
    var style = document.getElementById("__hf_capture_style");
    if (style) style.remove();
    document.querySelectorAll("[data-hf-orig-pos]").forEach(function(el) {
      el.style.removeProperty("position");
      delete el.dataset.hfOrigPos;
    });
    window.scrollTo(0, 0);
  })()`);

  return filePaths;
}

/**
 * Capture a full-page screenshot after scrolling to trigger lazy loading.
 * Uses Puppeteer's built-in fullPage stitching (same as Chrome DevTools
 * Cmd+Shift+P → "Capture full size screenshot").
 *
 * Note: Chrome has a ~16384px height limit. Content below that is clipped,
 * but the important above-the-fold design patterns are always captured.
 */
export async function captureFullPageScreenshot(
  page: Page,
  outputDir: string,
): Promise<string | undefined> {
  const screenshotsDir = join(outputDir, "screenshots");
  mkdirSync(screenshotsDir, { recursive: true });

  try {
    // Scroll through the page to trigger lazy loading first
    await page.evaluate(`(async () => {
      var step = Math.floor(window.innerHeight * 0.7);
      var limit = Math.min(document.body.scrollHeight, 50000);
      for (var y = 0; y < limit; y += step) {
        window.scrollTo(0, y);
        await new Promise(function(r) { setTimeout(r, 200); });
      }
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise(function(r) { setTimeout(r, 500); });
      window.scrollTo(0, 0);
      await new Promise(function(r) { setTimeout(r, 300); });
    })()`);

    // Wait for all images to finish loading
    await page
      .waitForFunction(
        `Array.from(document.querySelectorAll("img")).every(function(img) { return img.complete; })`,
        { timeout: 10000 },
      )
      .catch(() => {});

    // Kill animations and scroll to top before capture
    await page.evaluate(`(() => {
      var style = document.createElement("style");
      style.id = "__hf_fullpage_style";
      style.textContent = "*, *::before, *::after { transition-duration: 0s !important; animation-duration: 0s !important; }";
      document.head.appendChild(style);
      window.scrollTo(0, 0);
    })()`);
    await new Promise((r) => setTimeout(r, 200));

    const filename = "full-page.png";
    const filePath = join(screenshotsDir, filename);
    const buffer = await page.screenshot({ type: "png", fullPage: true });
    writeFileSync(filePath, buffer);

    // Cleanup
    await page.evaluate(`(() => {
      var style = document.getElementById("__hf_fullpage_style");
      if (style) style.remove();
    })()`);

    return `screenshots/${filename}`;
  } catch {
    return undefined;
  }
}
