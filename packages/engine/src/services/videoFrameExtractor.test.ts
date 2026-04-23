import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import {
  parseVideoElements,
  parseImageElements,
  extractAllVideoFrames,
  shouldEnableHwaccelSdr,
  type VideoElement,
} from "./videoFrameExtractor.js";
import { extractVideoMetadata } from "../utils/ffprobe.js";
import { runFfmpeg } from "../utils/runFfmpeg.js";

// ffmpeg is not preinstalled on GitHub's ubuntu-24.04 runners. The producer
// regression test at packages/producer/tests/vfr-screen-recording/ runs inside
// Dockerfile.test (which does include ffmpeg) and is the primary CI signal
// for this bug. Locally and in any CI job with ffmpeg on PATH, the tests
// below run too — they exercise the extractor in isolation against a
// synthesized VFR fixture.
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0;

// Gating logic that controls whether -hwaccel auto gets added to the
// Phase 3 ffmpeg args. The architecture review explicitly cautions
// against a blanket default; these cases are the fence posts it names.
describe("shouldEnableHwaccelSdr", () => {
  const defaults = { hwaccelSdrDecode: true, hwaccelMinDurationSeconds: 2.0 };

  it("enables hwaccel for a long opaque SDR input", () => {
    expect(
      shouldEnableHwaccelSdr({
        isHdr: false,
        hasAlpha: false,
        durationSeconds: 30,
        config: defaults,
      }),
    ).toBe(true);
  });

  it("disables hwaccel when the source has an alpha plane", () => {
    // Hardware decoders silently drop alpha — this guard is the whole
    // reason PR 5 doesn't land as a blanket default.
    expect(
      shouldEnableHwaccelSdr({
        isHdr: false,
        hasAlpha: true,
        durationSeconds: 30,
        config: defaults,
      }),
    ).toBe(false);
  });

  it("disables hwaccel for HDR sources (HDR path has its own VideoToolbox handling)", () => {
    expect(
      shouldEnableHwaccelSdr({
        isHdr: true,
        hasAlpha: false,
        durationSeconds: 30,
        config: defaults,
      }),
    ).toBe(false);
  });

  it("disables hwaccel when segment duration is below the floor", () => {
    // Init cost of a hwaccel context often wipes out any decode speedup
    // on sub-2-second segments. The floor is tunable per platform.
    expect(
      shouldEnableHwaccelSdr({
        isHdr: false,
        hasAlpha: false,
        durationSeconds: 1.5,
        config: defaults,
      }),
    ).toBe(false);
  });

  it("respects the hwaccelSdrDecode master switch", () => {
    expect(
      shouldEnableHwaccelSdr({
        isHdr: false,
        hasAlpha: false,
        durationSeconds: 30,
        config: { hwaccelSdrDecode: false, hwaccelMinDurationSeconds: 2.0 },
      }),
    ).toBe(false);
  });

  it("honors a lowered duration floor (platforms where init cost is negligible)", () => {
    expect(
      shouldEnableHwaccelSdr({
        isHdr: false,
        hasAlpha: false,
        durationSeconds: 0.5,
        config: { hwaccelSdrDecode: true, hwaccelMinDurationSeconds: 0.25 },
      }),
    ).toBe(true);
  });

  it("enables right at the duration floor (inclusive boundary)", () => {
    expect(
      shouldEnableHwaccelSdr({
        isHdr: false,
        hasAlpha: false,
        durationSeconds: 2.0,
        config: defaults,
      }),
    ).toBe(true);
  });
});

describe("parseVideoElements", () => {
  it("parses videos without an id or data-start attribute", () => {
    const videos = parseVideoElements('<video src="clip.mp4"></video>');

    expect(videos).toHaveLength(1);
    expect(videos[0]).toMatchObject({
      id: "hf-video-0",
      src: "clip.mp4",
      start: 0,
      end: Infinity,
      mediaStart: 0,
      hasAudio: false,
    });
  });

  it("preserves explicit ids and derives end from data-duration", () => {
    const videos = parseVideoElements(
      '<video id="hero" src="clip.mp4" data-start="2" data-duration="5" data-media-start="1.5" data-has-audio="true"></video>',
    );

    expect(videos).toHaveLength(1);
    expect(videos[0]).toEqual({
      id: "hero",
      src: "clip.mp4",
      start: 2,
      end: 7,
      mediaStart: 1.5,
      hasAudio: true,
    });
  });
});

describe("parseImageElements", () => {
  it("parses images with data-start and data-duration", () => {
    const images = parseImageElements(
      '<img id="photo" src="hdr-photo.png" data-start="0" data-duration="3" />',
    );

    expect(images).toHaveLength(1);
    expect(images[0]).toEqual({
      id: "photo",
      src: "hdr-photo.png",
      start: 0,
      end: 3,
    });
  });

  it("generates stable IDs for images without one", () => {
    const images = parseImageElements(
      '<img src="a.png" data-start="0" data-end="2" /><img src="b.png" data-start="1" data-end="4" />',
    );

    expect(images).toHaveLength(2);
    expect(images[0]!.id).toBe("hf-img-0");
    expect(images[1]!.id).toBe("hf-img-1");
  });

  it("defaults start to 0 and end to Infinity when attributes missing", () => {
    const images = parseImageElements('<img src="photo.png" />');

    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({
      src: "photo.png",
      start: 0,
      end: Infinity,
    });
  });

  it("ignores img elements without src", () => {
    const images = parseImageElements('<img data-start="0" data-end="3" />');
    expect(images).toHaveLength(0);
  });

  it("uses data-end over data-duration when both present", () => {
    const images = parseImageElements(
      '<img src="a.png" data-start="1" data-end="5" data-duration="10" />',
    );
    expect(images[0]!.end).toBe(5);
  });
});

// Regression test for the VFR (variable frame rate) freeze bug.
// Screen recordings and phone videos often have irregular timestamps.
// When such inputs hit `extractVideoFramesRange`'s `-ss <start> -i ... -t <dur>
// -vf fps=N` pipeline, the fps filter can emit fewer frames than requested —
// e.g. a 4-second segment at 30fps would produce ~90 frames instead of 120.
// FrameLookupTable.getFrameAtTime then returns null for out-of-range indices
// and the compositor holds the last valid frame, which the user perceives as
// the video freezing. extractAllVideoFrames normalizes VFR sources to CFR
// before extraction to fix this.
describe.skipIf(!HAS_FFMPEG)("extractAllVideoFrames on a VFR source", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-vfr-test-"));
  const VFR_FIXTURE = join(FIXTURE_DIR, "vfr_screen.mp4");

  beforeAll(async () => {
    // 10s testsrc2 at 60fps, ~40% of frames dropped via select filter and
    // encoded with -vsync vfr so timestamps are irregular. Declared fps 60,
    // actual average ~36 — well over the 10% threshold used by isVFR.
    // The select expression drops four 1-second windows (frames 30-89,
    // 180-239, 330-389, 480-539) to simulate static segments in a screen
    // recording where no pixels changed.
    // -g/-keyint_min 600 forces a single keyframe so mid-segment seeks in the
    // mediaStart=3 test don't snap to an intermediate IDR and drift the count.
    const result = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=320x180:d=10:rate=60",
      "-vf",
      "drawtext=text='n=%{n}':fontsize=24:fontcolor=white:x=10:y=10:box=1:boxcolor=black@0.6," +
        "select='not(between(n,30,89))*not(between(n,180,239))*not(between(n,330,389))*not(between(n,480,539))'",
      "-vsync",
      "vfr",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "600",
      "-keyint_min",
      "600",
      VFR_FIXTURE,
    ]);
    if (!result.success) {
      throw new Error(
        `ffmpeg fixture synthesis failed (${result.exitCode}): ${result.stderr.slice(-400)}`,
      );
    }
  }, 30_000);

  afterAll(() => {
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("detects the synthesized fixture as VFR", async () => {
    const md = await extractVideoMetadata(VFR_FIXTURE);
    expect(md.isVFR).toBe(true);
  });

  it("produces the expected frame count for a mid-file segment", async () => {
    const outputDir = join(FIXTURE_DIR, "out-mid-segment");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "v1",
      src: VFR_FIXTURE,
      start: 0,
      end: 4,
      mediaStart: 3,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.extracted).toHaveLength(1);
    const frames = readdirSync(join(outputDir, "v1")).filter((f) => f.endsWith(".jpg"));
    // Pre-fix behavior produced ~90 frames (a 25% shortfall).
    expect(frames.length).toBeGreaterThanOrEqual(119);
    expect(frames.length).toBeLessThanOrEqual(121);
  }, 60_000);

  // Asserts both frame-count correctness and that we don't emit long runs of
  // byte-identical "duplicate" frames — the user-visible "frozen screen
  // recording" symptom. Pre-fix duplicate rate on this fixture is ~38%
  // (116/300); on the actual reporter's ScreenCaptureKit clip, 18–44% across
  // segments. <10% threshold leaves margin across ffmpeg versions without
  // letting a regression slip through.
  it("populates phaseBreakdown with timings for resolve, probe, VFR preflight, and extract", async () => {
    const outputDir = join(FIXTURE_DIR, "out-phase-breakdown");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "vbreak",
      src: VFR_FIXTURE,
      start: 0,
      end: 2,
      mediaStart: 0,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    const pb = result.phaseBreakdown;
    // Each phase ran; non-negative is the only universal invariant since
    // resolveMs can round to 0 on fast local paths.
    expect(pb.resolveMs).toBeGreaterThanOrEqual(0);
    expect(pb.probeMs).toBeGreaterThanOrEqual(0);
    expect(pb.hdrPreflightMs).toBeGreaterThanOrEqual(0);
    expect(pb.vfrPreflightMs).toBeGreaterThanOrEqual(0);
    expect(pb.extractMs).toBeGreaterThan(0);
    // The VFR fixture is synthesized with irregular timestamps, so the VFR
    // preflight must have actually run and been counted.
    expect(pb.vfrPreflightCount).toBe(1);
    expect(pb.vfrPreflightMs).toBeGreaterThan(0);
    // No HDR source, so the HDR preflight is skipped entirely.
    expect(pb.hdrPreflightCount).toBe(0);
    expect(pb.hdrPreflightMs).toBe(0);
    // Phases are bounded by total wall time (allow 50ms slack for timer
    // resolution + overhead between the Date.now() samples).
    const phaseSum = pb.resolveMs + pb.probeMs + pb.vfrPreflightMs + pb.extractMs;
    expect(phaseSum).toBeLessThanOrEqual(result.durationMs + 50);
  }, 60_000);

  it("produces the full frame count and no duplicate-frame runs on the full VFR file", async () => {
    const outputDir = join(FIXTURE_DIR, "out-full");
    mkdirSync(outputDir, { recursive: true });

    const video: VideoElement = {
      id: "vfull",
      src: VFR_FIXTURE,
      start: 0,
      end: 10,
      mediaStart: 0,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([video], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });
    expect(result.errors).toEqual([]);

    const frameDir = join(outputDir, "vfull");
    const frames = readdirSync(frameDir)
      .filter((f) => f.endsWith(".jpg"))
      .sort();
    expect(frames.length).toBeGreaterThanOrEqual(299);
    expect(frames.length).toBeLessThanOrEqual(301);

    let prevHash: string | null = null;
    let duplicates = 0;
    for (const f of frames) {
      const hash = createHash("sha256")
        .update(readFileSync(join(frameDir, f)))
        .digest("hex");
      if (hash === prevHash) duplicates += 1;
      prevHash = hash;
    }
    const duplicateRate = duplicates / frames.length;
    expect(duplicateRate).toBeLessThan(0.1);
  }, 60_000);
});

// Regression test for the segment-scoped SDR→HDR preflight. Before this
// change the preflight re-encoded the full source — for a 4-second window
// of a 60-minute recording this was the difference between seconds and
// minutes of pipeline time. The fix mirrors what convertVfrToCfr already
// does. Validation: the converted file's on-disk duration must match the
// composition window, not the source's natural duration.
describe.skipIf(!HAS_FFMPEG)("extractAllVideoFrames with mixed HDR/SDR segment scoping", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-hdr-scope-test-"));
  const SDR_LONG = join(FIXTURE_DIR, "sdr_long.mp4");
  const HDR_SHORT = join(FIXTURE_DIR, "hdr_short.mp4");

  beforeAll(async () => {
    // 10-second SDR source — the "long recording" we want to AVOID
    // re-encoding in full.
    const sdrResult = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x120:d=10:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      SDR_LONG,
    ]);
    if (!sdrResult.success) {
      throw new Error(`SDR fixture synthesis failed: ${sdrResult.stderr.slice(-400)}`);
    }

    // 2-second HDR-tagged source. ffprobe picks up colorspace/primaries/
    // transfer tags and returns VideoColorSpace; isHdrColorSpace() returns
    // true for colorTransfer === "arib-std-b67" (HLG), which is what the
    // Phase 2a gate checks.
    const hdrResult = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x120:d=2:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-color_primaries",
      "bt2020",
      "-color_trc",
      "arib-std-b67",
      "-colorspace",
      "bt2020nc",
      HDR_SHORT,
    ]);
    if (!hdrResult.success) {
      throw new Error(`HDR fixture synthesis failed: ${hdrResult.stderr.slice(-400)}`);
    }
  }, 30_000);

  afterAll(() => {
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("re-encodes only the used SDR window, not the full source", async () => {
    const outputDir = join(FIXTURE_DIR, "out-hdr-scope");
    mkdirSync(outputDir, { recursive: true });

    // Compose a 2-second window out of the 10-second SDR source, alongside
    // the 2-second HDR clip. Phase 2a must trigger (mixed timeline) and
    // must re-encode only 2 seconds, not 10.
    const sdrVideo: VideoElement = {
      id: "sdr-segment",
      src: SDR_LONG,
      start: 0,
      end: 2,
      mediaStart: 3,
      hasAudio: false,
    };
    const hdrVideo: VideoElement = {
      id: "hdr-clip",
      src: HDR_SHORT,
      start: 2,
      end: 4,
      mediaStart: 0,
      hasAudio: false,
    };

    const result = await extractAllVideoFrames([sdrVideo, hdrVideo], FIXTURE_DIR, {
      fps: 30,
      outputDir,
    });

    expect(result.errors).toEqual([]);
    expect(result.phaseBreakdown.hdrPreflightCount).toBe(1);
    expect(result.phaseBreakdown.hdrPreflightMs).toBeGreaterThan(0);

    // The converted file lives at {outputDir}/_hdr_normalized/{id}_hdr.mp4.
    // Before this change it would be ~10s (full source). After: ~2s (the
    // composition window).
    const convertedPath = join(outputDir, "_hdr_normalized", "sdr-segment_hdr.mp4");
    expect(existsSync(convertedPath)).toBe(true);
    const convertedMeta = await extractVideoMetadata(convertedPath);
    // 0.5s slack for codec container overhead and ffmpeg's -ss keyframe snap.
    expect(convertedMeta.durationSeconds).toBeGreaterThan(1.5);
    expect(convertedMeta.durationSeconds).toBeLessThan(2.5);

    // Phase 3 extraction still produces the expected number of frames —
    // the composition window is 2s @ 30fps = 60 frames.
    const frames = readdirSync(join(outputDir, "sdr-segment")).filter((f) => f.endsWith(".jpg"));
    expect(frames.length).toBeGreaterThanOrEqual(58);
    expect(frames.length).toBeLessThanOrEqual(62);
  }, 60_000);
});

// Integration test for the extraction cache. Verifies the first render
// populates the cache and the second render hits it (no ffmpeg spawn).
// The indirect but strong signal: phaseBreakdown.extractMs on the second
// call drops to near-zero, cacheHits goes to 1, and the cache dir
// contents are reused (not re-created). Regression guard for the
// architecture review's bottleneck #5 ("Extraction cache does not exist").
describe.skipIf(!HAS_FFMPEG)("extractAllVideoFrames with extraction cache", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-extcache-int-"));
  const SOURCE = join(FIXTURE_DIR, "cache_src.mp4");

  beforeAll(async () => {
    // 3-second SDR CFR testsrc — the simplest input that exercises the
    // extractor's Phase 3 without triggering HDR or VFR preflights (which
    // would bypass the cache, per the cache-miss note in the code).
    const result = await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=160x120:d=3:rate=30",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      SOURCE,
    ]);
    if (!result.success) {
      throw new Error(`cache-test fixture synthesis failed: ${result.stderr.slice(-400)}`);
    }
  }, 30_000);

  afterAll(() => {
    if (existsSync(FIXTURE_DIR)) rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("misses on first call, hits on second call with identical inputs", async () => {
    const cacheRoot = join(FIXTURE_DIR, "cache-root");
    mkdirSync(cacheRoot, { recursive: true });

    const video: VideoElement = {
      id: "vid",
      src: SOURCE,
      start: 0,
      end: 2,
      mediaStart: 0.5,
      hasAudio: false,
    };

    const outDir1 = join(FIXTURE_DIR, "run-1");
    mkdirSync(outDir1, { recursive: true });
    const result1 = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outDir1 },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    expect(result1.errors).toEqual([]);
    expect(result1.phaseBreakdown.cacheHits).toBe(0);
    expect(result1.phaseBreakdown.cacheMisses).toBe(1);
    expect(result1.extracted[0]?.ownedByLookup).toBe(false);
    // The first call extracted into the cache dir, not the per-render
    // outputDir — so outDir1/vid/ does NOT exist (Phase 3 took the cache
    // path exclusively).
    expect(existsSync(join(outDir1, "vid"))).toBe(false);

    const outDir2 = join(FIXTURE_DIR, "run-2");
    mkdirSync(outDir2, { recursive: true });
    const extractStart = Date.now();
    const result2 = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outDir2 },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    const elapsed = Date.now() - extractStart;

    expect(result2.errors).toEqual([]);
    expect(result2.phaseBreakdown.cacheHits).toBe(1);
    expect(result2.phaseBreakdown.cacheMisses).toBe(0);
    expect(result2.extracted[0]?.ownedByLookup).toBe(false);
    // Cache hit path is ffprobe-only — should be under ~500ms even on slow
    // CI runners vs. seconds for the ffmpeg extract. This is a soft bound:
    // the primary signal is cacheHits=1 above.
    expect(elapsed).toBeLessThan(2_000);
    // Frame counts match (cache hit returns the same frame map).
    expect(result2.extracted[0]?.totalFrames).toBe(result1.extracted[0]?.totalFrames);
  }, 60_000);

  it("writes webp frames and reuses them on a second call", async () => {
    const cacheRoot = join(FIXTURE_DIR, "cache-webp");
    mkdirSync(cacheRoot, { recursive: true });

    const video: VideoElement = {
      id: "vid",
      src: SOURCE,
      start: 0,
      end: 1,
      mediaStart: 0,
      hasAudio: false,
    };

    const out1 = join(FIXTURE_DIR, "webp-1");
    mkdirSync(out1, { recursive: true });
    const r1 = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: out1, format: "webp" },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    expect(r1.errors).toEqual([]);
    expect(r1.phaseBreakdown.cacheMisses).toBe(1);
    // Cache hit on second call confirms the on-disk files are valid webp
    // (lookupCacheEntry filters by extension); assert the file list directly
    // too so a broken libwebp encode would surface as an empty dir.
    const cacheDir = r1.extracted[0]?.outputDir;
    expect(cacheDir).toBeDefined();
    const frames = readdirSync(cacheDir!).filter((f) => f.endsWith(".webp"));
    expect(frames.length).toBeGreaterThan(0);

    const out2 = join(FIXTURE_DIR, "webp-2");
    mkdirSync(out2, { recursive: true });
    const r2 = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: out2, format: "webp" },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    expect(r2.phaseBreakdown.cacheHits).toBe(1);
    expect(r2.phaseBreakdown.cacheMisses).toBe(0);
    expect(r2.extracted[0]?.totalFrames).toBe(r1.extracted[0]?.totalFrames);
  }, 60_000);

  it("does not cross-serve a jpg cache entry as webp (format is part of the key)", async () => {
    const cacheRoot = join(FIXTURE_DIR, "cache-cross-format");
    mkdirSync(cacheRoot, { recursive: true });

    const video: VideoElement = {
      id: "vid",
      src: SOURCE,
      start: 0,
      end: 1,
      mediaStart: 0,
      hasAudio: false,
    };

    // Populate the cache with a jpg entry first.
    const outJpg = join(FIXTURE_DIR, "cross-jpg");
    mkdirSync(outJpg, { recursive: true });
    const rJpg = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outJpg, format: "jpg" },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    expect(rJpg.phaseBreakdown.cacheMisses).toBe(1);

    // Same inputs but format=webp — must be a fresh miss (different key).
    const outWebp = join(FIXTURE_DIR, "cross-webp");
    mkdirSync(outWebp, { recursive: true });
    const rWebp = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: outWebp, format: "webp" },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    expect(rWebp.phaseBreakdown.cacheHits).toBe(0);
    expect(rWebp.phaseBreakdown.cacheMisses).toBe(1);
  }, 60_000);

  it("misses again when fps changes (keyed on fps)", async () => {
    const cacheRoot = join(FIXTURE_DIR, "cache-fps");
    mkdirSync(cacheRoot, { recursive: true });

    const video: VideoElement = {
      id: "vid",
      src: SOURCE,
      start: 0,
      end: 2,
      mediaStart: 0,
      hasAudio: false,
    };

    const out1 = join(FIXTURE_DIR, "fps-1");
    mkdirSync(out1, { recursive: true });
    const r1 = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 30, outputDir: out1 },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    expect(r1.phaseBreakdown.cacheMisses).toBe(1);

    const out2 = join(FIXTURE_DIR, "fps-2");
    mkdirSync(out2, { recursive: true });
    const r2 = await extractAllVideoFrames(
      [video],
      FIXTURE_DIR,
      { fps: 24, outputDir: out2 },
      undefined,
      { extractCacheDir: cacheRoot },
    );
    // Different fps → different key → miss again, new cache entry.
    expect(r2.phaseBreakdown.cacheHits).toBe(0);
    expect(r2.phaseBreakdown.cacheMisses).toBe(1);
    // Frame count differs at different fps (24 vs 30 for the same 2s window).
    expect(r2.extracted[0]?.totalFrames).not.toBe(r1.extracted[0]?.totalFrames);
  }, 60_000);
});
