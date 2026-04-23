import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  __createFrameDataUriCacheForTests as createCache,
  createEmptyInjectorCacheStats,
} from "./videoFrameInjector.js";

// The injector's frame-dataURI LRU is what the performance review flags as
// bottleneck #8 (disk reads per frame). These tests validate the cumulative
// counters that the producer exposes via `RenderPerfSummary.injectorStats`
// so future PRs — the extraction-cache work in particular — have a trustable
// hit-rate signal to compare against.
describe("InjectorCacheStats via frame-dataURI LRU", () => {
  const FIXTURE_DIR = mkdtempSync(join(tmpdir(), "hf-injector-stats-"));
  const FRAME_A = join(FIXTURE_DIR, "a.jpg");
  const FRAME_B = join(FIXTURE_DIR, "b.jpg");
  const FRAME_C = join(FIXTURE_DIR, "c.jpg");

  beforeAll(() => {
    // Content is irrelevant — the cache keys on path and base64-encodes the bytes.
    writeFileSync(FRAME_A, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    writeFileSync(FRAME_B, Buffer.from([0xff, 0xd8, 0xff, 0xe1]));
    writeFileSync(FRAME_C, Buffer.from([0xff, 0xd8, 0xff, 0xe2]));
  });

  afterAll(() => {
    rmSync(FIXTURE_DIR, { recursive: true, force: true });
  });

  it("counts a miss on first read and a hit on re-read", async () => {
    const stats = createEmptyInjectorCacheStats();
    const cache = createCache(32, stats);

    await cache.get(FRAME_A);
    await cache.get(FRAME_A);

    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.inFlightCoalesced).toBe(0);
    expect(stats.peakEntries).toBe(1);
  });

  it("coalesces concurrent reads of the same path into one miss", async () => {
    const stats = createEmptyInjectorCacheStats();
    const cache = createCache(32, stats);

    const [a, b, c] = await Promise.all([
      cache.get(FRAME_B),
      cache.get(FRAME_B),
      cache.get(FRAME_B),
    ]);

    expect(a).toBe(b);
    expect(b).toBe(c);
    // Exactly one disk read is issued, and the other two concurrent requests
    // are tallied as coalesced.
    expect(stats.misses).toBe(1);
    expect(stats.inFlightCoalesced).toBe(2);
    expect(stats.hits).toBe(0);
  });

  it("tracks peakEntries as the LRU fills", async () => {
    const stats = createEmptyInjectorCacheStats();
    const cache = createCache(32, stats);

    await cache.get(FRAME_A);
    await cache.get(FRAME_B);
    await cache.get(FRAME_C);

    expect(stats.peakEntries).toBe(3);
  });

  it("evicts under pressure without inflating peakEntries past the limit", async () => {
    const stats = createEmptyInjectorCacheStats();
    // Tiny limit forces eviction after 2 inserts.
    const cache = createCache(2, stats);

    await cache.get(FRAME_A);
    await cache.get(FRAME_B);
    await cache.get(FRAME_C);

    expect(stats.peakEntries).toBe(2);
    // FRAME_A was evicted when FRAME_C was inserted — re-reading it is a miss.
    await cache.get(FRAME_A);
    expect(stats.misses).toBe(4);
  });

  it("leaves counters untouched when no stats object is provided", async () => {
    // Regression guard: the sentinel check in the cache (stats != null) is the
    // only thing keeping existing callers' performance unchanged. This test
    // simply exercises the path and confirms nothing throws.
    const cache = createCache(32);
    await expect(cache.get(FRAME_A)).resolves.toMatch(/^data:image\/jpeg;base64,/);
  });
});
