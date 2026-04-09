# Client-Side Video Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@hyperframes/renderer` — a browser-only package that renders HyperFrames compositions to MP4 using WebCodecs + MediaBunny + SnapDOM, with zero server dependencies.

**Architecture:** Pluggable frame source (SnapDOM now, html-in-canvas later) captures frames from parallel hidden iframes. Frames are transferred to a Web Worker that encodes via WebCodecs and muxes via MediaBunny. Audio is mixed client-side via OfflineAudioContext.

**Tech Stack:** TypeScript, WebCodecs API, MediaBunny (muxer), SnapDOM (DOM capture), OfflineAudioContext (audio mixing), Web Workers + OffscreenCanvas

**Spec:** `docs/superpowers/specs/2026-04-10-client-side-renderer-design.md`

---

## File Map

| File | Responsibility |
|---|---|
| `packages/renderer/package.json` | Package manifest — browser-only, deps: @zumer/snapdom, mediabunny |
| `packages/renderer/tsconfig.json` | TypeScript config — ES2022, bundler resolution, DOM lib |
| `packages/renderer/src/types.ts` | All shared interfaces and type definitions |
| `packages/renderer/src/compat.ts` | Feature detection — `isSupported()` |
| `packages/renderer/src/utils/timing.ts` | Frame time generation and quantization |
| `packages/renderer/src/sources/snapdom.ts` | SnapDOM frame source — captures DOM to ImageBitmap |
| `packages/renderer/src/encoding/types.ts` | Worker message protocol types |
| `packages/renderer/src/encoding/worker.ts` | Web Worker — VideoEncoder + MediaBunny muxer |
| `packages/renderer/src/encoding/encoder.ts` | Main-thread wrapper — manages worker lifecycle |
| `packages/renderer/src/audio/mixer.ts` | OfflineAudioContext audio mixing |
| `packages/renderer/src/capture/iframe-pool.ts` | Parallel iframe management and frame scheduling |
| `packages/renderer/src/capture/video-frame-injector.ts` | Canvas overlays for `<video>` element frames |
| `packages/renderer/src/renderer.ts` | Main orchestrator — coordinates full pipeline |
| `packages/renderer/src/index.ts` | Public API — `render()`, `createRenderer()`, `isSupported()` |

---

## Task 1: Package Scaffold + Types

**Files:**
- Create: `packages/renderer/package.json`
- Create: `packages/renderer/tsconfig.json`
- Create: `packages/renderer/src/types.ts`
- Create: `packages/renderer/src/compat.ts`
- Create: `packages/renderer/src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@hyperframes/renderer",
  "version": "0.0.1",
  "description": "Client-side video renderer for HyperFrames compositions",
  "repository": {
    "type": "git",
    "url": "https://github.com/heygen-com/hyperframes",
    "directory": "packages/renderer"
  },
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "import": "./src/index.ts",
      "types": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@zumer/snapdom": "^2.8.0",
    "mediabunny": "^1.40.0"
  },
  "peerDependencies": {
    "@hyperframes/core": "workspace:^"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts"]
}
```

- [ ] **Step 3: Create src/types.ts with all interfaces**

This is the single source of truth for all types in the package. Every other module imports from here.

```typescript
/**
 * @hyperframes/renderer — Type definitions
 *
 * All interfaces for the client-side rendering pipeline.
 */

// ── Frame Source ──────────────────────────────────────────────────────────────

export interface HfMediaElement {
  elementId: string;
  src: string;
  startTime: number;
  endTime: number;
  mediaOffset?: number;
  volume?: number;
  hasAudio?: boolean;
}

export interface FrameSourceConfig {
  compositionUrl: string;
  width: number;
  height: number;
  devicePixelRatio?: number;
}

export interface FrameSource {
  readonly name: string;
  init(config: FrameSourceConfig): Promise<void>;
  capture(time: number): Promise<ImageBitmap>;
  readonly duration: number;
  readonly media: HfMediaElement[];
  dispose(): Promise<void>;
}

// ── Encoder ──────────────────────────────────────────────────────────────────

export interface EncoderConfig {
  width: number;
  height: number;
  fps: number;
  codec: "avc1.640028" | "vp09.00.31.08";
  bitrate?: number;
  hardwareAcceleration?: "prefer-hardware" | "prefer-software";
}

// ── Audio ────────────────────────────────────────────────────────────────────

export interface AudioSource {
  src: string | Blob;
  startTime: number;
  endTime: number;
  mediaOffset?: number;
  volume?: number;
}

export interface AudioMixConfig {
  duration: number;
  sampleRate?: number;
  channels?: number;
  sources: AudioSource[];
}

export interface AudioMixResult {
  buffer: AudioBuffer;
  sampleRate: number;
  channels: number;
}

// ── Muxer ────────────────────────────────────────────────────────────────────

export interface MuxerConfig {
  format: "mp4" | "webm";
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
}

// ── Renderer (Public API) ────────────────────────────────────────────────────

export interface RenderConfig {
  composition: string;
  format?: "mp4" | "webm";
  fps?: 24 | 30 | 60;
  width?: number;
  height?: number;
  devicePixelRatio?: number;
  codec?: "h264" | "vp9";
  bitrate?: number;
  concurrency?: number;
  onProgress?: (progress: RenderProgress) => void;
  frameSource?: "snapdom" | "draw-element-image";
}

export interface RenderProgress {
  stage:
    | "initializing"
    | "capturing"
    | "encoding"
    | "mixing-audio"
    | "muxing"
    | "complete";
  progress: number;
  currentFrame?: number;
  totalFrames?: number;
  estimatedTimeRemaining?: number;
  captureRate?: number;
}

export interface RenderResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  perf: {
    captureMs: number;
    encodeMs: number;
    audioMs: number;
    muxMs: number;
    totalMs: number;
    framesPerSecond: number;
  };
}
```

- [ ] **Step 4: Create src/compat.ts**

```typescript
/**
 * Feature detection for client-side rendering.
 */

export function isSupported(): boolean {
  return (
    typeof globalThis.VideoEncoder !== "undefined" &&
    typeof globalThis.OffscreenCanvas !== "undefined" &&
    typeof globalThis.AudioContext !== "undefined" &&
    typeof globalThis.createImageBitmap !== "undefined"
  );
}

export function detectBestFrameSource(): "draw-element-image" | "snapdom" {
  if (
    typeof CanvasRenderingContext2D !== "undefined" &&
    "drawElementImage" in CanvasRenderingContext2D.prototype
  ) {
    return "draw-element-image";
  }
  return "snapdom";
}
```

- [ ] **Step 5: Create src/index.ts (stub exports)**

```typescript
/**
 * @hyperframes/renderer
 *
 * Client-side video rendering for HyperFrames compositions.
 * Zero server dependencies — renders entirely in the browser
 * using WebCodecs, MediaBunny, and SnapDOM.
 */

export { isSupported, detectBestFrameSource } from "./compat.js";

export type {
  RenderConfig,
  RenderProgress,
  RenderResult,
  FrameSource,
  FrameSourceConfig,
  HfMediaElement,
  EncoderConfig,
  AudioSource,
  AudioMixConfig,
  AudioMixResult,
  MuxerConfig,
} from "./types.js";

// render() and createRenderer() are exported in Task 8 once the orchestrator exists.
```

- [ ] **Step 6: Install dependencies and verify typecheck**

Run:
```bash
cd packages/renderer && pnpm install && pnpm typecheck
```
Expected: Clean typecheck, no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/renderer/
git commit -m "feat(renderer): scaffold package with types and compat detection"
```

---

## Task 2: Frame Timing Utility

**Files:**
- Create: `packages/renderer/src/utils/timing.ts`
- Create: `packages/renderer/src/utils/timing.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { generateFrameTimes, distributeFrames } from "./timing.js";

describe("generateFrameTimes", () => {
  it("generates correct frame times for 1s at 30fps", () => {
    const times = generateFrameTimes(1.0, 30);
    expect(times).toHaveLength(30);
    expect(times[0]).toBe(0);
    expect(times[1]).toBeCloseTo(1 / 30);
    expect(times[29]).toBeCloseTo(29 / 30);
  });

  it("generates correct frame times for 0.5s at 60fps", () => {
    const times = generateFrameTimes(0.5, 60);
    expect(times).toHaveLength(30);
    expect(times[0]).toBe(0);
  });

  it("returns empty array for zero duration", () => {
    expect(generateFrameTimes(0, 30)).toHaveLength(0);
  });
});

describe("distributeFrames", () => {
  it("distributes 10 frames across 3 workers", () => {
    const ranges = distributeFrames(10, 3);
    expect(ranges).toHaveLength(3);
    expect(ranges[0]).toEqual({ start: 0, end: 3 });
    expect(ranges[1]).toEqual({ start: 4, end: 6 });
    expect(ranges[2]).toEqual({ start: 7, end: 9 });
    const totalFrames = ranges.reduce((s, r) => s + (r.end - r.start + 1), 0);
    expect(totalFrames).toBe(10);
  });

  it("handles fewer frames than workers", () => {
    const ranges = distributeFrames(2, 5);
    expect(ranges).toHaveLength(2);
    expect(ranges[0]).toEqual({ start: 0, end: 0 });
    expect(ranges[1]).toEqual({ start: 1, end: 1 });
  });

  it("handles single worker", () => {
    const ranges = distributeFrames(100, 1);
    expect(ranges).toHaveLength(1);
    expect(ranges[0]).toEqual({ start: 0, end: 99 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/renderer && pnpm vitest run src/utils/timing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement timing.ts**

```typescript
/**
 * Frame timing utilities.
 *
 * Generates frame timestamps and distributes frame ranges
 * across parallel capture workers (iframes).
 */

export interface FrameRange {
  start: number;
  end: number;
}

export function generateFrameTimes(durationSeconds: number, fps: number): number[] {
  if (durationSeconds <= 0 || fps <= 0) return [];
  const totalFrames = Math.ceil(durationSeconds * fps);
  const frameDuration = 1 / fps;
  const times: number[] = [];
  for (let i = 0; i < totalFrames; i++) {
    times.push(i * frameDuration);
  }
  return times;
}

export function distributeFrames(totalFrames: number, workerCount: number): FrameRange[] {
  const effectiveWorkers = Math.min(workerCount, totalFrames);
  if (effectiveWorkers <= 0) return [];
  const ranges: FrameRange[] = [];
  const baseSize = Math.floor(totalFrames / effectiveWorkers);
  const remainder = totalFrames % effectiveWorkers;
  let cursor = 0;
  for (let i = 0; i < effectiveWorkers; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    ranges.push({ start: cursor, end: cursor + size - 1 });
    cursor += size;
  }
  return ranges;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/renderer && pnpm vitest run src/utils/timing.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/utils/
git commit -m "feat(renderer): add frame timing and distribution utilities"
```

---

## Task 3: SnapDOM Frame Source

**Files:**
- Create: `packages/renderer/src/sources/snapdom.ts`
- Create: `packages/renderer/src/sources/snapdom.test.ts`

- [ ] **Step 1: Write the test**

Note: SnapDOM requires a real DOM. These tests use `vitest` with `environment: 'jsdom'` or `'happy-dom'`. Since SnapDOM relies on real rendering (SVG foreignObject), some behaviors can only be tested in a real browser. These unit tests validate the structural contract — fidelity testing is done in integration tests.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SnapdomFrameSource } from "./snapdom.js";

// Mock @zumer/snapdom since jsdom can't run real SVG foreignObject rendering
vi.mock("@zumer/snapdom", () => ({
  snapdom: {
    toCanvas: vi.fn().mockResolvedValue(
      (() => {
        const c = document.createElement("canvas");
        c.width = 1920;
        c.height = 1080;
        return c;
      })(),
    ),
  },
}));

describe("SnapdomFrameSource", () => {
  it("has name 'snapdom'", () => {
    const source = new SnapdomFrameSource();
    expect(source.name).toBe("snapdom");
  });

  it("duration is 0 before init", () => {
    const source = new SnapdomFrameSource();
    expect(source.duration).toBe(0);
  });

  it("media is empty before init", () => {
    const source = new SnapdomFrameSource();
    expect(source.media).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/renderer && pnpm vitest run src/sources/snapdom.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement snapdom.ts**

```typescript
/**
 * SnapDOM Frame Source
 *
 * Captures DOM snapshots from an iframe-loaded composition
 * using @zumer/snapdom, then converts to ImageBitmap for
 * transfer to the encoding worker.
 */

import { snapdom } from "@zumer/snapdom";
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
  }

  async capture(time: number): Promise<ImageBitmap> {
    if (!this.iframe || !this.hf || !this.config) {
      throw new Error("SnapdomFrameSource not initialized — call init() first");
    }

    this.hf.seek(time);

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
    if (this.iframe) {
      this.iframe.remove();
      this.iframe = null;
    }
    this.hf = null;
    this.config = null;
    this._duration = 0;
    this._media = [];
  }

  private waitForHfProtocol(
    iframe: HTMLIFrameElement,
    timeoutMs = 10_000,
  ): Promise<HfProtocol> {
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/renderer && pnpm vitest run src/sources/snapdom.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/sources/
git commit -m "feat(renderer): add SnapDOM frame source implementation"
```

---

## Task 4: Encoding Worker + Message Protocol

**Files:**
- Create: `packages/renderer/src/encoding/types.ts`
- Create: `packages/renderer/src/encoding/worker.ts`
- Create: `packages/renderer/src/encoding/encoder.ts`
- Create: `packages/renderer/src/encoding/encoder.test.ts`

- [ ] **Step 1: Create encoding/types.ts — worker message protocol**

```typescript
/**
 * Worker message protocol types.
 *
 * Main thread → Worker: WorkerInMessage
 * Worker → Main thread: WorkerOutMessage
 */

export type WorkerInMessage =
  | {
      type: "init";
      config: {
        width: number;
        height: number;
        fps: number;
        codec: string;
        bitrate: number;
        format: "mp4" | "webm";
      };
    }
  | {
      type: "frame";
      bitmap: ImageBitmap;
      index: number;
      timestamp: number;
    }
  | {
      type: "set-audio";
      channelData: Float32Array[];
      sampleRate: number;
    }
  | {
      type: "finalize";
    };

export type WorkerOutMessage =
  | { type: "ready" }
  | { type: "frame-encoded"; index: number }
  | { type: "done"; blob: Blob }
  | { type: "error"; message: string }
  | { type: "progress"; framesEncoded: number };
```

- [ ] **Step 2: Create encoding/worker.ts — Web Worker entry point**

This file runs inside a Web Worker. It creates a VideoEncoder + MediaBunny muxer and processes frames received from the main thread.

```typescript
/**
 * Encoding Worker
 *
 * Receives ImageBitmap frames from the main thread, encodes via
 * WebCodecs VideoEncoder, and muxes into MP4/WebM via MediaBunny.
 */

import {
  Output,
  Mp4OutputFormat,
  WebmOutputFormat,
  BufferTarget,
  EncodedVideoPacketSource,
  EncodedPacket,
  AudioSampleSource,
  AudioSample,
} from "mediabunny";
import type { WorkerInMessage, WorkerOutMessage } from "./types.js";

let output: Output | null = null;
let videoSource: EncodedVideoPacketSource | null = null;
let audioSource: AudioSampleSource | null = null;
let encoder: VideoEncoder | null = null;
let target: BufferTarget | null = null;
let isFirstPacket = true;
let framesEncoded = 0;
let encoderConfig: VideoEncoderConfig | null = null;

function post(msg: WorkerOutMessage, transfer?: Transferable[]): void {
  self.postMessage(msg, { transfer: transfer ?? [] });
}

async function handleInit(config: WorkerInMessage & { type: "init" }): Promise<void> {
  const { width, height, fps, codec, bitrate, format } = config.config;

  target = new BufferTarget();
  const formatObj = format === "webm" ? new WebmOutputFormat() : new Mp4OutputFormat();
  output = new Output({ format: formatObj, target });

  const mbCodec = codec.startsWith("avc") ? "avc" : "vp9";
  videoSource = new EncodedVideoPacketSource(mbCodec);
  output.addVideoTrack(videoSource, { frameRate: fps });

  audioSource = new AudioSampleSource({ codec: "aac", bitrate: 128_000 });
  output.addAudioTrack(audioSource);

  encoderConfig = {
    codec,
    width,
    height,
    bitrate,
    hardwareAcceleration: "prefer-hardware",
  };

  encoder = new VideoEncoder({
    output: async (chunk, meta) => {
      const packet = EncodedPacket.fromEncodedChunk(chunk);
      if (isFirstPacket) {
        await videoSource!.add(packet, meta);
        isFirstPacket = false;
      } else {
        await videoSource!.add(packet);
      }
      framesEncoded++;
      post({ type: "frame-encoded", index: framesEncoded - 1 });
    },
    error: (e) => {
      post({ type: "error", message: e.message });
    },
  });

  encoder.configure(encoderConfig);
  await output.start();

  post({ type: "ready" });
}

async function handleFrame(msg: WorkerInMessage & { type: "frame" }): Promise<void> {
  if (!encoder) {
    post({ type: "error", message: "Encoder not initialized" });
    return;
  }

  const frame = new VideoFrame(msg.bitmap, {
    timestamp: msg.timestamp,
  });

  const isKeyFrame = msg.index % 150 === 0;
  encoder.encode(frame, { keyFrame: isKeyFrame });
  frame.close();
  msg.bitmap.close();
}

async function handleSetAudio(msg: WorkerInMessage & { type: "set-audio" }): Promise<void> {
  if (!audioSource) return;

  const interleaved = interleaveChannels(msg.channelData);
  const sample = new AudioSample({
    data: interleaved,
    format: "f32-planar",
    numberOfChannels: msg.channelData.length,
    sampleRate: msg.sampleRate,
    timestamp: 0,
  });
  await audioSource.add(sample);
  sample.close();
}

async function handleFinalize(): Promise<void> {
  if (!encoder || !output || !target || !videoSource || !audioSource) {
    post({ type: "error", message: "Cannot finalize — not initialized" });
    return;
  }

  await encoder.flush();
  encoder.close();
  videoSource.close();
  audioSource.close();
  await output.finalize();

  const buffer = target.buffer;
  if (!buffer) {
    post({ type: "error", message: "No output buffer after finalize" });
    return;
  }

  const blob = new Blob([buffer], { type: "video/mp4" });
  post({ type: "done", blob });
}

function interleaveChannels(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!;
  const length = channels[0]!.length * channels.length;
  const result = new Float32Array(length);
  const numChannels = channels.length;
  const samplesPerChannel = channels[0]!.length;
  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = channels[ch]!;
    for (let i = 0; i < samplesPerChannel; i++) {
      result[i * numChannels + ch] = channelData[i]!;
    }
  }
  return result;
}

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  try {
    switch (e.data.type) {
      case "init":
        await handleInit(e.data);
        break;
      case "frame":
        await handleFrame(e.data);
        break;
      case "set-audio":
        await handleSetAudio(e.data);
        break;
      case "finalize":
        await handleFinalize();
        break;
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
```

- [ ] **Step 3: Create encoding/encoder.ts — main-thread wrapper**

```typescript
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
    this.worker = new Worker(new URL("./worker.js", import.meta.url), {
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
    this.worker.postMessage(msg, channelData.map((c) => c.buffer));
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
```

- [ ] **Step 4: Write encoder.test.ts**

Full browser-level encoding tests require WebCodecs (not available in jsdom). Test the structural contract.

```typescript
import { describe, it, expect } from "vitest";
import { Encoder } from "./encoder.js";

describe("Encoder", () => {
  it("can be constructed with options", () => {
    const encoder = new Encoder({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc1.640028",
      bitrate: 4_000_000,
      format: "mp4",
    });
    expect(encoder).toBeDefined();
  });

  it("throws if sendFrame called before init", () => {
    const encoder = new Encoder({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc1.640028",
      bitrate: 4_000_000,
      format: "mp4",
    });
    expect(() => encoder.sendFrame({} as ImageBitmap, 0, 0)).toThrow("not initialized");
  });

  it("throws if finalize called before init", async () => {
    const encoder = new Encoder({
      width: 1920,
      height: 1080,
      fps: 30,
      codec: "avc1.640028",
      bitrate: 4_000_000,
      format: "mp4",
    });
    await expect(encoder.finalize()).rejects.toThrow("not initialized");
  });
});
```

- [ ] **Step 5: Run tests**

Run: `cd packages/renderer && pnpm vitest run src/encoding/encoder.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/renderer/src/encoding/
git commit -m "feat(renderer): add WebCodecs encoding worker and main-thread wrapper"
```

---

## Task 5: Audio Mixer

**Files:**
- Create: `packages/renderer/src/audio/mixer.ts`
- Create: `packages/renderer/src/audio/mixer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { mixAudio } from "./mixer.js";
import type { AudioMixConfig } from "../types.js";

describe("mixAudio", () => {
  it("returns silent audio when no sources provided", async () => {
    const config: AudioMixConfig = {
      duration: 1.0,
      sampleRate: 44100,
      channels: 2,
      sources: [],
    };
    const result = await mixAudio(config);
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
    expect(result.buffer.duration).toBeCloseTo(1.0, 1);
    // Verify silence
    const data = result.buffer.getChannelData(0);
    const maxAmp = Math.max(...Array.from(data).map(Math.abs));
    expect(maxAmp).toBe(0);
  });

  it("uses default sample rate and channels", async () => {
    const result = await mixAudio({ duration: 0.5, sources: [] });
    expect(result.sampleRate).toBe(44100);
    expect(result.channels).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/renderer && pnpm vitest run src/audio/mixer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement mixer.ts**

```typescript
/**
 * Audio Mixer
 *
 * Mixes audio sources using OfflineAudioContext.
 * Decodes audio files, applies volume/timing offsets,
 * and renders to a single AudioBuffer (PCM).
 */

import type { AudioMixConfig, AudioMixResult } from "../types.js";

const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;

export async function mixAudio(config: AudioMixConfig): Promise<AudioMixResult> {
  const sampleRate = config.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const channels = config.channels ?? DEFAULT_CHANNELS;
  const totalSamples = Math.ceil(config.duration * sampleRate);

  const offlineCtx = new OfflineAudioContext(channels, totalSamples, sampleRate);

  for (const source of config.sources) {
    const arrayBuffer = await fetchAudioData(source.src);
    const audioBuffer = await offlineCtx.decodeAudioData(arrayBuffer);

    const bufferSource = offlineCtx.createBufferSource();
    bufferSource.buffer = audioBuffer;

    // Apply volume
    const gainNode = offlineCtx.createGain();
    gainNode.gain.value = source.volume ?? 1;

    bufferSource.connect(gainNode);
    gainNode.connect(offlineCtx.destination);

    // Calculate timing
    const mediaOffset = source.mediaOffset ?? 0;
    const clipDuration = source.endTime - source.startTime;

    if (mediaOffset > 0) {
      bufferSource.start(source.startTime, mediaOffset, clipDuration);
    } else {
      bufferSource.start(source.startTime, 0, clipDuration);
    }
  }

  const renderedBuffer = await offlineCtx.startRendering();

  return {
    buffer: renderedBuffer,
    sampleRate,
    channels,
  };
}

async function fetchAudioData(src: string | Blob): Promise<ArrayBuffer> {
  if (src instanceof Blob) {
    return src.arrayBuffer();
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${src} (${response.status})`);
  }
  return response.arrayBuffer();
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/renderer && pnpm vitest run src/audio/mixer.test.ts`
Expected: Both tests pass.

Note: `OfflineAudioContext` may not be available in the test environment (jsdom). If tests fail due to missing API, add `// @vitest-environment happy-dom` or configure vitest to use a browser-like environment. If needed, mock `OfflineAudioContext` minimally:

```typescript
// Add to top of test file if OfflineAudioContext is missing:
import { vi } from "vitest";

if (typeof globalThis.OfflineAudioContext === "undefined") {
  globalThis.OfflineAudioContext = vi.fn().mockImplementation((channels, length, sampleRate) => ({
    createBufferSource: () => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
    }),
    createGain: () => ({
      gain: { value: 1 },
      connect: vi.fn(),
    }),
    destination: {},
    decodeAudioData: vi.fn().mockResolvedValue({
      duration: 1,
      numberOfChannels: channels,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
    startRendering: vi.fn().mockResolvedValue({
      duration: length / sampleRate,
      numberOfChannels: channels,
      sampleRate,
      length,
      getChannelData: () => new Float32Array(length),
    }),
  })) as unknown as typeof OfflineAudioContext;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/audio/
git commit -m "feat(renderer): add OfflineAudioContext-based audio mixer"
```

---

## Task 6: Iframe Pool + Frame Scheduler

**Files:**
- Create: `packages/renderer/src/capture/iframe-pool.ts`
- Create: `packages/renderer/src/capture/iframe-pool.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { calculateConcurrency } from "./iframe-pool.js";

describe("calculateConcurrency", () => {
  it("returns at least 1", () => {
    expect(calculateConcurrency(0)).toBe(1);
  });

  it("caps at 8", () => {
    expect(calculateConcurrency(100)).toBeLessThanOrEqual(8);
  });

  it("leaves 1 core for encoding", () => {
    expect(calculateConcurrency(4)).toBe(3);
  });

  it("handles single-core", () => {
    expect(calculateConcurrency(1)).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/renderer && pnpm vitest run src/capture/iframe-pool.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement iframe-pool.ts**

```typescript
/**
 * Iframe Pool
 *
 * Manages N parallel hidden iframes, each loading the same composition.
 * Each iframe captures a contiguous range of frames using the provided
 * FrameSource for DOM-to-ImageBitmap conversion.
 */

import type { FrameSource, FrameSourceConfig, HfMediaElement } from "../types.js";
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
  ): Promise<void> {
    const ranges = distributeFrames(frameTimes.length, this.sources.length);

    await Promise.all(
      ranges.map(async (range, workerIdx) => {
        const source = this.sources[workerIdx]!;
        for (let i = range.start; i <= range.end; i++) {
          const time = frameTimes[i]!;
          const bitmap = await source.capture(time);
          onFrame({ bitmap, index: i, time });
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
```

- [ ] **Step 4: Run tests**

Run: `cd packages/renderer && pnpm vitest run src/capture/iframe-pool.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/capture/
git commit -m "feat(renderer): add parallel iframe pool for frame capture"
```

---

## Task 7: Video Frame Injector

**Files:**
- Create: `packages/renderer/src/capture/video-frame-injector.ts`

- [ ] **Step 1: Implement video-frame-injector.ts**

This handles `<video>` elements in compositions by decoding them client-side and drawing frames onto overlay canvases that SnapDOM can capture.

```typescript
/**
 * Video Frame Injector
 *
 * For each <video> element in the composition, creates a canvas overlay
 * that displays the decoded video frame at the current composition time.
 * SnapDOM can capture <canvas> elements (unlike <video> via foreignObject).
 */

import type { HfMediaElement } from "../types.js";

interface VideoTrack {
  element: HfMediaElement;
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export class VideoFrameInjector {
  private tracks: VideoTrack[] = [];
  private iframeDoc: Document | null = null;

  async init(media: HfMediaElement[], iframeDoc: Document): Promise<void> {
    this.iframeDoc = iframeDoc;
    const videoElements = media.filter((m) => {
      const el = iframeDoc.getElementById(m.elementId);
      return el?.tagName === "VIDEO";
    });

    for (const element of videoElements) {
      const videoEl = iframeDoc.getElementById(element.elementId) as HTMLVideoElement | null;
      if (!videoEl) continue;

      // Create a hidden video element for decoding
      const video = iframeDoc.createElement("video");
      video.src = element.src;
      video.muted = true;
      video.preload = "auto";
      video.crossOrigin = "anonymous";
      video.style.display = "none";
      iframeDoc.body.appendChild(video);

      await new Promise<void>((resolve) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => resolve(); // graceful — skip broken videos
        video.load();
      });

      // Create canvas overlay matching the video element's position
      const canvas = iframeDoc.createElement("canvas");
      const rect = videoEl.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      canvas.style.position = "absolute";
      canvas.style.left = `${rect.left}px`;
      canvas.style.top = `${rect.top}px`;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      canvas.style.zIndex = getComputedStyle(videoEl).zIndex || "1";
      canvas.style.pointerEvents = "none";

      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      // Hide the original video element (SnapDOM can't capture it anyway)
      videoEl.style.visibility = "hidden";

      // Insert canvas as sibling
      videoEl.parentElement?.insertBefore(canvas, videoEl.nextSibling);

      this.tracks.push({ element, video, canvas, ctx });
    }
  }

  async injectFrame(compositionTime: number): Promise<void> {
    for (const track of this.tracks) {
      const { element, video, canvas, ctx } = track;

      // Is this video visible at this composition time?
      if (compositionTime < element.startTime || compositionTime >= element.endTime) {
        canvas.style.visibility = "hidden";
        continue;
      }
      canvas.style.visibility = "visible";

      // Calculate the video's local time
      const mediaOffset = element.mediaOffset ?? 0;
      const localTime = compositionTime - element.startTime + mediaOffset;

      // Seek the video to the correct time
      if (Math.abs(video.currentTime - localTime) > 0.01) {
        video.currentTime = localTime;
        await new Promise<void>((resolve) => {
          video.onseeked = () => resolve();
          setTimeout(resolve, 100); // safety timeout
        });
      }

      // Draw the current video frame onto the canvas
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }
  }

  dispose(): void {
    for (const track of this.tracks) {
      track.video.remove();
      track.canvas.remove();
    }
    this.tracks = [];
    this.iframeDoc = null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/renderer/src/capture/video-frame-injector.ts
git commit -m "feat(renderer): add video frame injector for <video> element capture"
```

---

## Task 8: Main Renderer Orchestrator

**Files:**
- Create: `packages/renderer/src/renderer.ts`
- Modify: `packages/renderer/src/index.ts` — add `render()` and `createRenderer()` exports

- [ ] **Step 1: Implement renderer.ts**

```typescript
/**
 * Renderer
 *
 * Orchestrates the full client-side rendering pipeline:
 * 1. Initialize iframe pool + frame sources
 * 2. Capture frames in parallel across iframes
 * 3. Stream frames to encoding worker
 * 4. Mix audio via OfflineAudioContext
 * 5. Mux video + audio via MediaBunny (in worker)
 * 6. Return final MP4 Blob
 */

import type {
  RenderConfig,
  RenderProgress,
  RenderResult,
  AudioSource,
} from "./types.js";
import { isSupported } from "./compat.js";
import { generateFrameTimes } from "./utils/timing.js";
import { IframePool, calculateConcurrency } from "./capture/iframe-pool.js";
import { SnapdomFrameSource } from "./sources/snapdom.js";
import { Encoder } from "./encoding/encoder.js";
import { mixAudio } from "./audio/mixer.js";

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
const DEFAULT_BITRATE_1080P = 4_000_000;

function resolveCodecString(codec: RenderConfig["codec"]): string {
  if (codec === "vp9") return "vp09.00.31.08";
  return "avc1.640028"; // H.264 High profile
}

function resolveBitrate(width: number, height: number, bitrate?: number): number {
  if (bitrate) return bitrate;
  const pixels = width * height;
  const ref = 1920 * 1080;
  return Math.round(DEFAULT_BITRATE_1080P * (pixels / ref));
}

export class HyperframesRenderer {
  private config: Required<
    Pick<RenderConfig, "fps" | "width" | "height" | "format" | "codec" | "concurrency">
  > & RenderConfig;
  private cancelled = false;
  private iframePool: IframePool | null = null;
  private encoder: Encoder | null = null;

  constructor(config: RenderConfig) {
    this.config = {
      ...config,
      fps: config.fps ?? DEFAULT_FPS,
      width: config.width ?? DEFAULT_WIDTH,
      height: config.height ?? DEFAULT_HEIGHT,
      format: config.format ?? "mp4",
      codec: config.codec ?? "h264",
      concurrency: config.concurrency ?? calculateConcurrency(navigator.hardwareConcurrency ?? 4),
    };
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

    const perfStart = performance.now();
    const perf = { captureMs: 0, encodeMs: 0, audioMs: 0, muxMs: 0, totalMs: 0, framesPerSecond: 0 };
    const { fps, width, height, format, codec, concurrency, composition, onProgress } = this.config;

    this.cancelled = false;

    const emitProgress = (stage: RenderProgress["stage"], progress: number, extra?: Partial<RenderProgress>) => {
      onProgress?.({ stage, progress, ...extra });
    };

    try {
      // ── Stage 1: Initialize ──────────────────────────────────────────────
      emitProgress("initializing", 0);

      this.iframePool = new IframePool();
      const { duration, media } = await this.iframePool.init({
        compositionUrl: composition,
        width,
        height,
        devicePixelRatio: this.config.devicePixelRatio,
        concurrency,
        createFrameSource: () => new SnapdomFrameSource(),
      });

      if (this.cancelled) throw new CancelledError();

      const frameTimes = generateFrameTimes(duration, fps);
      const totalFrames = frameTimes.length;

      // Initialize encoder
      const codecString = resolveCodecString(codec);
      const bitrate = resolveBitrate(width, height, this.config.bitrate);

      let framesEncoded = 0;
      this.encoder = new Encoder({
        width,
        height,
        fps,
        codec: codecString,
        bitrate,
        format,
        onFrameEncoded: () => {
          framesEncoded++;
        },
      });
      await this.encoder.init();

      if (this.cancelled) throw new CancelledError();

      // ── Stage 2: Capture + Encode (pipelined) ───────────────────────────
      emitProgress("capturing", 0, { totalFrames, currentFrame: 0 });
      const captureStart = performance.now();

      // Buffer to ensure frames are sent to encoder in order
      const frameBuffer = new Map<number, ImageBitmap>();
      let nextFrameToEncode = 0;

      const flushBuffer = () => {
        while (frameBuffer.has(nextFrameToEncode)) {
          const bitmap = frameBuffer.get(nextFrameToEncode)!;
          frameBuffer.delete(nextFrameToEncode);
          const timestamp = frameTimes[nextFrameToEncode]! * 1_000_000; // seconds → microseconds
          this.encoder!.sendFrame(bitmap, nextFrameToEncode, timestamp);
          nextFrameToEncode++;
        }
      };

      let framesCaptured = 0;
      await this.iframePool.captureAll(frameTimes, (frame) => {
        if (this.cancelled) return;
        frameBuffer.set(frame.index, frame.bitmap);
        flushBuffer();
        framesCaptured++;
        const captureProgress = framesCaptured / totalFrames;
        emitProgress("capturing", captureProgress * 0.7, {
          currentFrame: framesCaptured,
          totalFrames,
          captureRate: framesCaptured / ((performance.now() - captureStart) / 1000),
        });
      });

      // Flush any remaining buffered frames
      flushBuffer();
      perf.captureMs = performance.now() - captureStart;

      if (this.cancelled) throw new CancelledError();

      // ── Stage 3: Mix audio ──────────────────────────────────────────────
      emitProgress("mixing-audio", 0.7);
      const audioStart = performance.now();

      const audioSources: AudioSource[] = media
        .filter((m) => m.hasAudio)
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
        for (let ch = 0; ch < mixResult.channels; ch++) {
          channelData.push(mixResult.buffer.getChannelData(ch));
        }
        this.encoder.setAudio(channelData, mixResult.sampleRate);
      }
      perf.audioMs = performance.now() - audioStart;

      if (this.cancelled) throw new CancelledError();

      // ── Stage 4: Finalize (mux) ────────────────────────────────────────
      emitProgress("muxing", 0.9);
      const muxStart = performance.now();
      const blob = await this.encoder.finalize();
      perf.muxMs = performance.now() - muxStart;

      // ── Done ────────────────────────────────────────────────────────────
      perf.totalMs = performance.now() - perfStart;
      perf.framesPerSecond = totalFrames / (perf.totalMs / 1000);
      perf.encodeMs = perf.totalMs - perf.captureMs - perf.audioMs - perf.muxMs;

      emitProgress("complete", 1, { totalFrames, currentFrame: totalFrames });

      return {
        blob,
        mimeType: format === "webm" ? "video/webm" : "video/mp4",
        durationMs: perf.totalMs,
        perf,
      };
    } finally {
      await this.iframePool?.dispose();
      this.encoder?.dispose();
      this.iframePool = null;
      this.encoder = null;
    }
  }
}

export class CancelledError extends Error {
  constructor() {
    super("Render cancelled");
    this.name = "CancelledError";
  }
}
```

- [ ] **Step 2: Update src/index.ts with public API**

Replace the contents of `packages/renderer/src/index.ts` with:

```typescript
/**
 * @hyperframes/renderer
 *
 * Client-side video rendering for HyperFrames compositions.
 * Zero server dependencies — renders entirely in the browser
 * using WebCodecs, MediaBunny, and SnapDOM.
 */

import { HyperframesRenderer } from "./renderer.js";
import type { RenderConfig, RenderResult } from "./types.js";

export { isSupported, detectBestFrameSource } from "./compat.js";
export { HyperframesRenderer, CancelledError } from "./renderer.js";
export { SnapdomFrameSource } from "./sources/snapdom.js";

export type {
  RenderConfig,
  RenderProgress,
  RenderResult,
  FrameSource,
  FrameSourceConfig,
  HfMediaElement,
  EncoderConfig,
  AudioSource,
  AudioMixConfig,
  AudioMixResult,
  MuxerConfig,
} from "./types.js";

/**
 * Render a composition to video. Convenience wrapper around HyperframesRenderer.
 *
 * @example
 * ```ts
 * const result = await render({
 *   composition: './my-comp/index.html',
 *   fps: 30,
 *   onProgress: (p) => console.log(p.stage, p.progress),
 * });
 * // result.blob is the final MP4
 * ```
 */
export async function render(config: RenderConfig): Promise<RenderResult> {
  const renderer = new HyperframesRenderer(config);
  return renderer.render();
}

/**
 * Create a renderer instance for more control (e.g., cancellation).
 *
 * @example
 * ```ts
 * const renderer = createRenderer({ composition: './comp/index.html' });
 * cancelBtn.onclick = () => renderer.cancel();
 * const result = await renderer.render();
 * ```
 */
export function createRenderer(config: RenderConfig): HyperframesRenderer {
  return new HyperframesRenderer(config);
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd packages/renderer && pnpm typecheck`
Expected: Clean, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/renderer.ts packages/renderer/src/index.ts
git commit -m "feat(renderer): add main orchestrator and public API (render, createRenderer)"
```

---

## Task 9: End-to-End Integration Test

**Files:**
- Create: `packages/renderer/src/tests/renderer.integration.test.ts`
- Create: `packages/renderer/src/tests/fixtures/basic-composition.html`

- [ ] **Step 1: Create a minimal test composition**

Create `packages/renderer/src/tests/fixtures/basic-composition.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; }
    body { width: 1920px; height: 1080px; background: #1a1a2e; }
    .box {
      position: absolute;
      top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 200px; height: 200px;
      background: #e94560;
      border-radius: 16px;
    }
  </style>
</head>
<body>
  <div class="box"></div>
  <script>
    // Minimal __hf protocol — 2 second static composition
    window.__hf = {
      duration: 2,
      seek: function(time) {
        // Static composition — no animation to seek
      },
      media: [],
    };
  </script>
</body>
</html>
```

- [ ] **Step 2: Create integration test**

Note: This test requires a real browser environment (WebCodecs, DOM, Workers). It should be run in a browser test runner (e.g., vitest with `browser` mode or Playwright). Mark it for browser-only execution.

```typescript
/**
 * End-to-end integration test for the renderer.
 *
 * Requires a browser environment with WebCodecs support.
 * Run with: vitest run --environment browser
 * Or skip in CI with jsdom by checking for WebCodecs.
 */
import { describe, it, expect } from "vitest";
import { render, isSupported } from "../index.js";

const SKIP = typeof globalThis.VideoEncoder === "undefined";

describe.skipIf(SKIP)("Renderer E2E", () => {
  it("renders a basic composition to MP4", async () => {
    const progressStages: string[] = [];

    const result = await render({
      composition: new URL("./fixtures/basic-composition.html", import.meta.url).href,
      fps: 30,
      width: 1920,
      height: 1080,
      concurrency: 1, // Single iframe for test simplicity
      onProgress: (p) => {
        if (!progressStages.includes(p.stage)) {
          progressStages.push(p.stage);
        }
      },
    });

    // Verify output
    expect(result.blob).toBeInstanceOf(Blob);
    expect(result.blob.size).toBeGreaterThan(0);
    expect(result.mimeType).toBe("video/mp4");
    expect(result.durationMs).toBeGreaterThan(0);

    // Verify perf data
    expect(result.perf.totalMs).toBeGreaterThan(0);
    expect(result.perf.captureMs).toBeGreaterThan(0);
    expect(result.perf.framesPerSecond).toBeGreaterThan(0);

    // Verify progress stages fired
    expect(progressStages).toContain("initializing");
    expect(progressStages).toContain("capturing");
    expect(progressStages).toContain("complete");
  }, 60_000); // 60s timeout for rendering

  it("isSupported returns true in browser with WebCodecs", () => {
    expect(isSupported()).toBe(true);
  });
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/tests/
git commit -m "test(renderer): add end-to-end integration test with basic composition"
```

---

## Task 10: Wire SnapDOM Frame Source to Video Frame Injector

**Files:**
- Modify: `packages/renderer/src/sources/snapdom.ts` — integrate VideoFrameInjector

The SnapdomFrameSource needs to create VideoFrameInjector instances for compositions with `<video>` elements, and call `injectFrame()` before each SnapDOM capture.

- [ ] **Step 1: Update snapdom.ts to integrate video frame injection**

Add to `packages/renderer/src/sources/snapdom.ts`, after the existing imports:

```typescript
import { VideoFrameInjector } from "../capture/video-frame-injector.js";
```

Add a field to the class:

```typescript
private videoInjector: VideoFrameInjector | null = null;
```

At the end of the `init()` method, after setting `this._media`, add:

```typescript
    // Set up video frame injection if composition has <video> elements
    const videoMedia = this._media.filter((m) => {
      const el = this.iframe!.contentDocument?.getElementById(m.elementId);
      return el?.tagName === "VIDEO";
    });
    if (videoMedia.length > 0) {
      this.videoInjector = new VideoFrameInjector();
      await this.videoInjector.init(videoMedia, this.iframe!.contentDocument!);
    }
```

In the `capture()` method, before the `snapdom.toCanvas()` call, add:

```typescript
    // Inject video frames before capture (SnapDOM can't capture <video> elements)
    if (this.videoInjector) {
      await this.videoInjector.injectFrame(time);
    }
```

In `dispose()`, add before the existing cleanup:

```typescript
    this.videoInjector?.dispose();
    this.videoInjector = null;
```

- [ ] **Step 2: Verify typecheck**

Run: `cd packages/renderer && pnpm typecheck`
Expected: Clean, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/sources/snapdom.ts
git commit -m "feat(renderer): integrate video frame injector into SnapDOM frame source"
```

---

## Task 11: Progress and ETA Utility

**Files:**
- Create: `packages/renderer/src/utils/progress.ts`
- Create: `packages/renderer/src/utils/progress.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { ProgressTracker } from "./progress.js";

describe("ProgressTracker", () => {
  it("estimates time remaining based on rate", () => {
    const tracker = new ProgressTracker(100);
    // Simulate 10 frames in 1 second
    tracker.recordFrame(10, 1000);
    const eta = tracker.estimateTimeRemaining();
    // 90 frames remaining at 10fps = ~9 seconds = ~9000ms
    expect(eta).toBeGreaterThan(8000);
    expect(eta).toBeLessThan(10000);
  });

  it("returns capture rate", () => {
    const tracker = new ProgressTracker(100);
    tracker.recordFrame(20, 2000);
    expect(tracker.captureRate()).toBeCloseTo(10, 0);
  });

  it("handles zero frames gracefully", () => {
    const tracker = new ProgressTracker(100);
    expect(tracker.estimateTimeRemaining()).toBeUndefined();
    expect(tracker.captureRate()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/renderer && pnpm vitest run src/utils/progress.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement progress.ts**

```typescript
/**
 * Progress tracking and ETA estimation.
 */

export class ProgressTracker {
  private totalFrames: number;
  private framesCaptured = 0;
  private elapsedMs = 0;

  constructor(totalFrames: number) {
    this.totalFrames = totalFrames;
  }

  recordFrame(framesCaptured: number, elapsedMs: number): void {
    this.framesCaptured = framesCaptured;
    this.elapsedMs = elapsedMs;
  }

  captureRate(): number {
    if (this.elapsedMs <= 0) return 0;
    return this.framesCaptured / (this.elapsedMs / 1000);
  }

  estimateTimeRemaining(): number | undefined {
    const rate = this.captureRate();
    if (rate <= 0) return undefined;
    const remaining = this.totalFrames - this.framesCaptured;
    return (remaining / rate) * 1000;
  }

  progress(): number {
    if (this.totalFrames <= 0) return 0;
    return this.framesCaptured / this.totalFrames;
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/renderer && pnpm vitest run src/utils/progress.test.ts`
Expected: All 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/utils/progress.ts packages/renderer/src/utils/progress.test.ts
git commit -m "feat(renderer): add progress tracking and ETA estimation"
```

---

## Task 12: Final Verification + Package Polish

**Files:**
- Modify: `packages/renderer/package.json` — ensure all exports are correct
- Run: full build + typecheck + tests

- [ ] **Step 1: Run full typecheck**

Run: `cd packages/renderer && pnpm typecheck`
Expected: Clean, no errors.

- [ ] **Step 2: Run all unit tests**

Run: `cd packages/renderer && pnpm test`
Expected: All unit tests pass (integration tests may be skipped without browser env).

- [ ] **Step 3: Verify the package builds**

Run: `cd packages/renderer && pnpm build`
Expected: `dist/` directory created with compiled JS + declaration files.

- [ ] **Step 4: Verify the full monorepo builds**

Run: `pnpm build` (from repo root)
Expected: All packages build successfully, including `@hyperframes/renderer`.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A packages/renderer/
git commit -m "chore(renderer): polish package, fix build issues"
```

---

## Task 13: Browser QA with agent-browser

After implementation is complete, use agent-browser to:

1. Serve a test composition via a local file server
2. Open the Studio in a browser
3. Trigger a client-side render
4. Verify the MP4 downloads and plays correctly
5. Record the session as a QA video

This task is deferred until after all code tasks are complete.

- [ ] **Step 1: Run QA via agent-browser skill**

Invoke `/agent-browser` with instructions to:
- Start a local dev server (`pnpm dev` in the studio)
- Open the studio URL
- Load a test composition
- Click "Render in Browser" (or trigger `render()` from the console)
- Wait for the MP4 blob download
- Verify the output plays in a `<video>` element
- Record the entire session

---

## Summary

| Task | Description | Estimated Steps |
|---|---|---|
| 1 | Package scaffold + types | 7 |
| 2 | Frame timing utility | 5 |
| 3 | SnapDOM frame source | 5 |
| 4 | Encoding worker + wrapper | 6 |
| 5 | Audio mixer | 5 |
| 6 | Iframe pool | 5 |
| 7 | Video frame injector | 2 |
| 8 | Main renderer orchestrator | 4 |
| 9 | E2E integration test | 3 |
| 10 | Wire video injector to SnapDOM | 3 |
| 11 | Progress/ETA utility | 5 |
| 12 | Final verification + polish | 5 |
| 13 | Browser QA with agent-browser | 1 |
| **Total** | | **56 steps** |
