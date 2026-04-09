# Client-Side Video Renderer — Design Spec

> **Date:** 2026-04-10
> **Status:** Draft
> **Package:** `@hyperframes/renderer`
> **Goal:** Render HyperFrames compositions to MP4 entirely in the browser — no server, no Puppeteer, no FFmpeg.

---

## 1. Motivation

The current rendering pipeline (`@hyperframes/producer` + `@hyperframes/engine`) requires server-side infrastructure:

- **Puppeteer** + **chrome-headless-shell** (~400MB) for frame capture via Chrome's `HeadlessExperimental.beginFrame` CDP API
- **FFmpeg** (~100MB) for encoding, audio mixing, and muxing
- A Node.js server to orchestrate the pipeline

This means every render requires either a local dev machine with these binaries or a cloud server. The cost, complexity, and accessibility barriers limit where HyperFrames can be used.

**Browser APIs have matured enough to replace this entire stack:**

| Server-side dependency | Browser replacement |
|---|---|
| Puppeteer (frame capture) | SnapDOM / `drawElementImage` (html-in-canvas) |
| FFmpeg (video encoding) | WebCodecs `VideoEncoder` (hardware-accelerated) |
| FFmpeg (muxing) | MediaBunny (zero-dep TS, supports MP4/WebM/MOV) |
| FFmpeg (audio mixing) | `OfflineAudioContext` (Web Audio API) |
| Node.js server | Web Workers + `OffscreenCanvas` |

### Success Criteria

1. **Zero server dependencies** — Rendering works in a browser tab with no backend
2. **95%+ pixel fidelity** at launch vs. the BeginFrame reference renderer, with a clear path to 100% via `drawElementImage`
3. **Full feature parity** with the server-side producer: GSAP/CSS/Lottie/Three.js animations, embedded `<video>` elements, multi-track audio mixing, sub-compositions
4. **Universal consumption** — Works in Studio, Player, and as a standalone JS API

---

## 2. Architecture Overview

### Approach: Interfaces First + Thin Slice + Parallel Widen

1. **Define all interfaces** upfront — `FrameSource`, `EncoderPipeline`, `AudioMixer`, `Muxer`, `Renderer`
2. **Build the thinnest end-to-end slice** — single iframe + SnapDOM → single WebCodecs encode → MediaBunny mux → MP4 blob. Validates SnapDOM fidelity on day 1.
3. **Widen in parallel** — add Worker pool, parallel iframes, audio mixing, video element support, all behind the established interfaces

### Pipeline Diagram

```
                        Main Thread                              Worker Pool
┌──────────────────────────────────────────────┐    ┌─────────────────────────────────┐
│                                              │    │                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐      │    │  ┌──────────┐  ┌────────────┐  │
│  │iframe[0]│  │iframe[1]│  │iframe[2]│ ...   │    │  │WebCodecs │  │ MediaBunny │  │
│  │seek(0-N)│  │seek(N-M)│  │seek(M-T)│      │    │  │VideoEnc  │──│   Muxer    │  │
│  └────┬────┘  └────┬────┘  └────┬────┘      │    │  └──────────┘  └─────┬──────┘  │
│       │             │            │            │    │                      │         │
│       ▼             ▼            ▼            │    │                      ▼         │
│  ┌──────────────────────────────────────┐    │    │              ┌──────────────┐  │
│  │         FrameSource (SnapDOM)        │    │    │              │  MP4 Blob    │  │
│  │  seek → snapshot → ImageBitmap       │    │    │              └──────────────┘  │
│  └──────────────────┬───────────────────┘    │    │                                 │
│                     │ transferable           │    │                                 │
│                     │ ImageBitmap            │    │                                 │
│                     └────────────────────────┼───►│                                 │
│                                              │    │                                 │
│  ┌──────────────────────────────────────┐    │    │                                 │
│  │         AudioMixer                   │    │    │                                 │
│  │  OfflineAudioContext → PCM buffer    │────┼───►│  Muxed into MP4 audio track     │
│  └──────────────────────────────────────┘    │    │                                 │
└──────────────────────────────────────────────┘    └─────────────────────────────────┘
```

### Data Flow (per frame)

1. **Seek**: `iframe.contentWindow.__hf.seek(time)` — positions composition at exact frame time
2. **Capture**: `FrameSource.capture(iframe)` — SnapDOM snapshots the DOM to an `ImageBitmap`
3. **Transfer**: `worker.postMessage({ frame, index }, [frame])` — zero-copy transfer to worker
4. **Encode**: `VideoEncoder.encode(new VideoFrame(bitmap, { timestamp }))` — hardware-accelerated
5. **Mux**: MediaBunny collects encoded chunks into MP4 container
6. **Audio**: `OfflineAudioContext` renders mixed audio → raw PCM → muxed as audio track
7. **Output**: Final MP4 `Blob` returned to caller

---

## 3. Interfaces

### 3.1 FrameSource

The abstraction that makes the renderer future-proof. Swappable implementations: SnapDOM today, `drawElementImage` tomorrow.

```typescript
/**
 * A FrameSource captures visual frames from a composition at specific times.
 * Implementations must produce deterministic output for a given time.
 */
interface FrameSource {
  /** Human-readable name for diagnostics */
  readonly name: string;

  /**
   * Initialize the frame source with the composition.
   * May create iframes, set up canvases, load the composition, etc.
   */
  init(config: FrameSourceConfig): Promise<void>;

  /**
   * Capture a single frame at the given time.
   * Returns a transferable ImageBitmap suitable for posting to a Worker.
   */
  capture(time: number): Promise<ImageBitmap>;

  /**
   * The total duration of the loaded composition in seconds.
   * Available after init() resolves.
   */
  readonly duration: number;

  /**
   * Media elements declared by the composition (video/audio sources).
   * Available after init() resolves.
   */
  readonly media: HfMediaElement[];

  /** Release all resources (iframes, canvases, etc.) */
  dispose(): Promise<void>;
}

interface FrameSourceConfig {
  /** Path or URL to the composition HTML file */
  compositionUrl: string;
  /** Viewport width in pixels */
  width: number;
  /** Viewport height in pixels */
  height: number;
  /** Device pixel ratio (default: 1) */
  devicePixelRatio?: number;
}
```

### 3.2 EncoderPipeline

```typescript
/**
 * Encodes ImageBitmap frames into compressed video chunks.
 * Runs inside a Web Worker.
 */
interface EncoderPipeline {
  /** Configure the encoder. Must be called before encode(). */
  init(config: EncoderConfig): Promise<void>;

  /** Encode a single frame. Frames must be submitted in order. */
  encode(frame: ImageBitmap, index: number, timestamp: number): Promise<void>;

  /** Signal that all frames have been submitted. Flushes the encoder. */
  flush(): Promise<void>;

  /** The encoded video chunks, available after flush(). */
  readonly chunks: EncodedVideoChunk[];

  dispose(): void;
}

interface EncoderConfig {
  width: number;
  height: number;
  fps: number;
  codec: 'avc1.640028' | 'vp09.00.31.08';  // H.264 High / VP9
  bitrate?: number;        // Default: auto-calculated from resolution
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software';
}
```

### 3.3 AudioMixer

```typescript
/**
 * Mixes audio sources into a single PCM buffer using OfflineAudioContext.
 */
interface AudioMixer {
  /**
   * Mix all audio sources for the composition.
   * Decodes audio files, applies volume/timing, renders to PCM.
   */
  mix(config: AudioMixConfig): Promise<AudioMixResult>;
}

interface AudioMixConfig {
  /** Total composition duration in seconds */
  duration: number;
  /** Sample rate (default: 44100) */
  sampleRate?: number;
  /** Number of channels (default: 2, stereo) */
  channels?: number;
  /** Audio sources to mix */
  sources: AudioSource[];
}

interface AudioSource {
  /** URL or Blob of the audio/video file */
  src: string | Blob;
  /** When in the composition this audio starts (seconds) */
  startTime: number;
  /** When in the composition this audio ends (seconds) */
  endTime: number;
  /** Offset into the source file (seconds, default: 0) */
  mediaOffset?: number;
  /** Volume 0-1 (default: 1) */
  volume?: number;
}

interface AudioMixResult {
  /** Raw PCM audio buffer (Float32Array per channel) */
  buffer: AudioBuffer;
  /** Sample rate used */
  sampleRate: number;
  /** Number of channels */
  channels: number;
}
```

### 3.4 Muxer

```typescript
/**
 * Muxes encoded video chunks and audio into a container format.
 * Powered by MediaBunny.
 */
interface Muxer {
  init(config: MuxerConfig): Promise<void>;

  /** Add an encoded video chunk */
  addVideoChunk(chunk: EncodedVideoChunk): void;

  /** Set the audio track (raw PCM from AudioMixer) */
  setAudio(audio: AudioMixResult): void;

  /** Finalize and produce the output file */
  finalize(): Promise<Blob>;
}

interface MuxerConfig {
  format: 'mp4' | 'webm';
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
}
```

### 3.5 Renderer (Public API)

```typescript
/**
 * The main public API. Orchestrates the full pipeline.
 */
interface Renderer {
  /**
   * Render a composition to video.
   * Returns a Blob containing the final MP4/WebM.
   */
  render(config: RenderConfig): Promise<RenderResult>;

  /** Cancel an in-progress render */
  cancel(): void;

  /** Check if WebCodecs and required APIs are available */
  static isSupported(): boolean;
}

interface RenderConfig {
  /** Path or URL to the composition HTML */
  composition: string;
  /** Output format (default: 'mp4') */
  format?: 'mp4' | 'webm';
  /** Frames per second (default: 30) */
  fps?: 24 | 30 | 60;
  /** Output width (default: 1920) */
  width?: number;
  /** Output height (default: 1080) */
  height?: number;
  /** Device pixel ratio (default: 1) */
  devicePixelRatio?: number;
  /** Video codec (default: H.264) */
  codec?: 'h264' | 'vp9';
  /** Video bitrate in bps (default: auto) */
  bitrate?: number;
  /** Number of parallel capture iframes (default: auto based on navigator.hardwareConcurrency) */
  concurrency?: number;
  /** Progress callback */
  onProgress?: (progress: RenderProgress) => void;
  /** Which frame source to use (default: auto-detect best available) */
  frameSource?: 'snapdom' | 'draw-element-image';
}

interface RenderProgress {
  stage: 'initializing' | 'capturing' | 'encoding' | 'mixing-audio' | 'muxing' | 'complete';
  /** 0-1 overall progress */
  progress: number;
  /** Current frame being processed */
  currentFrame?: number;
  /** Total frames */
  totalFrames?: number;
  /** Estimated time remaining in ms */
  estimatedTimeRemaining?: number;
  /** Frames per second capture rate */
  captureRate?: number;
}

interface RenderResult {
  /** The final video file */
  blob: Blob;
  /** MIME type */
  mimeType: string;
  /** Render duration in ms */
  durationMs: number;
  /** Performance breakdown */
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

---

## 4. Frame Source Implementations

### 4.1 SnapDOM Frame Source (Interim)

Uses SnapDOM (`@snapdom/snapdom`) to capture DOM snapshots as images, then converts to `ImageBitmap`.

**How it works:**
1. Load composition in a hidden `<iframe>` (same-origin)
2. Seek to target time via `iframe.contentWindow.__hf.seek(time)`
3. Call SnapDOM to snapshot the iframe's document element → produces a `<canvas>` or `Blob`
4. Convert to `ImageBitmap` via `createImageBitmap()`
5. Return the transferable `ImageBitmap`

**Known limitations (vs. BeginFrame reference):**
- Uses SVG `foreignObject` internally — cross-origin images won't render without CORS
- `<video>` element frames may not be captured (requires separate handling — see Section 6)
- Complex CSS features (some blend modes, `backdrop-filter` in edge cases) may differ slightly
- Performance: designed for one-shot screenshots, not sustained 30fps. Parallel iframes mitigate this.

**Fidelity target:** 95%+ for compositions using standard CSS + GSAP animations.

### 4.2 drawElementImage Frame Source (Future)

Uses the WICG html-in-canvas API when available.

**How it works:**
1. Load composition as a child of `<canvas layoutsubtree>`
2. Seek to target time via the composition's `__hf.seek(time)`
3. In the `paint` event handler, call `ctx.drawElementImage(compositionEl, 0, 0)`
4. Use `captureElementImage()` to create a transferable `ElementImage`
5. Transfer to worker → draw on `OffscreenCanvas` → `ImageBitmap`

**Advantages:**
- Uses the browser's actual rendering engine — pixel-perfect fidelity
- Supports all CSS features the browser supports
- Native performance — no JavaScript re-rendering

**Availability:** Chrome behind flag (`chrome://flags/#canvas-draw-element`). WHATWG Stage 2. Estimated stable: 2027+.

**CSS transform caveat:** `drawElementImage` ignores CSS transforms on the source element. GSAP primarily animates via transforms. Workarounds:
- Wrap animated elements in a container; GSAP animates the inner element, `drawElementImage` captures the container (which has the computed layout including the inner element's transforms applied by the browser's rendering)
- OR apply GSAP animations to non-transform properties where possible
- This needs validation once the API supports video elements

### 4.3 Auto-Detection

```typescript
function detectBestFrameSource(): 'draw-element-image' | 'snapdom' {
  // Check for html-in-canvas support
  const canvas = document.createElement('canvas');
  if ('drawElementImage' in CanvasRenderingContext2D.prototype) {
    return 'draw-element-image';
  }
  return 'snapdom';
}
```

---

## 5. Parallel Iframe Capture

### Strategy

Mirror the server-side `parallelCoordinator.ts` pattern but with browser iframes instead of Puppeteer instances.

```typescript
interface IframePool {
  /** Create N iframes, each loading the composition */
  init(compositionUrl: string, count: number, viewport: Viewport): Promise<void>;

  /**
   * Capture frames in parallel across iframes.
   * Each iframe is assigned a contiguous range of frame times.
   * Returns ImageBitmaps in frame order.
   */
  captureAll(
    frameTimes: number[],
    frameSource: FrameSource,
    onFrame: (bitmap: ImageBitmap, index: number) => void,
  ): Promise<void>;

  dispose(): void;
}
```

### Frame Distribution

```
Total: 300 frames, 4 iframes

iframe[0]: frames   0- 74  (seek 0.000s - 2.467s)
iframe[1]: frames  75-149  (seek 2.500s - 4.967s)
iframe[2]: frames 150-224  (seek 5.000s - 7.467s)
iframe[3]: frames 225-299  (seek 7.500s - 9.967s)
```

Each iframe captures its range sequentially. The four iframes run in parallel (using `Promise.all`). Captured `ImageBitmap` frames are posted to the encoding worker pool as they complete.

### Concurrency Default

```typescript
const defaultConcurrency = Math.max(1, Math.min(
  navigator.hardwareConcurrency - 1,  // Leave 1 core for encoding workers
  8  // Cap at 8 iframes to avoid memory pressure
));
```

---

## 6. Video Element Handling

Embedded `<video>` elements in compositions need special handling because:
1. SnapDOM cannot capture `<video>` frame content (foreignObject limitation)
2. Videos must be seeked to the correct time for each frame

### Strategy: Canvas Replacement

For each `<video>` element declared in `window.__hf.media`:

1. **Decode video frames client-side** using MediaBunny's demuxer + WebCodecs `VideoDecoder`
2. **Create a `<canvas>` overlay** positioned exactly over the `<video>` element
3. **Before each frame capture**, seek the video decoder to the target time, draw the decoded frame onto the overlay canvas
4. **SnapDOM captures the canvas** (which it CAN render) instead of the `<video>` element

This mirrors the server-side `videoFrameInjector.ts` pattern — replace `<video>` with pre-extracted frames drawn onto a canvas.

```typescript
interface VideoFrameInjector {
  /** Pre-decode video sources and prepare frame lookup */
  init(media: HfMediaElement[]): Promise<void>;

  /** Draw the correct video frame for a given composition time onto overlay canvases */
  injectFrame(time: number): Promise<void>;

  dispose(): void;
}
```

### Video Decoding Pipeline

```
Source video (URL/Blob)
  → MediaBunny demux (extract video track packets)
  → WebCodecs VideoDecoder (decode to VideoFrame)
  → drawImage onto overlay <canvas>
  → SnapDOM captures canvas as part of DOM snapshot
```

For performance, video frames are decoded on-demand per composition time, not pre-extracted. MediaBunny supports seeking to arbitrary positions efficiently.

---

## 7. Audio Handling

### Pipeline

```
Composition's window.__hf.media[]
  → Filter elements with hasAudio === true
  → Fetch each audio source (URL → ArrayBuffer)
  → AudioContext.decodeAudioData() → AudioBuffer per source
  → OfflineAudioContext:
      - Create BufferSourceNode per source
      - Apply volume via GainNode
      - Apply timing (startTime, mediaOffset, endTime)
      - Connect all to destination
      - OfflineAudioContext.startRendering()
  → AudioBuffer (mixed PCM)
  → Float32Array per channel → MediaBunny mux as audio track
```

### Composition-level Audio

Some compositions have a single `<audio>` element or background music. These are also declared in `window.__hf.media` and handled identically.

### Sample Rate

Default: 44100 Hz (CD quality). Matches the server-side producer. MediaBunny supports arbitrary sample rates.

---

## 8. Encoding Worker

### Worker Architecture

A single encoding worker handles the video encoding + muxing pipeline. The main thread streams `ImageBitmap` frames to it.

```
Main Thread                          Encoding Worker
───────────                          ───────────────
postMessage({                        onmessage:
  type: 'init',                        → create VideoEncoder
  config: EncoderConfig                → create MediaBunny muxer
})

postMessage({                        onmessage:
  type: 'frame',                       → new VideoFrame(bitmap, {timestamp})
  bitmap: ImageBitmap,                 → encoder.encode(frame)
  index, timestamp                     → frame.close()  // prevent GPU leak
}, [bitmap])                           → encoder output → muxer.addVideoChunk()

postMessage({                        onmessage:
  type: 'set-audio',                   → muxer.setAudio(pcmData)
  pcmData: Float32Array[]
}, [...pcmData])

postMessage({                        onmessage:
  type: 'finalize'                     → encoder.flush()
})                                     → muxer.finalize()
                                       → postMessage({ type: 'done', blob })
```

### Why a Single Encoding Worker (Not a Pool)

WebCodecs `VideoEncoder` produces chunks that must be muxed in order. Multiple encoding workers would require coordinating chunk ordering across workers and merging partial MP4 segments. A single encoder with hardware acceleration is fast enough — the bottleneck is frame capture, not encoding. The parallelism happens at the capture layer (multiple iframes), not the encoding layer.

### Memory Management

Critical: `VideoFrame.close()` must be called after encoding to release GPU memory. Without this, GPU memory exhausts within seconds. The worker is responsible for calling `.close()` on every frame after `encoder.encode()`.

```typescript
// Inside worker
encoder.encode(videoFrame);
videoFrame.close();  // CRITICAL — prevents GPU memory leak
```

---

## 9. Package Structure

```
packages/renderer/
  package.json                      # @hyperframes/renderer, browser-only
  tsconfig.json
  src/
    index.ts                        # Public API exports
    types.ts                        # All shared interfaces and types
    renderer.ts                     # Main Renderer class — orchestrates pipeline
    compat.ts                       # Feature detection (WebCodecs, OffscreenCanvas)
    sources/
      types.ts                      # FrameSource interface
      snapdom.ts                    # SnapDOM frame source implementation
      draw-element-image.ts         # html-in-canvas frame source (future)
      auto-detect.ts                # Auto-selects best available source
    capture/
      iframe-pool.ts                # Manages parallel hidden iframes
      frame-scheduler.ts            # Distributes frame ranges across iframes
      video-frame-injector.ts       # Overlay canvases for <video> elements
    encoding/
      encoder.ts                    # WebCodecs VideoEncoder wrapper (runs in worker)
      worker.ts                     # Web Worker entry point
      types.ts                      # Worker message protocol types
    audio/
      mixer.ts                      # OfflineAudioContext-based mixer
      decoder.ts                    # Audio file decoding helpers
    muxing/
      muxer.ts                      # MediaBunny muxer wrapper
    utils/
      timing.ts                     # Frame time quantization (reuses @hyperframes/core)
      progress.ts                   # Progress calculation and ETA
  tests/
    renderer.test.ts                # End-to-end render tests
    sources/snapdom.test.ts         # SnapDOM capture fidelity tests
    encoding/encoder.test.ts        # WebCodecs encoder tests
    audio/mixer.test.ts             # Audio mixing tests
    capture/iframe-pool.test.ts     # Iframe pool tests
```

### Dependencies

```json
{
  "dependencies": {
    "@snapdom/snapdom": "^2.1.0",
    "mediabunny": "^1.40.0"
  },
  "peerDependencies": {
    "@hyperframes/core": "workspace:*"
  }
}
```

**Zero Node.js dependencies.** This package is browser-only. It uses `@hyperframes/core` for shared types (`HfMediaElement`, `quantizeTimeToFrame`) but nothing from `engine` or `producer`.

---

## 10. Public API

### Basic Usage

```typescript
import { render, isSupported } from '@hyperframes/renderer';

if (!isSupported()) {
  alert('Your browser does not support WebCodecs. Use Chrome 94+, Firefox 130+, or Safari 26+.');
}

const result = await render({
  composition: './my-composition/index.html',
  fps: 30,
  width: 1920,
  height: 1080,
  onProgress: (p) => {
    console.log(`${p.stage}: ${Math.round(p.progress * 100)}%`);
  },
});

// Download the video
const url = URL.createObjectURL(result.blob);
const a = document.createElement('a');
a.href = url;
a.download = 'output.mp4';
a.click();
```

### Advanced Usage

```typescript
import { createRenderer } from '@hyperframes/renderer';

const renderer = createRenderer({
  composition: './my-composition/index.html',
  format: 'mp4',
  fps: 60,
  width: 3840,
  height: 2160,
  codec: 'h264',
  bitrate: 20_000_000,
  concurrency: 4,
  frameSource: 'snapdom', // or 'draw-element-image'
  onProgress: updateUI,
});

// Start rendering
const result = await renderer.render();

// Or cancel mid-render
cancelButton.onclick = () => renderer.cancel();
```

---

## 11. Studio Integration

The Studio gets a "Render in Browser" button alongside the existing server-side render.

```typescript
// packages/studio/src/components/RenderDialog.tsx
import { render, isSupported } from '@hyperframes/renderer';

// Feature detection determines which render options are shown
const canRenderClientSide = isSupported();

// When user clicks "Render in Browser":
const result = await render({
  composition: compositionUrl,  // Same URL the studio preview iframe uses
  fps: selectedFps,
  width: selectedWidth,
  height: selectedHeight,
  onProgress: (p) => setRenderProgress(p),
});

// Offer download
downloadBlob(result.blob, `${compositionName}.mp4`);
```

---

## 12. Player Integration

The `<hyperframes-player>` web component gets an `export()` method.

```typescript
// packages/player/src/hyperframes-player.ts
import { render, isSupported } from '@hyperframes/renderer';

class HyperframesPlayer extends HTMLElement {
  async export(options?: Partial<RenderConfig>): Promise<Blob> {
    if (!isSupported()) {
      throw new Error('Client-side rendering requires WebCodecs support');
    }
    const result = await render({
      composition: this.getAttribute('src')!,
      ...options,
    });
    return result.blob;
  }
}
```

Usage:
```javascript
const player = document.querySelector('hyperframes-player');
const blob = await player.export({ fps: 30 });
```

---

## 13. Browser Requirements

| API | Chrome | Firefox | Safari | Required |
|---|---|---|---|---|
| WebCodecs (VideoEncoder) | 94+ | 130+ | 26+ | Yes |
| OffscreenCanvas | 69+ | 105+ | 17+ | Yes |
| Web Workers | All | All | All | Yes |
| OfflineAudioContext | All | All | All | Yes |
| createImageBitmap | 50+ | 42+ | 15+ | Yes |
| Transferable ImageBitmap | 56+ | 105+ | 17+ | Yes |

**Minimum browser versions:** Chrome 94, Firefox 130, Safari 26.

Feature detection:

```typescript
function isSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof createImageBitmap !== 'undefined'
  );
}
```

---

## 14. Performance Expectations

### Capture Rate Targets

| Resolution | Iframes | Target capture FPS | Notes |
|---|---|---|---|
| 1920x1080 | 4 | 8-15 fps aggregate | SnapDOM bottleneck |
| 1920x1080 | 8 | 12-20 fps aggregate | Diminishing returns beyond 8 |
| 1280x720 | 4 | 15-25 fps aggregate | Lower resolution helps |

### Encoding Rate

WebCodecs hardware-accelerated encoding is fast:
- H.264 1080p: 200-500 fps (not the bottleneck)
- VP9 1080p: 50-150 fps (slower but still faster than capture)

### End-to-End Estimate

For a 10-second 1080p30 composition (300 frames) with 4 iframes:
- Capture: ~20-40 seconds (bottleneck)
- Encoding: ~1-2 seconds
- Audio mixing: ~0.5 seconds
- Muxing: ~0.5 seconds
- **Total: ~25-45 seconds**

With `drawElementImage` (future): capture should be near-realtime, reducing total to ~12-15 seconds.

---

## 15. Testing Strategy

### Fidelity Testing

Render the same composition with both the server-side producer (BeginFrame) and the client-side renderer. Compare output frames pixel-by-pixel using SSIM (Structural Similarity Index).

```
Reference: npx hyperframes render composition.html --output ref.mp4
Test:      Client-side render → test.mp4
Compare:   Extract frames, compute SSIM per frame
Pass:      Average SSIM > 0.95 (95% fidelity)
```

### Unit Tests

- `FrameSource` implementations: capture a known composition, verify output dimensions and non-empty content
- `EncoderPipeline`: encode synthetic color frames, verify output is valid video
- `AudioMixer`: mix known waveforms, verify output amplitudes and timing
- `Muxer`: produce MP4 from synthetic data, verify it plays in a `<video>` element
- `IframePool`: verify frame distribution and ordering

### Integration Tests

- Full end-to-end: render a test composition, verify the output MP4 plays and has correct duration
- Progress callback: verify all stages fire and progress reaches 1.0
- Cancellation: start a render, cancel mid-way, verify resources are cleaned up
- Error handling: invalid composition URL, unsupported browser, corrupt media files

### QA

Agent-browser automated visual testing after implementation (per user request).

---

## 16. Migration Path

### Phase 1: New Package, Optional

- `@hyperframes/renderer` ships as a new package
- Studio offers "Render in Browser" alongside existing server-side render
- Player gets `export()` method
- Server-side producer remains the default and recommended path
- Documentation clearly states fidelity caveats

### Phase 2: `drawElementImage` Integration

- When html-in-canvas ships in Chrome stable, add the `draw-element-image` frame source
- Run fidelity tests — if >99% SSIM vs. BeginFrame, promote client-side as default
- Server-side remains as fallback for unsupported browsers

### Phase 3: Deprecate Server-Side

- When html-in-canvas ships cross-browser (Chrome + Firefox + Safari)
- Client-side renderer reaches 100% fidelity parity
- Deprecate `@hyperframes/producer` and `@hyperframes/engine`
- Server-side becomes a "legacy" option for CI/headless environments

---

## 17. Open Questions

1. **SnapDOM + GSAP transforms**: Does SnapDOM faithfully capture GSAP-animated transforms? Needs empirical testing with real compositions in the thin slice phase.

2. **SnapDOM sustained throughput**: What's the realistic per-frame capture latency for complex compositions (50+ DOM elements, multiple GSAP timelines)? This determines whether 4 or 8 iframes are needed.

3. **Video frame seeking accuracy**: Can MediaBunny's demuxer + WebCodecs VideoDecoder seek to arbitrary timestamps with frame accuracy, or only to keyframes? If keyframe-only, we may need to decode forward from the nearest keyframe.

4. **Memory pressure**: With 4-8 iframes + a worker, what's the memory footprint? Need to test with compositions that embed large assets (4K video, high-res images).

5. **Safari 26 WebCodecs quirks**: Safari just shipped full WebCodecs. Are there codec configuration differences or bugs we need to work around?

6. **Sub-composition rendering**: Compositions can embed other compositions. Do nested iframes work with SnapDOM capture, or do we need to flatten sub-compositions first?

---

## 18. Glossary

| Term | Definition |
|---|---|
| **BeginFrame** | Chrome's `HeadlessExperimental.beginFrame` CDP API — runs a single deterministic layout-paint-composite cycle |
| **SnapDOM** | DOM snapshot library using SVG foreignObject — best-in-class for CSS fidelity |
| **drawElementImage** | WICG html-in-canvas API — native DOM-to-canvas rendering (Stage 2, Chrome flag) |
| **MediaBunny** | Zero-dep TypeScript media toolkit — successor to mp4-muxer/webm-muxer |
| **WebCodecs** | Browser API for hardware-accelerated video/audio encoding/decoding |
| **OffscreenCanvas** | Canvas API usable in Web Workers — decouples rendering from main thread |
| **HfProtocol** | `window.__hf` — the seek protocol compositions expose for deterministic rendering |
| **FrameSource** | Pluggable interface for capturing frames — the abstraction that enables swapping SnapDOM for drawElementImage |
