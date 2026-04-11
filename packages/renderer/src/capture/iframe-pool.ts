/**
 * Iframe Pool
 *
 * Manages N parallel hidden iframes, each loading the same composition.
 * Each iframe captures a contiguous range of frames using the provided
 * FrameSource for DOM-to-ImageBitmap conversion.
 */

import type { FrameSource, HfMediaElement } from "../types.js";
import { distributeFrames } from "../utils/timing.js";

export function calculateConcurrency(hardwareConcurrency: number): number {
  return Math.max(1, Math.min(hardwareConcurrency - 1, 8));
}

export interface IframePoolConfig {
  compositionUrl: string;
  width: number;
  height: number;
  devicePixelRatio?: number;
  concurrency: number;
  createFrameSource: () => FrameSource;
}

export interface CapturedFrame {
  bitmap: ImageBitmap;
  index: number;
  time: number;
}

export class IframePool {
  private sources: FrameSource[] = [];
  private config: IframePoolConfig | null = null;

  async init(config: IframePoolConfig): Promise<{ duration: number; media: HfMediaElement[] }> {
    this.config = config;

    // Initialize all frame sources in parallel
    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < config.concurrency; i++) {
      const source = config.createFrameSource();
      this.sources.push(source);
      initPromises.push(
        source.init({
          compositionUrl: config.compositionUrl,
          width: config.width,
          height: config.height,
          devicePixelRatio: config.devicePixelRatio,
        }),
      );
    }
    await Promise.all(initPromises);

    const first = this.sources[0]!;
    return { duration: first.duration, media: first.media };
  }

  async captureAll(
    frameTimes: number[],
    onFrame: (frame: CapturedFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const ranges = distributeFrames(frameTimes.length, this.sources.length);

    await Promise.all(
      ranges.map(async (range, workerIdx) => {
        const source = this.sources[workerIdx]!;
        for (let i = range.start; i <= range.end; i++) {
          if (signal?.aborted) return;
          const time = frameTimes[i]!;
          const bitmap = await source.capture(time);
          onFrame({ bitmap, index: i, time });
          // Yield to event loop every frame so Chrome can process CDP,
          // repaint UI, and handle user interactions during long renders
          await new Promise<void>((r) => setTimeout(r, 0));
        }
      }),
    );
  }

  async dispose(): Promise<void> {
    await Promise.all(this.sources.map((s) => s.dispose()));
    this.sources = [];
    this.config = null;
  }
}
