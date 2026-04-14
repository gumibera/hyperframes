#!/usr/bin/env tsx
/**
 * Generate Catalog Preview Images + Videos
 *
 * Extends the template preview pipeline to handle all registry item types:
 * - Examples:   renders index.html (same as generate-template-previews.ts)
 * - Blocks:     renders the block's standalone HTML directly
 * - Components: renders the component's demo.html
 *
 * Output: docs/images/catalog/<type>/<name>.png + <name>.mp4
 *
 * Usage:
 *   npx tsx scripts/generate-catalog-previews.ts                      # all items
 *   npx tsx scripts/generate-catalog-previews.ts --only data-chart    # single item
 *   npx tsx scripts/generate-catalog-previews.ts --type block         # blocks only
 *   npx tsx scripts/generate-catalog-previews.ts --skip-video         # thumbnails only
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, cpSync, rmSync } from "node:fs";
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
  createRenderJob,
  executeRenderJob,
} from "@hyperframes/producer";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const registryDir = resolve(repoRoot, "registry");

if (!process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH) {
  process.env.PRODUCER_HYPERFRAME_MANIFEST_PATH = resolve(
    repoRoot,
    "packages/core/dist/hyperframe.manifest.json",
  );
}

// ── Types ──────────────────────────────────────────────────────────────────

type ItemKind = "block" | "component";

interface CatalogItem {
  name: string;
  kind: ItemKind;
  /** Directory containing the item's files in the registry. */
  sourceDir: string;
  /** The HTML file to render (relative to sourceDir). */
  entryFile: string;
}

// ── Discovery ──────────────────────────────────────────────────────────────

function discoverItems(kindFilter: ItemKind | null, nameFilter: string | null): CatalogItem[] {
  const items: CatalogItem[] = [];

  // Blocks and components only — examples use the existing generate-template-previews.ts.
  const kinds: { kind: ItemKind; dir: string }[] = [
    { kind: "block", dir: join(registryDir, "blocks") },
    { kind: "component", dir: join(registryDir, "components") },
  ];

  for (const { kind, dir } of kinds) {
    if (kindFilter && kindFilter !== kind) continue;
    if (!existsSync(dir)) continue;

    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      if (nameFilter && e.name !== nameFilter) continue;

      const sourceDir = join(dir, e.name);
      const manifestPath = join(sourceDir, "registry-item.json");
      if (!existsSync(manifestPath)) continue;

      // Blocks: find the first composition file. Components: use demo.html.
      let entryFile: string;
      if (kind === "component") {
        entryFile = "demo.html";
      } else {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
        const compFile = manifest.files?.find(
          (f: { type: string }) => f.type === "hyperframes:composition",
        );
        entryFile = compFile?.path ?? `${e.name}.html`;
      }

      if (!existsSync(join(sourceDir, entryFile))) continue;
      items.push({ name: e.name, kind, sourceDir, entryFile });
    }
  }

  if (nameFilter && items.length === 0) {
    const allNames = discoverItems(null, null).map((i) => i.name);
    console.error(`Item "${nameFilter}" not found. Available: ${allNames.join(", ")}`);
    process.exit(1);
  }

  return items;
}

// ── Preview generation ─────────────────────────────────────────────────────

function outputDir(kind: ItemKind): string {
  const typeDir = kind === "block" ? "blocks" : "components";
  return resolve(repoRoot, "docs/images/catalog", typeDir);
}

function prepareProjectDir(item: CatalogItem): string {
  const tmpDir = join(tmpdir(), `hf-catalog-${item.name}-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  cpSync(item.sourceDir, tmpDir, { recursive: true });
  return tmpDir;
}

async function generateThumbnail(item: CatalogItem, projectDir: string): Promise<void> {
  const outDir = outputDir(item.kind);
  mkdirSync(outDir, { recursive: true });

  // Read dimensions from registry-item.json or default to 1920x1080
  let width = 1920;
  let height = 1080;
  const manifestPath = join(item.sourceDir, "registry-item.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    if (manifest.dimensions) {
      width = manifest.dimensions.width ?? width;
      height = manifest.dimensions.height ?? height;
    }
  }

  const framesDir = join(projectDir, "_thumb_frames");
  mkdirSync(framesDir, { recursive: true });

  const fileServer = await createFileServer({ projectDir, port: 0 });
  try {
    const session = await createCaptureSession(fileServer.url, framesDir, {
      width,
      height,
      fps: 30,
      format: "png",
    });
    await initializeSession(session);

    let duration: number;
    try {
      duration = await getCompositionDuration(session);
    } catch {
      duration = 5;
    }

    // Capture at 40% of duration for a representative frame
    const captureTime = Math.min(2.0, duration * 0.4);
    const result = await captureFrame(session, 0, captureTime);
    cpSync(result.path, join(outDir, `${item.name}.png`));
    console.log(`  ✓ ${item.name}.png (${result.captureTimeMs}ms)`);

    await closeCaptureSession(session);
  } finally {
    fileServer.close();
    rmSync(framesDir, { recursive: true, force: true });
  }
}

async function generateVideo(item: CatalogItem, projectDir: string): Promise<void> {
  const outDir = outputDir(item.kind);
  mkdirSync(outDir, { recursive: true });

  const outMp4 = join(outDir, `${item.name}.mp4`);
  const job = createRenderJob({
    fps: 24,
    quality: "draft",
    format: "mp4",
  });
  await executeRenderJob(job, projectDir, outMp4);
  console.log(`  ✓ ${item.name}.mp4`);
}

// ── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(): { only: string | null; type: ItemKind | null; skipVideo: boolean } {
  let only: string | null = null;
  let type: ItemKind | null = null;
  let skipVideo = false;

  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--only" && process.argv[i + 1]) {
      i++;
      only = process.argv[i] ?? null;
    }
    if (arg === "--type" && process.argv[i + 1]) {
      i++;
      const val = process.argv[i];
      if (val === "block" || val === "component") {
        type = val;
      } else {
        console.error(`Invalid --type: "${val}". Must be block or component.`);
        process.exit(1);
      }
    }
    if (arg === "--skip-video") skipVideo = true;
  }

  return { only, type, skipVideo };
}

async function main(): Promise<void> {
  const { only, type, skipVideo } = parseArgs();
  const items = discoverItems(type, only);

  console.log(
    `Generating catalog previews for ${items.length} item(s)${skipVideo ? " (thumbnails only)" : " + videos"}...\n`,
  );

  for (const item of items) {
    console.log(`[${item.kind}] ${item.name}`);
    const projectDir = prepareProjectDir(item);
    try {
      await generateThumbnail(item, projectDir);
      if (!skipVideo) {
        await generateVideo(item, projectDir);
      }
    } catch (err) {
      console.error(`  ✗ ${item.name}: ${err instanceof Error ? err.message : err}`);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
