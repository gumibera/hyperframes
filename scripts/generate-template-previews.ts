#!/usr/bin/env tsx
/**
 * Generate Template Preview Images
 *
 * Uses @hyperframes/producer to render PNG thumbnails of each built-in template.
 * Output: docs/images/templates/<id>.png
 *
 * Usage:
 *   pnpm generate:previews              # all templates
 *   pnpm generate:previews -- --only warm-grain
 */

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  createFileServer,
  createCaptureSession,
  initializeSession,
  captureFrame,
  getCompositionDuration,
  closeCaptureSession,
} from "@hyperframes/producer";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const bundledTemplatesDir = resolve(repoRoot, "packages/cli/src/templates");
const examplesDir = resolve(repoRoot, "examples");
const outputDir = resolve(repoRoot, "docs/images/templates");

// Point the producer at the monorepo's built core manifest
if (!process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH) {
  process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = resolve(
    repoRoot,
    "packages/core/dist/hyperframe.manifest.json",
  );
}

// Templates to skip — blank is just empty scaffolding (black screen without a video)
const SKIP_TEMPLATES = new Set(["blank"]);

// Template metadata: dimensions and best capture time for visual interest
const TEMPLATE_CONFIG: Record<string, { width: number; height: number; captureTime: number }> = {
  "warm-grain": { width: 1920, height: 1080, captureTime: 2.0 },
  "play-mode": { width: 1920, height: 1080, captureTime: 2.0 },
  "swiss-grid": { width: 1920, height: 1080, captureTime: 2.0 },
  vignelli: { width: 1080, height: 1920, captureTime: 2.0 },
  "decision-tree": { width: 1920, height: 1080, captureTime: 2.0 },
  "kinetic-type": { width: 1920, height: 1080, captureTime: 2.0 },
  "product-promo": { width: 1920, height: 1080, captureTime: 2.0 },
  "nyt-graph": { width: 1920, height: 1080, captureTime: 2.0 },
};

/**
 * Patch template HTML: remove __VIDEO_SRC__ placeholders and set duration.
 * Same logic as init.ts patchVideoSrc() with no video file.
 */
function patchTemplateHtml(dir: string, durationSeconds: number): void {
  const htmlFiles = readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => join(e.parentPath ?? e.path, e.name));

  for (const file of htmlFiles) {
    let content = readFileSync(file, "utf-8");
    // Remove video/audio elements with placeholder src
    content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/video>/g, "");
    content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/audio>/g, "");
    content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    const dur = String(Math.round(durationSeconds * 100) / 100);
    content = content.replaceAll("__VIDEO_DURATION__", dur);
    writeFileSync(file, content, "utf-8");
  }
}

function parseArgs(): { only: string | null } {
  let only: string | null = null;
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--only" && process.argv[i + 1]) {
      i++;
      only = process.argv[i] ?? null;
    }
  }
  return { only };
}

/** Resolve the on-disk directory for a template (bundled or examples). */
function resolveTemplateDir(templateId: string): string | null {
  const bundled = join(bundledTemplatesDir, templateId);
  if (existsSync(join(bundled, "index.html"))) return bundled;
  const example = join(examplesDir, templateId);
  if (existsSync(join(example, "index.html"))) return example;
  return null;
}

function discoverTemplates(only: string | null): string[] {
  const seen = new Set<string>();
  const all: string[] = [];

  // Scan bundled templates
  for (const dir of [bundledTemplatesDir, examplesDir]) {
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (
        e.isDirectory() &&
        e.name !== "_shared" &&
        !SKIP_TEMPLATES.has(e.name) &&
        !seen.has(e.name) &&
        existsSync(join(dir, e.name, "index.html"))
      ) {
        seen.add(e.name);
        all.push(e.name);
      }
    }
  }

  if (only) {
    const match = all.find((t) => t === only);
    if (!match) {
      console.error(`Template "${only}" not found. Available: ${all.join(", ")}`);
      process.exit(1);
    }
    return [match];
  }
  return all;
}

async function generatePreview(templateId: string): Promise<void> {
  const config = TEMPLATE_CONFIG[templateId] ?? {
    width: 1920,
    height: 1080,
    captureTime: 2.0,
  };

  // Copy template to temp dir
  const tmpDir = join(tmpdir(), `hf-preview-${templateId}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  const templateSrc = resolveTemplateDir(templateId);
  if (!templateSrc) throw new Error(`Template directory not found for "${templateId}"`);
  cpSync(templateSrc, tmpDir, { recursive: true });

  // Patch out video/audio placeholders, set 10s duration
  patchTemplateHtml(tmpDir, 10);

  const fileServer = await createFileServer({ projectDir: tmpDir, port: 0 });

  try {
    const framesDir = join(tmpDir, "_frames");
    mkdirSync(framesDir, { recursive: true });

    const session = await createCaptureSession(fileServer.url, framesDir, {
      width: config.width,
      height: config.height,
      fps: 30,
      format: "png",
    });

    await initializeSession(session);

    // Query actual duration in case template declares something different
    let duration: number;
    try {
      duration = await getCompositionDuration(session);
    } catch {
      duration = 10;
    }

    // Capture at the configured time, clamped to composition duration
    const captureTime = Math.min(config.captureTime, duration * 0.8);
    const result = await captureFrame(session, 0, captureTime);

    // Copy to output
    const outPath = join(outputDir, `${templateId}.png`);
    cpSync(result.path, outPath);

    console.log(
      `  ✓ ${templateId} → ${outPath} (${config.width}x${config.height} @ ${captureTime.toFixed(1)}s, ${result.captureTimeMs}ms)`,
    );

    await closeCaptureSession(session);
  } finally {
    fileServer.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { only } = parseArgs();
  const templates = discoverTemplates(only);

  console.log(`Generating previews for ${templates.length} templates...\n`);

  mkdirSync(outputDir, { recursive: true });

  for (const templateId of templates) {
    try {
      await generatePreview(templateId);
    } catch (err) {
      console.error(`  ✗ ${templateId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone. Output: ${outputDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
