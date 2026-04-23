import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  CACHE_SENTINEL_FILENAME,
  computeExtractionCacheKey,
  ensureCacheEntryDir,
  lookupCacheEntry,
  markCacheEntryComplete,
  probeSourceForCacheKey,
  resolveCacheEntryPaths,
} from "./extractionCache.js";

// These tests cover the content-addressable cache that the architecture
// review calls out as the biggest wall-clock win for iteration workflows:
// on a second render of the same composition, every input should be served
// from the cache instead of being re-extracted by ffmpeg.

describe("computeExtractionCacheKey", () => {
  const base = {
    sourcePath: "/videos/clip.mp4",
    sourceMtimeMs: 1_700_000_000_000,
    sourceSize: 5_242_880,
    mediaStart: 0,
    duration: 4,
    fps: 30,
    format: "jpg" as const,
  };

  it("is deterministic for the same inputs", () => {
    const a = computeExtractionCacheKey(base);
    const b = computeExtractionCacheKey(base);
    expect(a).toBe(b);
  });

  it("prefixes the key with the schema version so a future on-disk format change cannot collide", () => {
    const key = computeExtractionCacheKey(base);
    // Shape: `v<N>-<hex>` — we don't pin N here so schema bumps (e.g. v1→v2
    // for the WebP change) stay local to the extractionCache module.
    expect(key).toMatch(/^v\d+-[0-9a-f]{32}$/);
  });

  it.each([
    ["sourcePath", { sourcePath: "/videos/other.mp4" }],
    ["sourceMtimeMs", { sourceMtimeMs: 1_700_000_000_001 }],
    ["sourceSize", { sourceSize: 5_242_881 }],
    ["mediaStart", { mediaStart: 0.5 }],
    ["duration", { duration: 4.25 }],
    ["fps", { fps: 60 }],
    ["format", { format: "png" as const }],
  ])("differs when %s changes", (_field, override) => {
    const base_key = computeExtractionCacheKey(base);
    const changed = computeExtractionCacheKey({ ...base, ...override });
    expect(changed).not.toBe(base_key);
  });

  it("treats float timing values to 6 decimal places (stable keys across equivalent floats)", () => {
    const a = computeExtractionCacheKey({ ...base, mediaStart: 1.5 });
    const b = computeExtractionCacheKey({ ...base, mediaStart: 1.5000001 });
    expect(a).toBe(b);
  });
});

describe("probeSourceForCacheKey", () => {
  const DIR = mkdtempSync(join(tmpdir(), "hf-extcache-probe-"));
  const VIDEO = join(DIR, "video.mp4");

  beforeEach(() => {
    writeFileSync(VIDEO, Buffer.from("fake video bytes"));
  });

  afterEach(() => {
    // Leave DIR in place — afterAll-style cleanup happens at test end via
    // the mkdtemp dir being removed on process exit. Explicit rm here would
    // break subsequent beforeEach writes to VIDEO.
  });

  it("returns path, mtime, and size for existing files", () => {
    const probe = probeSourceForCacheKey(VIDEO);
    expect(probe).not.toBeNull();
    expect(probe?.sourcePath).toBe(VIDEO);
    expect(probe?.sourceSize).toBe(statSync(VIDEO).size);
    expect(probe?.sourceMtimeMs).toBeGreaterThan(0);
  });

  it("returns null for a missing file", () => {
    expect(probeSourceForCacheKey(join(DIR, "does-not-exist.mp4"))).toBeNull();
  });
});

describe("lookupCacheEntry / markCacheEntryComplete", () => {
  let ROOT: string;

  beforeEach(() => {
    ROOT = mkdtempSync(join(tmpdir(), "hf-extcache-lookup-"));
  });

  afterEach(() => {
    rmSync(ROOT, { recursive: true, force: true });
  });

  it("returns null when the entry dir does not exist", () => {
    expect(lookupCacheEntry(ROOT, "v1-abc", "jpg")).toBeNull();
  });

  it("returns null when the entry dir exists but has no sentinel (partial extraction)", () => {
    const dir = ensureCacheEntryDir(ROOT, "v1-abc");
    // Write a frame but NOT the sentinel — simulates an aborted extraction.
    writeFileSync(join(dir, "frame_00001.jpg"), Buffer.from([0xff, 0xd8]));
    expect(lookupCacheEntry(ROOT, "v1-abc", "jpg")).toBeNull();
  });

  it("returns null when the sentinel exists but no frames match the requested format", () => {
    const dir = ensureCacheEntryDir(ROOT, "v1-abc");
    writeFileSync(join(dir, "frame_00001.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    markCacheEntryComplete(ROOT, "v1-abc");
    // Cache was built for PNG but we're asking for JPG — no files match,
    // treat as a miss so the caller extracts fresh.
    expect(lookupCacheEntry(ROOT, "v1-abc", "jpg")).toBeNull();
  });

  it("returns a hit with frame paths when sentinel + matching frames are present", () => {
    const dir = ensureCacheEntryDir(ROOT, "v1-abc");
    for (let i = 1; i <= 3; i++) {
      writeFileSync(
        join(dir, `frame_${String(i).padStart(5, "0")}.jpg`),
        Buffer.from([0xff, 0xd8, i]),
      );
    }
    markCacheEntryComplete(ROOT, "v1-abc");

    const hit = lookupCacheEntry(ROOT, "v1-abc", "jpg");
    expect(hit).not.toBeNull();
    expect(hit?.totalFrames).toBe(3);
    expect(hit?.framePaths.size).toBe(3);
    // Frame indices are 0-based in the map (matching ExtractedFrames semantics).
    expect(hit?.framePaths.get(0)).toBe(join(dir, "frame_00001.jpg"));
    expect(hit?.framePaths.get(2)).toBe(join(dir, "frame_00003.jpg"));
  });

  it("writes the sentinel at the expected path", () => {
    ensureCacheEntryDir(ROOT, "v1-xyz");
    markCacheEntryComplete(ROOT, "v1-xyz");
    const { sentinel } = resolveCacheEntryPaths(ROOT, "v1-xyz");
    expect(existsSync(sentinel)).toBe(true);
    expect(sentinel.endsWith(CACHE_SENTINEL_FILENAME)).toBe(true);
  });
});
