/**
 * Encoder
 *
 * Main-thread wrapper that manages the encoding Web Worker.
 * Sends ImageBitmap frames to the worker and receives the final MP4 blob.
 */

import type { WorkerInMessage, WorkerOutMessage } from "./types.js";

export interface EncoderOptions {
  width: number;
  height: number;
  fps: number;
  codec: string;
  bitrate: number;
  format: "mp4" | "webm";
  onFrameEncoded?: (index: number) => void;
  workerUrl?: URL | string;
}

export class Encoder {
  private worker: Worker | null = null;
  private options: EncoderOptions;
  private resolveReady: (() => void) | null = null;
  private resolveDone: ((blob: Blob) => void) | null = null;
  private rejectPending: ((err: Error) => void) | null = null;

  constructor(options: EncoderOptions) {
    this.options = options;
  }

  async init(): Promise<void> {
    const workerUrl = this.options.workerUrl ?? new URL("./worker.js", import.meta.url);
    this.worker = new Worker(workerUrl, {
      type: "module",
    });

    this.worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      this.handleMessage(e.data);
    };

    this.worker.onerror = (e) => {
      this.rejectPending?.(new Error(`Worker error: ${e.message}`));
    };

    await new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectPending = reject;

      const msg: WorkerInMessage = {
        type: "init",
        config: {
          width: this.options.width,
          height: this.options.height,
          fps: this.options.fps,
          codec: this.options.codec,
          bitrate: this.options.bitrate,
          format: this.options.format,
        },
      };
      this.worker!.postMessage(msg);
    });
  }

  sendFrame(bitmap: ImageBitmap, index: number, timestamp: number): void {
    if (!this.worker) throw new Error("Encoder not initialized");
    const msg: WorkerInMessage = { type: "frame", bitmap, index, timestamp };
    this.worker.postMessage(msg, [bitmap]);
  }

  setAudio(channelData: Float32Array[], sampleRate: number): void {
    if (!this.worker) throw new Error("Encoder not initialized");
    const msg: WorkerInMessage = { type: "set-audio", channelData, sampleRate };
    this.worker.postMessage(
      msg,
      channelData.map((c) => c.buffer),
    );
  }

  async finalize(): Promise<Blob> {
    if (!this.worker) throw new Error("Encoder not initialized");
    return new Promise<Blob>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectPending = reject;
      const msg: WorkerInMessage = { type: "finalize" };
      this.worker!.postMessage(msg);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
  }

  private handleMessage(msg: WorkerOutMessage): void {
    switch (msg.type) {
      case "ready":
        this.resolveReady?.();
        this.resolveReady = null;
        break;
      case "frame-encoded":
        this.options.onFrameEncoded?.(msg.index);
        break;
      case "done":
        this.resolveDone?.(msg.blob);
        this.resolveDone = null;
        break;
      case "error":
        this.rejectPending?.(new Error(msg.message));
        this.rejectPending = null;
        break;
    }
  }
}
