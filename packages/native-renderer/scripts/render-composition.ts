#!/usr/bin/env tsx
/**
 * End-to-end native render pipeline.
 *
 * Chrome is used ONCE (~200ms) to extract the layout tree and bake
 * the animation timeline. The Rust binary then renders all frames
 * at native Skia speed without Chrome.
 *
 * Usage:
 *   tsx scripts/render-composition.ts <composition-dir> <output.mp4> [--fps 30] [--cpu]
 *
 * The composition-dir must contain an index.html with window.__hf protocol.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import {
  createCaptureSession,
  initializeSession,
  closeCaptureSession,
  getCompositionDuration,
  createFileServer,
} from "@hyperframes/engine";
import { extractScene } from "../src/scene/extract.js";
import { bakeTimeline } from "../src/timeline/bake.js";

const args = process.argv.slice(2);
if (args.length < 2 || args.includes("--help")) {
  console.error(
    "usage: tsx scripts/render-composition.ts <composition-dir> <output.mp4> [--fps 30] [--cpu]",
  );
  process.exit(2);
}

const compositionDir = resolve(args[0]);
const outputPath = resolve(args[1]);
const fps = parseInt(args[args.indexOf("--fps") + 1] || "30", 10);
const forceCpu = args.includes("--cpu");

const indexHtml = join(compositionDir, "index.html");
if (!existsSync(indexHtml)) {
  console.error(`No index.html found in ${compositionDir}`);
  process.exit(1);
}

const workDir = join(dirname(outputPath), ".native-work");
mkdirSync(workDir, { recursive: true });

async function main() {
  const t0 = Date.now();

  // Step 1: Start file server for the composition
  console.log("[native] Starting file server...");
  const fileServer = await createFileServer({
    projectDir: compositionDir,
    compiledDir: compositionDir,
    port: 0,
  });

  // Step 2: Open Chrome, navigate, wait for __hf
  console.log("[native] Launching Chrome for scene extraction...");
  const session = await createCaptureSession(fileServer.url, workDir, {
    width: 1920,
    height: 1080,
    fps,
  });
  await initializeSession(session);

  // Step 3: Get composition duration
  const duration = await getCompositionDuration(session);
  console.log(`[native] Duration: ${duration}s, FPS: ${fps}, Frames: ${Math.ceil(duration * fps)}`);

  // Step 4: Extract scene graph
  console.log("[native] Extracting scene graph...");
  const scene = await extractScene(session.page, 1920, 1080);
  const scenePath = join(workDir, "scene.json");
  writeFileSync(scenePath, JSON.stringify(scene, null, 2));
  console.log(`[native] Scene: ${scene.elements.length} root elements → ${scenePath}`);

  // Step 5: Bake timeline
  console.log("[native] Baking animation timeline...");
  const timeline = await bakeTimeline(session.page, fps, duration);
  const timelinePath = join(workDir, "timeline.json");
  writeFileSync(timelinePath, JSON.stringify(timeline));
  console.log(`[native] Timeline: ${timeline.total_frames} frames → ${timelinePath}`);

  // Step 6: Close Chrome + file server
  await closeCaptureSession(session);
  fileServer.close();
  const extractionMs = Date.now() - t0;
  console.log(`[native] Chrome extraction: ${extractionMs}ms (one-time cost)`);

  // Step 7: Render with Rust native binary
  console.log("[native] Rendering with Rust/Skia...");
  const nativeRendererDir = resolve(dirname(new URL(import.meta.url).pathname), "..");
  const renderStart = Date.now();

  const cpuFlag = forceCpu ? "--cpu" : "";
  const result = spawnSync(
    "cargo",
    [
      "run",
      "--release",
      "--bin",
      "render_native",
      "--",
      "--scene",
      scenePath,
      "--timeline",
      timelinePath,
      "--output",
      outputPath,
      "--fps",
      String(fps),
      "--duration",
      String(duration),
      "--quality",
      "80",
      ...(cpuFlag ? [cpuFlag] : []),
    ],
    {
      cwd: nativeRendererDir,
      stdio: ["inherit", "pipe", "pipe"],
      timeout: 300_000,
    },
  );

  if (result.status !== 0) {
    console.error(`[native] Rust render failed:\n${result.stderr?.toString()}`);
    process.exit(1);
  }

  const renderMs = Date.now() - renderStart;
  const totalMs = Date.now() - t0;

  // Parse result JSON from stdout
  const resultJson = result.stdout?.toString().trim();
  console.log(`[native] Rust output: ${resultJson}`);
  console.log(`[native] ────────────────────────────────────`);
  console.log(`[native] Extraction: ${extractionMs}ms (Chrome, one-time)`);
  console.log(`[native] Render:     ${renderMs}ms (Rust/Skia)`);
  console.log(`[native] Total:      ${totalMs}ms`);
  console.log(`[native] Output:     ${outputPath}`);

  // Cleanup work dir
  rmSync(workDir, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(`[native] Fatal: ${err}`);
  process.exit(1);
});
