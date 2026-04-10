/**
 * SnapDOM Frame Source
 *
 * Captures DOM snapshots from an iframe-loaded composition
 * using @zumer/snapdom, then converts to ImageBitmap for
 * transfer to the encoding worker.
 */

import { snapdom } from "@zumer/snapdom";
import { VideoFrameInjector } from "../capture/video-frame-injector.js";
import type { FrameSource, FrameSourceConfig, HfMediaElement } from "../types.js";

interface HfProtocol {
  duration: number;
  seek(time: number): void;
  media?: HfMediaElement[];
}

export class SnapdomFrameSource implements FrameSource {
  readonly name = "snapdom";

  private iframe: HTMLIFrameElement | null = null;
  private config: FrameSourceConfig | null = null;
  private hf: HfProtocol | null = null;
  private _duration = 0;
  private _media: HfMediaElement[] = [];
  private videoInjector: VideoFrameInjector | null = null;

  get duration(): number {
    return this._duration;
  }

  get media(): HfMediaElement[] {
    return this._media;
  }

  async init(config: FrameSourceConfig): Promise<void> {
    this.config = config;

    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-9999px";
    iframe.style.left = "-9999px";
    iframe.style.width = `${config.width}px`;
    iframe.style.height = `${config.height}px`;
    iframe.style.border = "none";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    document.body.appendChild(iframe);
    this.iframe = iframe;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Composition load timeout (10s)")), 10_000);
      iframe.onload = () => {
        clearTimeout(timeout);
        resolve();
      };
      iframe.onerror = () => {
        clearTimeout(timeout);
        reject(new Error(`Failed to load composition: ${config.compositionUrl}`));
      };
      iframe.src = config.compositionUrl;
    });

    // Wait for window.__hf to become available (runtime init is async)
    const hf = await this.waitForHfProtocol(iframe);
    this.hf = hf;
    this._duration = hf.duration;
    this._media = hf.media ?? [];

    const videoMedia = this._media.filter((m) => {
      const el = this.iframe!.contentDocument?.getElementById(m.elementId);
      return el?.tagName === "VIDEO";
    });
    if (videoMedia.length > 0) {
      this.videoInjector = new VideoFrameInjector();
      await this.videoInjector.init(videoMedia, this.iframe!.contentDocument!);
    }
  }

  async capture(time: number): Promise<ImageBitmap> {
    if (!this.iframe || !this.hf || !this.config) {
      throw new Error("SnapdomFrameSource not initialized — call init() first");
    }

    this.hf.seek(time);

    if (this.videoInjector) {
      await this.videoInjector.injectFrame(time);
    }

    const doc = this.iframe.contentDocument;
    if (!doc?.documentElement) {
      throw new Error("iframe has no document");
    }

    const canvas = await snapdom.toCanvas(doc.documentElement, {
      width: this.config.width,
      height: this.config.height,
      scale: this.config.devicePixelRatio ?? 1,
    });

    return createImageBitmap(canvas);
  }

  async dispose(): Promise<void> {
    this.videoInjector?.dispose();
    this.videoInjector = null;

    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.hf = null;
    this.config = null;
    this._duration = 0;
    this._media = [];
  }

  private waitForHfProtocol(iframe: HTMLIFrameElement, timeoutMs = 10_000): Promise<HfProtocol> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        const win = iframe.contentWindow as (Window & { __hf?: HfProtocol }) | null;
        if (win?.__hf && typeof win.__hf.seek === "function" && win.__hf.duration > 0) {
          resolve(win.__hf);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timed out waiting for window.__hf protocol"));
          return;
        }
        requestAnimationFrame(poll);
      };
      poll();
    });
  }
}
