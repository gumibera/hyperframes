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
  workerUrl?: URL | string;
}

export interface RenderProgress {
  stage: "initializing" | "capturing" | "encoding" | "mixing-audio" | "muxing" | "complete";
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
