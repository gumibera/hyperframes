/**
 * Video Frame Extraction Cache
 *
 * Content-addressed cache for pre-extracted frames. When enabled, the
 * extractor checks for a completed cache entry before running FFmpeg, and
 * writes frames into the cache directory on miss. Purpose: skip Phase 3
 * entirely on iteration workflows where the same `(source, window, fps,
 * format)` pair recurs across renders.
 *
 * Keying: the cache key is a SHA-256 over a stable string of
 *   path | mtime-ms | size | mediaStart | duration | fps | format
 * plus a schema version. File-content hashing is deliberately avoided
 * because typical video sources are hundreds of MB and hashing them on
 * every render would defeat the purpose. mtime+size is a good proxy for
 * "the same file on disk"; users who mutate a file in-place at the exact
 * same size+mtime are expected to bump the cache or disable it.
 *
 * Completeness: each entry directory gets a `.hf-complete` sentinel file
 * written at the end of a successful extraction. Cache hits require the
 * sentinel — partial writes from a killed/aborted render are ignored and
 * overwritten on the next extraction.
 *
 * Concurrency: two renders that miss the same key will both extract into
 * the same cache dir. ffmpeg overwrites its own files, both touch the
 * sentinel, last-writer-wins on the sentinel timestamp. Correctness is
 * fine because the key is content-addressed; the only cost is the
 * duplicated work, which is acceptable for v1.
 *
 * Eviction: none yet. The cache grows until the user clears it. A future
 * PR adds size-capped LRU eviction.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Schema version embedded in every cache key. Bump whenever the on-disk
 * format of extracted frames changes in a way that breaks older entries.
 *
 * - v1: jpg / png output from the pre-WebP extractor.
 * - v2: adds webp as an extraction format. A v2 key for webp content can
 *   never collide with a v1 jpg/png key, so both generations can coexist
 *   under the same cache root during migration without cross-serving.
 */
const CACHE_SCHEMA_VERSION = 2;

/**
 * Sentinel filename written inside each completed cache entry directory.
 * Absence means the entry is partial or never finished — treated as a miss.
 */
export const CACHE_SENTINEL_FILENAME = ".hf-complete";

/**
 * Filename prefix shared by every extracted frame on disk. Used by ffmpeg's
 * `-y outputDir/${FRAME_FILENAME_PREFIX}%05d.${format}` and by the cache
 * lookup's directory filter — keeping them in sync via a single export
 * prevents a one-sided rename from silently producing zero cache hits.
 */
export const FRAME_FILENAME_PREFIX = "frame_";

export interface ExtractionCacheKeyInputs {
  /** Resolved absolute path to the source video file. */
  sourcePath: string;
  /** Source file mtime in ms (from statSync). */
  sourceMtimeMs: number;
  /** Source file size in bytes. */
  sourceSize: number;
  /** Start of the used window in source-media time (seconds). */
  mediaStart: number;
  /** Duration of the used window (seconds). */
  duration: number;
  /** Target fps for extracted frames. */
  fps: number;
  /** Extracted frame format ("jpg" or "png"). */
  format: "jpg" | "png" | "webp";
}

/**
 * Compute a deterministic cache key for a `(source, window, fps, format)`
 * tuple. The key encodes the schema version as a prefix so a future change
 * to the on-disk format invalidates old entries without collision.
 */
export function computeExtractionCacheKey(inputs: ExtractionCacheKeyInputs): string {
  const parts = [
    `v${CACHE_SCHEMA_VERSION}`,
    inputs.sourcePath,
    String(Math.floor(inputs.sourceMtimeMs)),
    String(inputs.sourceSize),
    inputs.mediaStart.toFixed(6),
    inputs.duration.toFixed(6),
    String(inputs.fps),
    inputs.format,
  ];
  const hash = createHash("sha256").update(parts.join("|")).digest("hex");
  // 32 hex chars (128 bits) is ample for a local cache and keeps directory
  // names short enough for every common filesystem.
  return `v${CACHE_SCHEMA_VERSION}-${hash.slice(0, 32)}`;
}

/**
 * Stat a source file and derive the inputs needed to compute a cache key.
 * Returns null if the file is missing or unreadable — callers treat that
 * as "no cache" and proceed without it.
 */
export function probeSourceForCacheKey(
  sourcePath: string,
): Pick<ExtractionCacheKeyInputs, "sourcePath" | "sourceMtimeMs" | "sourceSize"> | null {
  try {
    const st = statSync(sourcePath);
    if (!st.isFile()) return null;
    return {
      sourcePath,
      sourceMtimeMs: st.mtimeMs,
      sourceSize: st.size,
    };
  } catch {
    return null;
  }
}

export interface CacheEntryPaths {
  /** Absolute path to the cache entry directory. Created lazily by the caller. */
  dir: string;
  /** Absolute path to the sentinel file written on successful extraction. */
  sentinel: string;
}

/**
 * Resolve the on-disk paths for a cache entry given a root cache dir and a
 * computed key. Does not create the directory — that is the caller's job,
 * typically on miss before handing the path to ffmpeg.
 */
export function resolveCacheEntryPaths(cacheRoot: string, key: string): CacheEntryPaths {
  const dir = join(cacheRoot, key);
  return { dir, sentinel: join(dir, CACHE_SENTINEL_FILENAME) };
}

export interface CacheHit {
  /** Cache entry directory holding `frame_00001.jpg` (or .png) + sentinel. */
  dir: string;
  /** Map of 0-based frame index → absolute frame path. */
  framePaths: Map<number, string>;
  /** Number of frames discovered. Matches `framePaths.size`. */
  totalFrames: number;
}

/**
 * Look up a cache entry and — if complete — return the frame paths it
 * contains. Returns null for misses (missing dir, missing sentinel, no
 * matching frames). Callers should treat a null return as "extract into
 * this dir and then call `markCacheEntryComplete` on success."
 */
export function lookupCacheEntry(
  cacheRoot: string,
  key: string,
  format: "jpg" | "png" | "webp",
): CacheHit | null {
  const { dir, sentinel } = resolveCacheEntryPaths(cacheRoot, key);
  if (!existsSync(sentinel)) return null;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  const suffix = `.${format}`;
  const framePaths = new Map<number, string>();
  const matching = entries
    .filter((f) => f.startsWith(FRAME_FILENAME_PREFIX) && f.endsWith(suffix))
    .sort();
  matching.forEach((file, index) => {
    framePaths.set(index, join(dir, file));
  });

  if (framePaths.size === 0) return null;
  return { dir, framePaths, totalFrames: framePaths.size };
}

/**
 * Mark a cache entry complete by writing the sentinel file. Called only
 * after ffmpeg has finished writing every frame into the entry directory.
 */
export function markCacheEntryComplete(cacheRoot: string, key: string): void {
  const { sentinel } = resolveCacheEntryPaths(cacheRoot, key);
  writeFileSync(sentinel, "");
}

/**
 * Ensure the cache root and a specific entry directory exist. Returns the
 * absolute path of the entry directory.
 */
export function ensureCacheEntryDir(cacheRoot: string, key: string): string {
  const { dir } = resolveCacheEntryPaths(cacheRoot, key);
  // mkdirSync({recursive:true}) is idempotent — no existsSync precheck needed.
  mkdirSync(dir, { recursive: true });
  return dir;
}
