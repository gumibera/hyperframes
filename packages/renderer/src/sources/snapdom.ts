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

    // Discover media elements: prefer hf.media, fall back to DOM scan
    // (the __player → __hf bridge doesn't expose media, so we must scan)
    if (this._media.length === 0) {
      this._media = this.discoverMediaElements(this.iframe!.contentDocument!);
    }

    const videoMedia = this._media.filter((m) => {
      const el = this.iframe!.contentDocument?.getElementById(m.elementId);
      return el?.tagName === "VIDEO";
    });
    if (videoMedia.length > 0) {
      this.videoInjector = new VideoFrameInjector();
      await this.videoInjector.init(videoMedia, this.iframe!.contentDocument!);
    }

    // Warmup: seek to 0 and wait for fonts, Lottie, sub-compositions to settle.
    // Without this, the first few frames capture before external resources load.
    await this.warmup();
  }

  async capture(time: number): Promise<ImageBitmap> {
    if (!this.iframe || !this.hf || !this.config) {
      throw new Error("SnapdomFrameSource not initialized — call init() first");
    }

    this.hf.seek(time);

    // Force synchronous reflow so GSAP's CSS changes are committed before
    // SnapDOM clones the DOM. Without this, computed styles can be stale
    // and cause visible jumps in animated text/transforms.
    const doc = this.iframe.contentDocument!;
    void doc.documentElement.offsetHeight;

    // Yield for sub-composition syncs and GSAP nested timeline updates to settle.
    await new Promise<void>((r) => setTimeout(r, 4));

    if (this.videoInjector) {
      await this.videoInjector.injectFrame(time);
    }

    if (!doc.documentElement) {
      throw new Error("iframe has no document");
    }

    const canvas = await snapdom.toCanvas(doc.body, {
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

  /**
   * Scan the iframe DOM for <video> and <audio> elements with data-start/data-duration
   * attributes and build HfMediaElement descriptors. Used as fallback when
   * hf.media is not available (e.g. __player bridge).
   */
  private discoverMediaElements(doc: Document): HfMediaElement[] {
    const elements = doc.querySelectorAll(
      "video[data-start][data-duration], audio[data-start][data-duration]",
    );
    const baseUrl = doc.baseURI || this.config?.compositionUrl || "";
    const result: HfMediaElement[] = [];
    for (const el of elements) {
      const mediaEl = el as HTMLVideoElement | HTMLAudioElement;
      const id = mediaEl.id;
      if (!id) continue;
      // Resolve src against the composition's base URL so fetch() works from the main page
      const rawSrc = mediaEl.getAttribute("src") ?? "";
      const src = rawSrc ? new URL(rawSrc, baseUrl).href : "";
      const startTime = Number(mediaEl.getAttribute("data-start") ?? 0);
      const duration = Number(mediaEl.getAttribute("data-duration") ?? 0);
      const mediaOffset = Number(mediaEl.getAttribute("data-media-offset") ?? 0);
      const volume = Number(mediaEl.getAttribute("data-volume") ?? 1);
      const isVideo = mediaEl.tagName === "VIDEO";
      const isMuted = isVideo && (mediaEl as HTMLVideoElement).muted;
      result.push({
        elementId: id,
        src,
        startTime,
        endTime: startTime + duration,
        mediaOffset,
        volume,
        // Audio elements always have audio; video elements only if not muted
        hasAudio: isVideo ? !isMuted : true,
      });
    }
    return result;
  }

  /**
   * Warmup: seek to time 0 and wait for external resources (fonts, Lottie,
   * CDN scripts, sub-composition iframes) to fully load and settle.
   * Without this, the first frames capture before everything is ready.
   */
  private async warmup(): Promise<void> {
    if (!this.iframe || !this.hf) return;

    // Seek to a small time first to trigger sub-composition loading,
    // then seek back to 0 for the actual first frame
    this.hf.seek(0.1);
    await new Promise<void>((r) => setTimeout(r, 100));
    this.hf.seek(0);

    const iframeDoc = this.iframe.contentDocument;

    // Wait for fonts in the main iframe
    const fontPromises: Promise<void>[] = [];
    if (iframeDoc?.fonts) {
      fontPromises.push(iframeDoc.fonts.ready.then(() => {}).catch(() => {}));
    }

    // Wait for fonts in all sub-composition iframes
    const subIframes = iframeDoc?.querySelectorAll("iframe") ?? [];
    for (const sub of subIframes) {
      try {
        const subDoc = (sub as HTMLIFrameElement).contentDocument;
        if (subDoc?.fonts) {
          fontPromises.push(subDoc.fonts.ready.then(() => {}).catch(() => {}));
        }
      } catch {
        // cross-origin iframe — skip
      }
    }

    // Wait for all fonts with a generous timeout (CDN fonts can be slow)
    await Promise.race([Promise.all(fontPromises), new Promise<void>((r) => setTimeout(r, 5000))]);

    // Force reflow + extra settle time for GSAP, Lottie, layout
    if (iframeDoc?.documentElement) {
      void iframeDoc.documentElement.offsetHeight;
    }
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((r) => setTimeout(r, 10));
    }

    // Seek to 0 once more after everything has settled
    this.hf.seek(0);
    if (iframeDoc?.documentElement) {
      void iframeDoc.documentElement.offsetHeight;
    }
    await new Promise<void>((r) => setTimeout(r, 50));
  }

  private waitForHfProtocol(iframe: HTMLIFrameElement, timeoutMs = 10_000): Promise<HfProtocol> {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const poll = () => {
        const win = iframe.contentWindow as
          | (Window & {
              __hf?: HfProtocol;
              __player?: { renderSeek: (t: number) => void; getDuration: () => number };
              __playerReady?: boolean;
            })
          | null;

        // Check for __hf protocol (direct or CLI-compiled compositions)
        if (win?.__hf && typeof win.__hf.seek === "function" && win.__hf.duration > 0) {
          resolve(win.__hf);
          return;
        }

        // Fallback: bridge __player → __hf (studio preview compositions)
        // The studio runtime exposes __player instead of __hf
        if (win?.__player && typeof win.__player.renderSeek === "function" && win.__playerReady) {
          const player = win.__player;
          const getDeclaredDuration = () => {
            const root = iframe.contentDocument?.querySelector("[data-composition-id]");
            if (!root) return 0;
            const d = Number(root.getAttribute("data-duration"));
            return Number.isFinite(d) && d > 0 ? d : 0;
          };
          resolve({
            get duration() {
              const d = player.getDuration();
              return d > 0 ? d : getDeclaredDuration();
            },
            seek: (t: number) => player.renderSeek(t),
          });
          return;
        }

        if (Date.now() - start > timeoutMs) {
          reject(new Error("Timed out waiting for window.__hf protocol"));
          return;
        }
        setTimeout(poll, 50);
      };
      poll();
    });
  }
}
