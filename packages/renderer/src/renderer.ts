/**
 * HyperframesRenderer
 *
 * Main orchestrator for the client-side rendering pipeline.
 * Coordinates iframe pool, frame capture, encoding, audio mixing,
 * and muxing into a final MP4/WebM Blob.
 */

import { calculateConcurrency, IframePool } from "./capture/iframe-pool.js";
import { Encoder } from "./encoding/encoder.js";
import { SnapdomFrameSource } from "./sources/snapdom.js";
import { mixAudio } from "./audio/mixer.js";
import { generateFrameTimes } from "./utils/timing.js";
import { isSupported } from "./compat.js";
import type { RenderConfig, RenderProgress, RenderResult, AudioSource } from "./types.js";

// ── Codec mapping ─────────────────────────────────────────────────────────────

const CODEC_MAP: Record<"h264" | "vp9", "avc1.640028" | "vp09.00.31.08"> = {
  h264: "avc1.640028",
  vp9: "vp09.00.31.08",
};

// ── Bitrate heuristic ─────────────────────────────────────────────────────────

function calculateBitrate(width: number, height: number): number {
  // 4 Mbps baseline for 1080p (1920×1080 = 2_073_600 pixels)
  const baselinePixels = 1920 * 1080;
  const pixels = width * height;
  return Math.round((4_000_000 * pixels) / baselinePixels);
}

// ── CancelledError ────────────────────────────────────────────────────────────

export class CancelledError extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "CancelledError";
  }
}

// ── HyperframesRenderer ───────────────────────────────────────────────────────

export class HyperframesRenderer {
  private config: RenderConfig;
  private cancelled = false;
  private pool: IframePool | null = null;
  private encoder: Encoder | null = null;

  constructor(config: RenderConfig) {
    this.config = config;
  }

  cancel(): void {
    this.cancelled = true;
  }

  async render(): Promise<RenderResult> {
    if (!isSupported()) {
      throw new Error(
        "Client-side rendering not supported. Requires WebCodecs (Chrome 94+, Firefox 130+, Safari 26+).",
      );
    }

    const totalStart = performance.now();
    this.cancelled = false;

    // ── Resolve config defaults ───────────────────────────────────────────────
    const fps = this.config.fps ?? 30;
    const width = this.config.width ?? 1920;
    const height = this.config.height ?? 1080;
    const format = this.config.format ?? "mp4";
    const codecKey = this.config.codec ?? "h264";
    const codec = CODEC_MAP[codecKey];
    const bitrate = this.config.bitrate ?? calculateBitrate(width, height);
    const concurrency =
      this.config.concurrency ??
      calculateConcurrency(typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4);
    const devicePixelRatio = this.config.devicePixelRatio ?? 1;

    const report = (progress: RenderProgress) => this.config.onProgress?.(progress);

    report({ stage: "initializing", progress: 0 });

    this.throwIfCancelled();

    // ── Step 1: Initialise iframe pool + frame sources ────────────────────────
    const pool = new IframePool();
    this.pool = pool;

    const { duration, media } = await pool.init({
      compositionUrl: this.config.composition,
      width,
      height,
      devicePixelRatio,
      concurrency,
      createFrameSource: () => new SnapdomFrameSource(),
    });

    this.throwIfCancelled();

    // ── Step 2: Generate frame timestamps ─────────────────────────────────────
    const frameTimes = generateFrameTimes(duration, fps);
    const totalFrames = frameTimes.length;

    if (totalFrames === 0) {
      await pool.dispose();
      throw new Error("Composition has zero duration — nothing to render");
    }

    // ── Step 3: Initialise encoder ────────────────────────────────────────────
    const encoder = new Encoder({
      width,
      height,
      fps,
      codec,
      bitrate,
      format,
      workerUrl: this.config.workerUrl,
      onFrameEncoded: (index) => {
        const encodingProgress = (index + 1) / totalFrames;
        report({
          stage: "encoding",
          progress: 0.1 + encodingProgress * 0.6,
          currentFrame: index + 1,
          totalFrames,
        });
      },
    });
    this.encoder = encoder;

    await encoder.init();
    this.throwIfCancelled();

    // ── Step 4: Capture frames + stream to encoder with reorder buffer ─────────
    const captureStart = performance.now();

    report({ stage: "capturing", progress: 0.05, currentFrame: 0, totalFrames });

    // Reorder buffer: frames arrive out of order from parallel iframes.
    // We buffer them and flush runs of consecutive frames to the encoder.
    const reorderBuffer = new Map<number, ImageBitmap>();
    let nextExpected = 0;
    let capturedCount = 0;

    const frameDuration = 1 / fps;

    const flushBuffer = () => {
      while (reorderBuffer.has(nextExpected)) {
        const bitmap = reorderBuffer.get(nextExpected)!;
        reorderBuffer.delete(nextExpected);
        const timestamp = Math.round(nextExpected * frameDuration * 1_000_000); // microseconds
        encoder.sendFrame(bitmap, nextExpected, timestamp);
        nextExpected++;
      }
    };

    await pool.captureAll(frameTimes, ({ bitmap, index }) => {
      if (this.cancelled) {
        bitmap.close();
        return;
      }

      reorderBuffer.set(index, bitmap);
      capturedCount++;

      const captureProgress = capturedCount / totalFrames;
      report({
        stage: "capturing",
        progress: 0.05 + captureProgress * 0.05,
        currentFrame: capturedCount,
        totalFrames,
      });

      flushBuffer();
    });

    // Flush any remaining buffered frames
    flushBuffer();

    const captureMs = performance.now() - captureStart;

    await pool.dispose();
    this.pool = null;

    this.throwIfCancelled();

    // ── Step 5: Mix audio ─────────────────────────────────────────────────────
    const audioStart = performance.now();

    report({ stage: "mixing-audio", progress: 0.7 });

    const audioSources: AudioSource[] = media
      .filter((m) => m.hasAudio === true)
      .map((m) => ({
        src: m.src,
        startTime: m.startTime,
        endTime: m.endTime,
        mediaOffset: m.mediaOffset,
        volume: m.volume,
      }));

    if (audioSources.length > 0) {
      const mixResult = await mixAudio({
        duration,
        sources: audioSources,
      });

      const channelData: Float32Array[] = [];
      for (let c = 0; c < mixResult.channels; c++) {
        channelData.push(mixResult.buffer.getChannelData(c));
      }
      encoder.setAudio(channelData, mixResult.sampleRate);
    }

    const audioMs = performance.now() - audioStart;

    this.throwIfCancelled();

    // ── Step 6: Mux video + audio ─────────────────────────────────────────────
    report({ stage: "muxing", progress: 0.85 });

    const encodeStart = performance.now();
    const blob = await encoder.finalize();
    const encodeMs = performance.now() - encodeStart;

    encoder.dispose();
    this.encoder = null;

    // ── Step 7: Return result ─────────────────────────────────────────────────
    const totalMs = performance.now() - totalStart;
    const framesPerSecond = totalFrames / (totalMs / 1000);
    const mimeType = format === "mp4" ? "video/mp4" : "video/webm";

    report({ stage: "complete", progress: 1, totalFrames });

    return {
      blob,
      mimeType,
      durationMs: totalMs,
      perf: {
        captureMs,
        encodeMs,
        audioMs,
        muxMs: encodeMs,
        totalMs,
        framesPerSecond,
      },
    };
  }

  private throwIfCancelled(): void {
    if (this.cancelled) {
      this.pool?.dispose().catch(() => {});
      this.encoder?.dispose();
      throw new CancelledError();
    }
  }
}
