/**
 * Turbo Pool — Multi-Tab Parallel Capture
 *
 * Opens N browser tabs (via window.open with noopener) to achieve
 * true multi-process parallelism for SnapDOM frame capture. Each tab
 * runs in its own Chromium renderer process with independent main thread.
 *
 * Communication via BroadcastChannel. Frames are PNG-encoded since
 * BroadcastChannel doesn't support transferable ImageBitmaps.
 */

import type { HfMediaElement } from "../types.js";
import { distributeFrames } from "../utils/timing.js";

export interface TurboPoolConfig {
  compositionUrl: string;
  width: number;
  height: number;
  devicePixelRatio?: number;
  concurrency: number;
  /** URL to the turbo-worker.html page that loads the worker script */
  turboWorkerUrl: string;
}

export interface TurboCapturedFrame {
  bitmap: ImageBitmap;
  index: number;
}

interface WorkerState {
  id: string;
  window: Window | null;
  ready: boolean;
  done: boolean;
  error?: string;
}

export function calculateTurboConcurrency(): number {
  const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4;
  return Math.max(2, Math.min(Math.floor(cores / 2), 6));
}

export class TurboPool {
  private workers: WorkerState[] = [];
  private channel: BroadcastChannel | null = null;
  private sessionId = crypto.randomUUID().slice(0, 8);
  private config: TurboPoolConfig | null = null;

  get supported(): boolean {
    return typeof BroadcastChannel !== "undefined" && typeof window?.open === "function";
  }

  async init(config: TurboPoolConfig): Promise<{ duration: number; media: HfMediaElement[] }> {
    this.config = config;
    const channelName = `hf-turbo-${this.sessionId}`;
    this.channel = new BroadcastChannel(channelName);

    // Open worker tabs
    const workerPromises: Promise<void>[] = [];

    for (let i = 0; i < config.concurrency; i++) {
      const workerId = `w${i}-${this.sessionId}`;
      const workerUrl = `${config.turboWorkerUrl}?channel=${encodeURIComponent(channelName)}&workerId=${encodeURIComponent(workerId)}`;

      const win = window.open(workerUrl, "_blank", "width=1,height=1,left=-9999,top=-9999");

      if (!win) {
        // Popup blocked — clean up and signal failure
        await this.dispose();
        throw new Error("POPUP_BLOCKED");
      }

      // Minimize the popup to reduce visual noise
      try {
        win.blur();
      } catch {
        // cross-origin after navigation — expected
      }

      const worker: WorkerState = { id: workerId, window: win, ready: false, done: false };
      this.workers.push(worker);

      // Wait for this worker to report ready
      workerPromises.push(
        new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error(`Worker ${workerId} init timeout`)),
            30_000,
          );

          const onMessage = (e: MessageEvent) => {
            if (e.data?.workerId !== workerId) return;
            if (e.data.type === "ready") {
              worker.ready = true;
              clearTimeout(timeout);
              this.channel!.removeEventListener("message", onMessage);
              resolve();
            } else if (e.data.type === "error") {
              clearTimeout(timeout);
              this.channel!.removeEventListener("message", onMessage);
              reject(new Error(e.data.message));
            }
          };
          this.channel!.addEventListener("message", onMessage);
        }),
      );

      // Send init message to this worker
      this.channel.postMessage({
        type: "init",
        workerId,
        compositionUrl: config.compositionUrl,
        width: config.width,
        height: config.height,
        dpr: config.devicePixelRatio ?? 1,
      });
    }

    // Wait for all workers to initialize
    await Promise.all(workerPromises);

    // Get duration from the first worker's ready message
    // (we need a separate query — workers report duration in their ready message)
    // For now, init a temporary local source to get duration/media
    const { SnapdomFrameSource } = await import("../sources/snapdom.js");
    const tempSource = new SnapdomFrameSource();
    await tempSource.init({
      compositionUrl: config.compositionUrl,
      width: config.width,
      height: config.height,
      devicePixelRatio: config.devicePixelRatio,
    });
    const duration = tempSource.duration;
    const media = [...tempSource.media];
    await tempSource.dispose();

    return { duration, media };
  }

  async captureAll(
    frameTimes: number[],
    onFrame: (frame: TurboCapturedFrame) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!this.channel || this.workers.length === 0) {
      throw new Error("TurboPool not initialized");
    }

    const ranges = distributeFrames(frameTimes.length, this.workers.length);
    const channel = this.channel;
    let receivedCount = 0;
    const totalExpected = frameTimes.length;

    return new Promise<void>((resolve, reject) => {
      const onAbort = () => {
        channel.postMessage({ type: "abort" });
        cleanup();
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = () => {
        channel.removeEventListener("message", handleMessage);
        signal?.removeEventListener("abort", onAbort);
      };

      const handleMessage = async (e: MessageEvent) => {
        const msg = e.data;
        if (!msg?.workerId) return;

        if (msg.type === "frame") {
          try {
            // Decode PNG ArrayBuffer → ImageBitmap
            const blob = new Blob([msg.png], { type: "image/png" });
            const bitmap = await createImageBitmap(blob);
            onFrame({ bitmap, index: msg.index });
            receivedCount++;

            if (receivedCount >= totalExpected) {
              cleanup();
              resolve();
            }
          } catch (err) {
            cleanup();
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        } else if (msg.type === "error") {
          cleanup();
          reject(new Error(`Worker ${msg.workerId}: ${msg.message}`));
        }
      };

      channel.addEventListener("message", handleMessage);

      // Send capture assignments to each worker
      for (let i = 0; i < ranges.length; i++) {
        const range = ranges[i]!;
        const worker = this.workers[i]!;
        const frames: { index: number; time: number }[] = [];
        for (let j = range.start; j <= range.end; j++) {
          frames.push({ index: j, time: frameTimes[j]! });
        }
        channel.postMessage({
          type: "capture",
          workerId: worker.id,
          frames,
        });
      }
    });
  }

  async dispose(): Promise<void> {
    if (this.channel) {
      this.channel.postMessage({ type: "abort" });
      this.channel.close();
      this.channel = null;
    }
    // Close worker windows
    for (const worker of this.workers) {
      try {
        worker.window?.close();
      } catch {
        // noopener windows may not be closeable
      }
    }
    this.workers = [];
    this.config = null;
  }
}
