/**
 * Validation driver for the 5-PR perf stack.
 *
 * Runs a producer test fixture through `executeRenderJob` and prints the
 * resulting `RenderPerfSummary` as JSON. Designed to be called multiple
 * times with different env flags so we can compare HWaccel on/off, cache
 * miss vs hit, etc., without bisecting git history.
 *
 * Usage:
 *   tsx scripts/validate-perf-stack.ts <fixture-name> [--label <tag>]
 *
 * Honors: HYPERFRAMES_EXTRACT_CACHE_DIR, PRODUCER_HWACCEL_SDR_DECODE,
 * PRODUCER_HWACCEL_MIN_DURATION_SECONDS — same env surface as a real
 * producer render.
 */

import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRenderJob, executeRenderJob } from "../src/services/renderOrchestrator.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("usage: validate-perf-stack.ts <fixture-name> [--label <tag>]");
    process.exit(1);
  }
  const fixtureName = args[0]!;
  const labelIdx = args.indexOf("--label");
  const label = labelIdx >= 0 ? args[labelIdx + 1] : undefined;

  const fixtureRoot = resolve(__dirname, "..", "tests", fixtureName);
  const srcDir = join(fixtureRoot, "src");
  if (!existsSync(srcDir)) {
    console.error(`Fixture not found: ${srcDir}`);
    process.exit(1);
  }

  const metaPath = join(fixtureRoot, "meta.json");
  const meta = existsSync(metaPath)
    ? JSON.parse(await Bun.file(metaPath).text())
    : { renderConfig: { fps: 30 } };

  const tempRoot = mkdtempSync(join(tmpdir(), "hf-perf-validate-"));
  const tempSrc = join(tempRoot, "src");
  cpSync(srcDir, tempSrc, { recursive: true });

  const outDir = join(tempRoot, "out");
  mkdirSync(outDir, { recursive: true });
  const outputFormat = meta.renderConfig?.format ?? "mp4";
  const outputPath = join(outDir, `output.${outputFormat}`);

  const job = createRenderJob({
    fps: meta.renderConfig?.fps ?? 30,
    quality: "high",
    format: outputFormat,
    workers: meta.renderConfig?.workers ?? 1,
    useGpu: false,
    debug: false,
    hdr: meta.renderConfig?.hdr ?? false,
  });

  const started = Date.now();
  try {
    await executeRenderJob(job, tempSrc, outputPath);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "render_failed",
        fixture: fixtureName,
        label,
        error: err instanceof Error ? err.message : String(err),
        elapsedMs: Date.now() - started,
      }),
    );
    rmSync(tempRoot, { recursive: true, force: true });
    process.exit(2);
  }

  const summary = job.perfSummary;
  console.log(
    JSON.stringify(
      {
        event: "render_complete",
        fixture: fixtureName,
        label,
        elapsedMs: Date.now() - started,
        envToggles: {
          HYPERFRAMES_EXTRACT_CACHE_DIR: process.env.HYPERFRAMES_EXTRACT_CACHE_DIR ?? null,
          PRODUCER_HWACCEL_SDR_DECODE: process.env.PRODUCER_HWACCEL_SDR_DECODE ?? null,
          PRODUCER_HWACCEL_MIN_DURATION_SECONDS:
            process.env.PRODUCER_HWACCEL_MIN_DURATION_SECONDS ?? null,
        },
        perfSummary: summary,
      },
      null,
      2,
    ),
  );

  rmSync(tempRoot, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(3);
});
