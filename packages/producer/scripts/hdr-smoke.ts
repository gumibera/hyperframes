#!/usr/bin/env tsx
/**
 * HDR smoke test — renders the three hdr-regression fixtures end-to-end and
 * verifies the encoded MP4 has the expected color metadata via ffprobe.
 *
 * Why this exists:
 *   - The visual regression harness compares against committed goldens, which
 *     are platform-sensitive (Linux/Docker vs macOS) and don't exist for the
 *     hdr-regression fixtures yet.
 *   - The harness also doesn't pass `hdr: true` to createRenderJob, so the
 *     HDR encode path is never explicitly exercised in CI today.
 *   - This script bypasses both problems: it drives the orchestrator directly
 *     with the right `hdr` flag and asserts on color metadata, not pixels.
 *     That gives us a portable signal on the encode + side-data path.
 *
 * Usage:
 *   bunx tsx packages/producer/scripts/hdr-smoke.ts          # render all fixtures
 *   bunx tsx packages/producer/scripts/hdr-smoke.ts hdr-pq   # render one fixture
 *   KEEP_TEMP=1 bunx tsx packages/producer/scripts/hdr-smoke.ts
 *
 * Exits 0 when every assertion passes, non-zero on the first failure.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRenderJob, executeRenderJob } from "../src/services/renderOrchestrator.js";

interface ExpectedColor {
  pixFmt: string;
  colorTransfer: string;
  colorPrimaries: string;
  /** When true, the file MUST carry HDR side data (MaxCLL / MasteringDisplay). */
  requireHdrSideData?: boolean;
}

interface Fixture {
  id: string;
  hdr: boolean;
  expected: ExpectedColor;
}

const FIXTURES: Fixture[] = [
  {
    id: "sdr-baseline",
    hdr: false,
    expected: {
      pixFmt: "yuv420p",
      colorTransfer: "bt709",
      colorPrimaries: "bt709",
    },
  },
  {
    id: "hdr-pq",
    hdr: true,
    expected: {
      pixFmt: "yuv420p10le",
      colorTransfer: "smpte2084",
      colorPrimaries: "bt2020",
      requireHdrSideData: true,
    },
  },
  {
    id: "mixed-sdr-hdr",
    hdr: true,
    expected: {
      pixFmt: "yuv420p10le",
      colorTransfer: "smpte2084",
      colorPrimaries: "bt2020",
      requireHdrSideData: true,
    },
  },
  {
    id: "hdr-feature-stack",
    hdr: true,
    expected: {
      pixFmt: "yuv420p10le",
      colorTransfer: "smpte2084",
      colorPrimaries: "bt2020",
      requireHdrSideData: true,
    },
  },
  {
    id: "opacity-mixed-fade",
    hdr: true,
    expected: {
      pixFmt: "yuv420p10le",
      colorTransfer: "smpte2084",
      colorPrimaries: "bt2020",
      requireHdrSideData: true,
    },
  },
];

interface ProbeResult {
  pixFmt: string;
  colorTransfer: string;
  colorPrimaries: string;
  colorSpace: string;
  sideDataTypes: string[];
}

function probe(filePath: string): ProbeResult {
  const result = spawnSync(
    "ffprobe",
    ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(`ffprobe failed for ${filePath}: ${result.stderr}`);
  }
  const json = JSON.parse(result.stdout) as {
    streams: Array<{
      codec_type: string;
      pix_fmt?: string;
      color_transfer?: string;
      color_primaries?: string;
      color_space?: string;
      side_data_list?: Array<{ side_data_type?: string }>;
    }>;
  };
  const video = json.streams.find((s) => s.codec_type === "video");
  if (!video) throw new Error(`No video stream in ${filePath}`);
  // Stream-level side data: surfaces mp4 mdcv/clli boxes when ffmpeg's mp4
  // muxer transcodes the x265 SEI into container metadata.
  const streamSide = (video.side_data_list ?? [])
    .map((d) => d.side_data_type ?? "")
    .filter(Boolean);
  // Frame-level side data: surfaces the raw HEVC SEI prefix NAL units that
  // x265 emits when --master-display / --max-cll are passed. We probe just
  // the first frame to keep this fast — the SEI is on every IDR.
  const frameSide = probeFirstFrameSideData(filePath);
  const merged = Array.from(new Set([...streamSide, ...frameSide]));
  return {
    pixFmt: video.pix_fmt ?? "",
    colorTransfer: video.color_transfer ?? "",
    colorPrimaries: video.color_primaries ?? "",
    colorSpace: video.color_space ?? "",
    sideDataTypes: merged,
  };
}

function probeFirstFrameSideData(filePath: string): string[] {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-select_streams",
      "v:0",
      "-read_intervals",
      "%+#1",
      "-show_frames",
      filePath,
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) return [];
  try {
    const json = JSON.parse(result.stdout) as {
      frames?: Array<{ side_data_list?: Array<{ side_data_type?: string }> }>;
    };
    const frame = json.frames?.[0];
    return (frame?.side_data_list ?? []).map((d) => d.side_data_type ?? "").filter(Boolean);
  } catch {
    return [];
  }
}

function checkExpectations(
  fixtureId: string,
  actual: ProbeResult,
  expected: ExpectedColor,
): string[] {
  const errors: string[] = [];
  if (actual.pixFmt !== expected.pixFmt) {
    errors.push(`${fixtureId}: pix_fmt expected ${expected.pixFmt}, got ${actual.pixFmt}`);
  }
  if (actual.colorTransfer !== expected.colorTransfer) {
    errors.push(
      `${fixtureId}: color_transfer expected ${expected.colorTransfer}, got ${actual.colorTransfer || "(unset)"}`,
    );
  }
  if (actual.colorPrimaries !== expected.colorPrimaries) {
    errors.push(
      `${fixtureId}: color_primaries expected ${expected.colorPrimaries}, got ${actual.colorPrimaries || "(unset)"}`,
    );
  }
  if (expected.requireHdrSideData) {
    const hasMaxCll = actual.sideDataTypes.some((t) => /content light level|maxcll/i.test(t));
    const hasMastering = actual.sideDataTypes.some((t) => /mastering display/i.test(t));
    if (!hasMaxCll && !hasMastering) {
      errors.push(
        `${fixtureId}: expected HDR side data (MaxCLL or MasteringDisplay), got [${actual.sideDataTypes.join(", ") || "none"}]`,
      );
    }
  }
  return errors;
}

async function renderFixture(
  fixturesRoot: string,
  fixture: Fixture,
  workDir: string,
): Promise<{ outputPath: string; durationMs: number }> {
  const fixtureSrcDir = join(fixturesRoot, fixture.id, "src");
  if (!existsSync(fixtureSrcDir)) {
    throw new Error(`Fixture src directory missing: ${fixtureSrcDir}`);
  }

  const tempSrcDir = join(workDir, "src");
  cpSync(fixtureSrcDir, tempSrcDir, { recursive: true });

  const fixtureAssetsDir = join(fixturesRoot, fixture.id, "assets");
  if (existsSync(fixtureAssetsDir)) {
    // Mixed-sdr-hdr's assets/ is largely symlinks to sibling fixtures (e.g.
    // ../../hdr-pq/assets/...). Dereference them on copy so the workdir is
    // self-contained — otherwise the file server 404s on the relative paths.
    cpSync(fixtureAssetsDir, join(workDir, "assets"), {
      recursive: true,
      dereference: true,
    });
  }

  const outputPath = join(workDir, "output.mp4");
  const job = createRenderJob({
    fps: 30,
    quality: "high",
    format: "mp4",
    useGpu: false,
    debug: false,
    hdr: fixture.hdr,
  });

  const start = Date.now();
  await executeRenderJob(job, tempSrcDir, outputPath);
  const durationMs = Date.now() - start;

  if (!existsSync(outputPath)) {
    throw new Error(`Render reported success but no output at ${outputPath}`);
  }
  return { outputPath, durationMs };
}

async function main(): Promise<number> {
  const filterId = process.argv[2];
  const keepTemp = process.env.KEEP_TEMP === "1";

  const fixturesRoot = resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "tests",
    "hdr-regression",
  );
  if (!existsSync(fixturesRoot)) {
    console.error(`hdr-regression fixtures not found at ${fixturesRoot}`);
    return 1;
  }

  const targets = filterId ? FIXTURES.filter((f) => f.id === filterId) : FIXTURES;
  if (targets.length === 0) {
    console.error(
      `No fixture matched "${filterId}". Available: ${FIXTURES.map((f) => f.id).join(", ")}`,
    );
    return 1;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "hf-hdr-smoke-"));
  console.log(`workdir: ${tempRoot}`);

  const allErrors: string[] = [];
  let firstFailingFixture: string | null = null;

  try {
    for (const fixture of targets) {
      const fixtureDir = join(tempRoot, fixture.id);
      mkdirSync(fixtureDir, { recursive: true });

      console.log(`\n=== ${fixture.id} (hdr=${fixture.hdr}) ===`);
      const { outputPath, durationMs } = await renderFixture(fixturesRoot, fixture, fixtureDir);
      console.log(`  rendered in ${(durationMs / 1000).toFixed(1)}s`);

      const probed = probe(outputPath);
      console.log(`  pix_fmt=${probed.pixFmt}`);
      console.log(`  color_transfer=${probed.colorTransfer || "(unset)"}`);
      console.log(`  color_primaries=${probed.colorPrimaries || "(unset)"}`);
      console.log(`  color_space=${probed.colorSpace || "(unset)"}`);
      console.log(`  side_data=[${probed.sideDataTypes.join(", ") || "none"}]`);

      const errors = checkExpectations(fixture.id, probed, fixture.expected);
      if (errors.length === 0) {
        console.log(`  PASS`);
      } else {
        console.log(`  FAIL:`);
        errors.forEach((e) => console.log(`    - ${e}`));
        allErrors.push(...errors);
        if (!firstFailingFixture) firstFailingFixture = fixture.id;
      }
    }
  } finally {
    if (keepTemp) {
      console.log(`\nKEEP_TEMP=1 — leaving ${tempRoot} on disk`);
    } else {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch (e) {
        console.warn(`Failed to clean up ${tempRoot}: ${e}`);
      }
    }
  }

  console.log("\n=== summary ===");
  console.log(`fixtures: ${targets.length}`);
  console.log(`failures: ${allErrors.length}`);
  if (allErrors.length > 0) {
    console.log(`first failure: ${firstFailingFixture}`);
    return 1;
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("hdr-smoke crashed:", err);
    process.exit(2);
  });
