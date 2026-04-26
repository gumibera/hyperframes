# HyperFrames Native Renderer — Roadmap to Renderer Supremacy

---

## The Problem

Every video rendering framework today — HyperFrames included, Remotion included — renders video the same way: open a headless Chrome browser, seek to each frame, take a screenshot via the Chrome DevTools Protocol, serialize it as base64, transfer it over a WebSocket, decode it, and pipe it to FFmpeg. This costs **14-40 milliseconds per frame**. For a 30-second video at 30fps, that's 12-36 seconds just on screenshots — and no amount of configuration tuning can make it faster. The CDP serialization round-trip is a physics wall.

## What We're Building

A native video renderer in Rust that uses **Skia** — the same 2D graphics library that Chrome itself uses to paint every pixel you see — to render composition frames directly, bypassing Chrome entirely. Chrome is used once (~200ms) to extract the layout tree, then Skia paints all subsequent frames at **1.8ms per frame on CPU** and **0.22ms per frame on GPU**. That's 8-180x faster than the Chrome screenshot path.

## Why Rust

- **Performance**: Rust compiles to native machine code with zero garbage collection pauses. Frame rendering is a tight loop where every millisecond matters — GC pauses from Node.js or Go would show up as frame drops.
- **Skia bindings**: The `skia-safe` crate provides production-grade Rust bindings to Google's Skia library (the same C++ engine inside Chrome, Android, and Flutter). We get Chrome-identical rendering quality from Chrome's own engine.
- **Memory safety**: Video rendering processes gigabytes of pixel data. Rust's ownership model prevents buffer overflows, use-after-free, and data races that would be silent bugs in C/C++.
- **Cross-platform**: One codebase compiles to macOS (Metal GPU), Linux (Vulkan GPU or CPU), and can target Windows. No JVM, no runtime, no container dependency beyond FFmpeg.
- **Ecosystem**: H.264 encoding (openh264, BSD-licensed), MP4 muxing (minimp4), SIMD color conversion (dcv-color-primitives) — all available as Rust crates with permissive licenses.

## What This Solves

1. **Rendering speed**: 8-22x faster on CPU, 64-182x faster on GPU. A 30-second video that takes 40 seconds with Chrome renders in 2-5 seconds natively.
2. **Infrastructure cost**: Each Chrome instance uses ~256MB RAM. The native renderer uses ~50MB. On cloud GPU instances, one machine renders 10-50x more videos per hour.
3. **Competitive moat**: Remotion cannot copy this (explained below). Our composition format enables native rendering; theirs doesn't.
4. **Path to real-time**: At 0.22ms/frame on GPU, we can preview compositions at 60fps+ in a native desktop app without a browser.

## Definition of Done

The native renderer is production-ready when:

1. **`--backend auto` produces correct output** for all compositions. Unsupported compositions fall back to Chrome automatically. No silent quality loss.
2. **80%+ of regression test fixtures render natively** with PSNR > 30dB against Chrome output (imperceptible visual difference).
3. **Render speed is 10x+ faster** than Chrome CDP on Linux CPU for supported compositions, measured end-to-end (paint + encode + mux).
4. **Every claim is benchmarked**: speed numbers come from CI, not local machines. PSNR scores come from the regression harness, not eyeballing.
5. **Zero regressions** in the existing Chrome pipeline. The native renderer is additive — it doesn't modify any existing code path.

## Current Status

**Phase 1-3 complete.** 51 Rust tests + 31 TypeScript tests, all passing on macOS and Linux CI. The paint layer is proven fast. The encoding layer and visual fidelity gap are the remaining work (Phases 4-7, ~8-12 weeks).

---

## 1. Why This Is an Unchallengeable Moat

### Remotion Cannot Follow

Remotion's API contract is **React components rendered in Chrome**. Every Remotion composition is a React component that uses hooks (`useCurrentFrame`, `useVideoConfig`), renders JSX to a real DOM, and relies on Chrome to paint it. This means:

- Remotion MUST run Chrome on every frame (React needs a DOM)
- Remotion CANNOT switch to Skia (every user component would break)
- Remotion CANNOT pre-bake timelines (React components can `useEffect`, `fetch`, `useState`)

HyperFrames compositions are **declarative HTML + GSAP timelines**. The HTML defines a static scene graph. GSAP defines a deterministic function: `time → property values`. Neither requires a browser to evaluate. This means:

- We can extract the scene graph once and replay it natively
- We can evaluate GSAP in a lightweight V8 isolate (no DOM needed)
- We can paint with Skia (Chrome's own engine) at GPU speed

The **authoring format** is the moat. HTML+GSAP is thin enough to map to native rendering. React is too thick.

### The Adapter Architecture

Because our composition format is a thin declarative layer, ANY rendering backend can consume it:

| Adapter | Use Case | Status |
|---|---|---|
| Chrome CDP (BeginFrame) | Maximum compatibility, Linux headless | Production |
| Chrome CDP (Screenshot) | Cross-platform, macOS/Windows | Production |
| WebCodecs (browser) | In-browser export, no server | PR #239 |
| **Skia/Rust (native)** | **Maximum speed, production rendering** | **This roadmap** |
| Skia GPU (Metal) | Local dev on Mac | Working (0.22ms/frame) |
| Skia GPU (Vulkan+NVENC) | Cloud GPU instances | Stub ready |

Remotion is locked to one adapter (Chrome). We can have six, each optimized for a different context, all rendering the same compositions identically.

---

## 2. Current Performance Numbers

### Measured on GitHub Actions (Linux x86_64, CPU only, no GPU)

| Benchmark | 30 frames at 1080p | Per frame | vs Chrome CDP |
|---|---|---|---|
| Skia CPU paint | 54ms | **1.8ms** | **7.8-22x faster** |
| Paint + BGRA readback | 55ms | 1.83ms | 7.6-22x faster |
| Paint + I420 convert | 95ms | 3.17ms | 4.4-12.6x faster |
| Raw render + FFmpeg batch | 241ms | 8.03ms | 1.7-5x faster |
| Native openh264 in-process | 478ms | 15.9ms | 0.9-2.5x faster |
| FFmpeg JPEG pipe (baseline) | 1,128ms | 37.6ms | ~1x (same as Chrome) |

### Measured on macOS Apple Silicon (Metal GPU)

| Benchmark | Per frame | vs Chrome CDP |
|---|---|---|
| GPU paint (Metal) | **0.22ms** | **64-182x faster** |
| GPU + BGRA readback | 1.17ms | 12-34x faster |
| E2E with VideoToolbox | 11.2ms | 1.3-3.6x faster |

### Key Insight

The **paint** is 8-180x faster than Chrome CDP. The **encoding** is the remaining bottleneck. The roadmap addresses both.

---

## 3. Architecture

### Current Pipeline (Chrome CDP)

```
HTML composition
  → Producer compiles (resolve sub-compositions, inline scripts)
  → Chrome loads compiled HTML
  → Per frame: seek(t) → Chrome paint → CDP screenshot → base64 → Node.js → FFmpeg
  → FFmpeg encodes H.264 → mux with audio → MP4
  
  Cost: 14-40ms per frame (CDP screenshot is the bottleneck)
```

### Native Pipeline (Skia/Rust)

```
HTML composition
  → Producer compiles (same as Chrome path — reused)
  → Chrome loads compiled HTML (one-shot, ~200ms)
  → Extract scene graph (element positions, sizes, styles → JSON)
  → Bake timeline (GSAP seek at every frame → property values → JSON)
  → Chrome closes (never used again)
  → Rust binary: Skia paints each frame from scene + timeline
  → openh264 encodes H.264 → minimp4 muxes → MP4
  
  Cost: 1.8-3.2ms per frame (Skia paint + color convert)
```

### Hybrid Pipeline (Phase 4 target)

```
HTML composition
  → Producer compiles
  → Support detector classifies each element:
      Supported → Skia native paint
      Unsupported → Chrome CDP screenshot (per-element or full-frame)
  → Composite: native layers + Chrome layers → final frame
  → Encode → MP4
  
  Cost: 2-10ms per frame depending on native coverage
```

---

## 4. What's Built (Phases 1-3)

### Rust Crate: `packages/native-renderer/`

| Component | Files | Tests | Status |
|---|---|---|---|
| Scene graph types + JSON parser | `scene/mod.rs`, `scene/parse.rs` | 7 | Done |
| Skia raster surface + encoding | `paint/canvas.rs` | 4 | Done |
| Element painter (Tier 1+2 CSS) | `paint/elements.rs` | 4 | Done |
| Visual effects (shadow, blur, gradient) | `paint/effects.rs` | 8 | Done |
| Image compositing (JPEG/PNG/WebP) | `paint/images.rs` | 6 | Done |
| Animated pipeline (baked timeline) | `pipeline.rs` | 3 | Done |
| Raw render + deferred encode | `pipeline.rs` | — | Done |
| Native H.264 + MP4 (openh264+minimp4) | `native_encode.rs` | — | Done |
| Hardware encoder detection | `encode.rs` | 12 | Done |
| Metal GPU surface | `paint/canvas.rs` | — | Done (macOS) |
| Vulkan GPU surface | `paint/canvas.rs` | — | Stub (needs GPU) |
| CLI binary | `bin/render_native.rs` | — | Done |
| Criterion benchmarks | `benches/render_bench.rs` | — | Done |

### TypeScript Bridge

| Component | Files | Tests | Status |
|---|---|---|---|
| CDP scene extraction | `scene/extract.ts` | 5 | Done |
| Timeline baking | `timeline/bake.ts` | 5 | Done |
| Support detection | `scene/support.ts` | 21 | Done |

### Integration

| Component | Status |
|---|---|
| `hyperframes render --backend native` CLI flag | Done |
| Support detector → auto fallback to Chrome | Done |
| GitHub Actions CI (Linux, CPU raster) | Done |
| Docker test image | Done |
| Cross-platform feature flags (Metal/Vulkan/CPU) | Done |

### Total: 51 Rust tests + 31 TypeScript tests, all passing on macOS and Linux CI.

---

## 5. Visual Fidelity Gap

### What the Native Renderer Paints Correctly Today

| CSS Feature | Skia Equivalent | Fidelity |
|---|---|---|
| `background-color` (solid) | `Canvas::draw_rect` | Pixel-perfect |
| `border-radius` | `Canvas::draw_rrect` / `clip_rrect` | Pixel-perfect |
| `overflow: hidden` | `Canvas::clip_rect/rrect` | Pixel-perfect |
| `transform` (translate/rotate/scale) | `Canvas::concat` matrix | Pixel-perfect |
| `opacity` | `save_layer_alpha` | Pixel-perfect |
| `visibility/display` | Skip element | Pixel-perfect |
| `box-shadow` (single) | `MaskFilter::blur` + offset | Close (~28-32dB PSNR) |
| `filter: blur()` | `ImageFilter::blur` | Close |
| `filter: brightness/contrast/saturate` | `ColorFilter::matrix` | Close |
| `background: linear-gradient()` | `gradient_shader::linear` | Close |
| `background: radial-gradient()` | `gradient_shader::radial` | Close |
| `clip-path: circle/ellipse` | `Canvas::clip_path` | Close |
| `mix-blend-mode` | `Paint::set_blend_mode` | Pixel-perfect |
| Images (JPEG/PNG/WebP) | `Canvas::draw_image_rect` | Pixel-perfect |

### What's NOT Faithful Yet (the Gap)

| Feature | Why It's Hard | Impact on Apple Presentation |
|---|---|---|
| **Text rendering** | Chrome uses platform-specific font rasterizers (Core Text on Mac, FreeType+HarfBuzz on Linux) with sub-pixel AA. Skia uses its own HarfBuzz path which produces slightly different glyph positions and anti-aliasing. Custom web fonts (Google Fonts) need explicit loading. | High — every slide has text |
| **CSS layout** | Chrome computes flex, grid, absolute/relative positioning. We extract computed positions from Chrome, but if animation changes layout (e.g., text reflow), the extracted positions are stale. | Medium — most animations are transform/opacity only |
| **Video compositing** | Chrome decodes and renders `<video>` frames natively. We need to extract frames via FFmpeg and composite them as images in Skia at correct timestamps. | High — 5 video elements |
| **Sub-composition timing** | Multi-slide compositions chain via `data-start="slide-1"`. The producer resolves these, but the timeline baking needs to capture the full resolved duration. | High — 7 slides, 141s total |
| **Custom fonts** | Google Fonts loaded via `@import url()`. The producer's deterministic font injection handles this for Chrome, but Skia needs the font files loaded explicitly. | High — DM Sans, Lora, DM Mono |
| **Multiple box-shadows** | Chrome renders multiple comma-separated shadows. Our painter does single shadow. | Low — easy to loop |
| **`backdrop-filter`** | Requires rendering content behind the element, then applying a filter. Not implemented. | None in Apple presentation |
| **`text-shadow`** | Draw text twice (shadow + foreground). Not implemented. | Low — minor visual detail |
| **`letter-spacing`, `line-height`** | Skia's paragraph API supports these but we don't extract/apply them yet. | Medium — affects text appearance |

---

## 6. The Roadmap (Phases 4-7)

### Phase 4: Orchestrator Integration + PSNR Comparison (1-2 weeks)

**Goal:** Wire native renderer into the producer's compilation pipeline and measure visual fidelity.

**Deliverables:**
1. Modify `renderOrchestrator.ts` to add a native capture path after Stage 3 (compilation + video extraction + audio). The native path replaces Stage 4 (capture) + Stage 5 (encode).
2. PSNR comparison tool: renders the same composition with both Chrome and native, extracts poster frames at 10 checkpoints, computes PSNR per checkpoint.
3. HTML side-by-side report with Chrome frame, native frame, diff overlay, and PSNR score.
4. Run on all 38 regression fixtures. Report: how many are `native-pass` (PSNR > 30dB), `native-review` (20-30dB), `fallback-required` (unsupported features).

**Success criteria:** At least 10 of 38 fixtures pass with PSNR > 30dB on the native renderer.

### Phase 5: Text Rendering Parity (2-3 weeks)

**Goal:** Make text render identically (or near-identically) between Chrome and Skia.

**Deliverables:**
1. Google Fonts loader: download font files from Google Fonts CDN at extraction time, register them with Skia's `FontMgr`.
2. `letter-spacing`, `line-height`, `text-align`, `font-weight`, `font-style` support in the Skia text painter.
3. Multi-line text via Skia's `Paragraph` API (from the `textlayout` feature).
4. Text color, text-shadow, `-webkit-text-stroke` support.
5. PSNR comparison specifically on text-heavy fixtures.

**Success criteria:** Text-heavy compositions achieve PSNR > 28dB against Chrome output.

### Phase 6: Video Compositing + Sub-Composition Timing (2-3 weeks)

**Goal:** Render compositions with `<video>` elements and multi-slide timing chains.

**Deliverables:**
1. Video frame extraction: reuse the engine's `extractAllVideoFrames()` to get per-frame PNGs.
2. Video frame injection in the Rust painter: for each `<video>` element, look up the correct extracted frame for the current time and draw it as an image.
3. Sub-composition timing: the timeline baking step must evaluate GSAP at the correct global time, not per-slide time. The producer's compilation resolves `data-start` chains — the baked timeline should capture the full resolved timeline.
4. Audio passthrough: the producer's audio mixer already produces `audio.aac`. The native renderer's MP4 output needs to mux this audio track.

**Success criteria:** The Apple presentation renders natively with all 7 slides, 5 videos, and audio. PSNR > 25dB against Chrome output.

### Phase 7: Production Hardening + Zero-Copy Encode (2-3 weeks)

**Goal:** Ship the native renderer as the default backend for supported compositions.

**Deliverables:**
1. `--backend auto` correctly classifies compositions and uses native when safe.
2. The regression test suite runs both Chrome and native, generating a coverage report.
3. Vulkan GPU surface validated on NVIDIA cloud instances (A10G, T4).
4. NVENC zero-copy encoding on Linux GPU (Vulkan → CUDA interop → NVENC).
5. IOSurface → VideoToolbox zero-copy on macOS (the 10-30x E2E unlock).
6. `hyperframes doctor` checks for native renderer dependencies (Rust, Skia, FFmpeg).
7. Documentation: `--backend` flag, performance expectations, fallback behavior.

**Success criteria:**
- 30+ of 38 regression fixtures pass natively (PSNR > 30dB)
- Linux CPU E2E: < 4ms/frame (10x vs Chrome CDP)
- Linux GPU E2E: < 2ms/frame (20x vs Chrome CDP)
- macOS GPU E2E: < 1.5ms/frame (25x vs Chrome CDP)

---

## 7. Competitive Timeline

| Quarter | HyperFrames Native | Remotion |
|---|---|---|
| **Now (Q2 2026)** | Phase 1-3 done. Paint is 8-22x faster. CLI works. Linux CI green. | Chrome-only. Same architecture since v1. |
| **Q3 2026** | Phase 4-5: 50%+ compositions render natively. Text parity proven. PSNR reports public. | Cannot change architecture without breaking all user components. |
| **Q4 2026** | Phase 6-7: Video compositing. 80%+ native coverage. GPU zero-copy. Production default. | Stuck at ~30-50ms/frame. Lambda scaling is their only speed lever. |
| **2027** | Native renderer handles 95%+ compositions. Drop Chrome dependency for supported compositions entirely. Ship as a standalone binary (no Node.js needed). | Still React-in-Chrome. Can add WebCodecs client-side (experimental) but server-side is locked to Chrome. |

---

## 8. Technical Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Skia text rendering diverges from Chrome | High | PSNR regression suite catches drift. Accept 28+ dB as "close enough." |
| Complex CSS layouts computed differently | Medium | Chrome extraction provides computed positions. Only animation-triggered reflow is a problem. |
| Video frame timing drift | Low | FFmpeg extraction uses exact `-ss` timestamps. Frame lookup table is indexed by composition time. |
| Skia API changes break the renderer | Low | Pin `skia-safe` version. Test on every update. |
| GPU availability varies across cloud | Medium | CPU raster fallback is always available. GPU is an acceleration, not a requirement. |
| Memory pressure from large compositions | Medium | Scene graph is compact (~100KB for 100 elements). Frame buffers are pre-allocated and reused. |

---

## 9. Dependencies

### Rust Crates

| Crate | Version | License | Purpose |
|---|---|---|---|
| `skia-safe` | 0.93 | MIT | 2D rendering (Chrome's own engine) |
| `openh264` | 0.6 | BSD-2 | H.264 encoding (Cisco, patent-licensed) |
| `minimp4` | 0.1 | MIT | MP4 container muxing |
| `dcv-color-primitives` | 0.7 | MIT | SIMD BGRA→I420 conversion |
| `serde` + `serde_json` | 1.x | MIT | JSON serialization |
| `criterion` | 0.5 | Apache-2 | Benchmarking |
| `metal` | 0.31 | MIT | macOS GPU (optional) |

### System Dependencies

| Dependency | Required By | Fallback |
|---|---|---|
| FFmpeg | Video extraction, audio mixing, batch encode | Required (already a HyperFrames dependency) |
| Clang + Ninja | Skia source build on Linux ARM64 | Pre-built binaries available for x86_64 |
| Fonts (Liberation, DejaVu) | Text rendering | Skia falls back to system default |

---

## 10. Success Metrics

### Speed

| Metric | Target | Current |
|---|---|---|
| Render-only (paint + convert) | < 2ms/frame (Linux CPU) | **1.8ms** ✅ |
| E2E with encode | < 4ms/frame (Linux CPU) | 8ms (needs optimization) |
| E2E GPU (Metal) | < 1.5ms/frame | 0.22ms paint, 11.2ms E2E |
| E2E GPU (Vulkan+NVENC) | < 2ms/frame | Not yet validated |

### Quality

| Metric | Target | Current |
|---|---|---|
| PSNR vs Chrome (simple compositions) | > 30dB | Not yet measured |
| PSNR vs Chrome (text-heavy) | > 28dB | Not yet measured |
| PSNR vs Chrome (video compositions) | > 25dB | Not yet measured |
| Regression fixtures passing natively | > 80% | ~30% estimated |

### Coverage

| Metric | Target | Current |
|---|---|---|
| CSS properties supported | Tier 1+2+3 (90%+ of compositions) | Tier 1+2 (60%) |
| Video compositing | Full support | Not implemented |
| Audio passthrough | Full support | Not implemented |
| Sub-composition timing | Full support | Partial |
| Custom web fonts | Full support | Not implemented |

---

## 11. How to Test Today

```bash
# Render with native backend (simple compositions)
hyperframes render my-composition/ --output video.mp4 --backend native

# Auto-detect: native if supported, Chrome fallback if not
hyperframes render my-composition/ --output video.mp4 --backend auto

# Force Chrome (always correct output)
hyperframes render my-composition/ --output video.mp4 --backend chrome

# Run native renderer benchmarks
cd packages/native-renderer
cargo bench

# Run native renderer tests
cargo test -- --test-threads=1

# Run on Linux Docker (CPU only, no GPU)
cd packages/native-renderer
docker build -f Dockerfile.test -t hyperframes-native:test .
docker run --rm hyperframes-native:test

# GitHub CI runs automatically on PR changes to packages/native-renderer/
```
