# HyperFrames Native Renderer — Technical Spec & Phase 1 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a hybrid renderer that bypasses the Chrome CDP screenshot bottleneck for supported HyperFrames compositions while preserving Chrome-perfect final output through conservative fallback to the existing Chrome renderer.

**Architecture:** Chrome extracts the layout tree once via CDP. GSAP timeline state is pre-baked or evaluated in V8, then Skia paints supported frames to GPU-backed surfaces and hardware encoders consume those frames. The CLI `auto` backend must run a support detector before native rendering and fall back to the existing Chrome pipeline whenever a composition uses browser features the native compositor cannot prove faithful yet.

**Tech Stack:** Rust, `skia-safe` (Skia bindings), `rusty_v8` (V8 engine), FFmpeg (hardware encoding), `napi-rs` (Node.js binding for integration with existing CLI/producer)

---

## 0. Parity Contract and Definition of Done

### 0.1 What "Chrome-Perfect" Means

This project does **not** claim that the Rust/Skia renderer reimplements the entire Chromium rendering engine. Skia is Chrome's 2D drawing engine, but Chrome parity also includes layout, SVG, canvas APIs, iframe rendering, font fallback, media timing, color management, compositing order, CSS edge cases, and browser-specific behavior.

The production guarantee is:

> `--backend auto` produces Chrome-perfect final video output because unsupported compositions fall back to the existing Chrome CDP renderer. Native rendering is used only when the support detector and regression proof say it is safe.

Allowed release claim:

- "HyperFrames accelerates supported compositions with a native Rust/Skia renderer while preserving Chrome-perfect output through automatic Chrome fallback."

Forbidden release claim unless every web-platform feature is natively implemented and proven:

- "The native renderer has 100% Chrome parity."
- "The native renderer replaces Chrome for every composition."
- "Skia alone makes output identical to Chrome."

### 0.2 Renderer Modes

| Mode | Required Behavior |
|---|---|
| `--backend chrome` | Always use the existing Chrome CDP renderer. This is the visual reference. |
| `--backend native` | Attempt native rendering and fail loudly if unsupported features are detected. It must not silently produce known-wrong frames. |
| `--backend auto` | Run support detection. Use native for supported compositions. Fall back to Chrome for unsupported compositions and print the exact fallback reasons. |

### 0.3 Fixture Status Labels

Every side-by-side regression result must receive exactly one status:

| Status | Meaning |
|---|---|
| `native-pass` | Native rendered successfully, no support warnings, visual metric passes threshold, and human inspection of the side-by-side artifact shows no material mismatch. |
| `native-review` | Native rendered, but PSNR/SSIM or warnings require human review before it can be counted as safe. |
| `fallback-required` | Support detector found unsupported browser features and `auto` used Chrome. This is output-correct but not a native speed win. |
| `failed` | Neither native nor fallback produced the expected artifact, or the output is visibly wrong. |

### 0.4 Definition of Done

The native renderer plan is complete only when all gates below pass from a fresh checkout:

1. **Correctness Gate:** `--backend auto` produces videos matching `--backend chrome` for the full regression fixture suite. Unsupported cases must fall back before native rendering begins.
2. **Native Coverage Gate:** The report lists which fixtures are `native-pass`, `native-review`, and `fallback-required`. The percentage of native-pass fixtures is reported honestly; it is not rounded into a "100% native" claim.
3. **Visual Proof Gate:** The regression harness emits an HTML side-by-side report with CDP video, native/auto video, poster frames, timing, support warnings, and visual metrics. At minimum it must compute poster-frame PSNR; SSIM or frame-sampled PSNR should be added before making broad parity claims.
4. **Performance Gate:** Speedup claims are generated from fresh benchmark output in the report. Claims must distinguish paint-only, native render-only, extraction+render, and full end-to-end CLI time.
5. **Fallback Gate:** The support detector explicitly rejects known unsupported surfaces and CSS features including `svg`, `canvas`, `iframe`, video until visual parity graduates, transparent roots, wrapped/grid/flex direct text layout, missing `data-composition-id` roots, animated elements without stable IDs, `backdrop-filter`, `mask-image`, unsupported `clip-path`, unsupported `filter`, unsupported background layers/repeats, and vertical writing mode.
6. **Zero-Copy Gate:** Phase 3 is not complete until the hardware path proves GPU-backed paint to encoder transfer without CPU pixel readback on at least macOS VideoToolbox. A hardware encoder subprocess alone does not satisfy zero-copy. Current double-buffered GPU rendering plus raw RGBA readback is useful acceleration work, but it remains a partial Phase 3 result until IOSurface/VideoToolbox handoff is proven.
7. **CI Gate:** CI runs native unit tests, CLI backend tests, support detection tests, and a bounded regression comparison shard. CI without GPU must exercise the CPU/FFmpeg fallback path.
8. **Docs Gate:** CLI docs and `hyperframes doctor` explain native requirements, fallback behavior, unsupported feature reasons, and how to open the side-by-side report.

### 0.5 Native Parity Scope

Native parity is scoped to the supported HyperFrames subset, not the entire web platform. A feature graduates into the supported native subset only after:

1. Extraction captures the computed Chrome state needed by Rust.
2. Rust paints or encodes it deterministically.
3. Unit tests cover the parser and painter behavior.
4. A regression fixture passes visual metrics against Chrome.
5. `--backend auto` no longer falls back for that feature.

## 1. Why This Wins Everything

### 1.1 The Physics Wall

Both HyperFrames and Remotion share the same architecture today:

```
headless Chrome → CDP screenshot → base64 → WebSocket → Node.js → FFmpeg
                  └──── 30-70ms per frame ────┘
```

No config tuning breaks through this. The CDP serialization round-trip is the ceiling. Every frame pays:

| Step | Time | Why |
|---|---|---|
| GSAP seek (page.evaluate) | 5ms | CDP round-trip for JS evaluation |
| Chrome layout + paint | 10-30ms | Full browser rendering pipeline |
| Chrome JPEG encode | 5ms | CPU-side pixel encoding |
| CDP base64 encode | 3ms | 33% size overhead serialization |
| WebSocket transfer | 2ms | IPC to Node.js process |
| Node.js base64 decode | 3ms | Deserialize back to bytes |
| FFmpeg JPEG decode | 2ms | Undo the JPEG encoding |
| FFmpeg H.264 encode | 5ms | Final video encoding |
| **Total** | **35-55ms** | **~18-28 effective fps** |

### 1.2 The Native Path

```
V8 GSAP seek → Skia GPU paint → Hardware encode (zero-copy)
└──────────── 2-7ms per frame ────────────┘
```

| Step | Time | Source |
|---|---|---|
| V8 GSAP seek (warm isolate) | 0.5ms | rusty_v8 benchmarks: 0.39ms/eval reused isolate |
| Skia GPU paint (1080p) | 1-4ms | OBS: 1-4ms/frame at 1080p60, Flutter: <8.3ms for 120fps |
| GPU texture → hardware encode | 0.5-2ms | OBS NVENC: zero-copy via shared texture handles |
| **Total** | **2-6.5ms** | **~150-500 effective fps** |

### 1.3 Competitive Comparison

| Metric | Remotion | HyperFrames (current) | HyperFrames Native | Source |
|---|---|---|---|---|
| 30s video @30fps | 60-180s | ~40s | **~4s** | Benchmarked / projected |
| Per-frame capture | 20-50ms | 14-40ms | **2-7ms** | CDP overhead eliminated |
| Parallelism ceiling | 32-64 cores | ~8 workers | **GPU cores (thousands)** | Remotion GH#4949 |
| Memory per worker | ~256MB (Chrome) | ~256MB | **~50MB (Skia context)** | No browser overhead |
| Hardware encode | Optional, CPU fallback | Optional | **Default, zero-copy** | GPU texture direct |
| HDR support | None | Layered compositing | **Native 10-bit pipeline** | No sRGB browser clamp |
| Can they copy this? | No (married to React+Chrome) | N/A | **Moat** | Architectural lock-in |

### 1.4 Why Remotion Can't Follow

Remotion's architecture is React components rendered in Chrome. Their entire ecosystem — the component library, the `useCurrentFrame()` hook, the `<Sequence>` abstraction — depends on React's reconciler running inside a real browser DOM. They cannot switch to Skia without rewriting every user composition and abandoning their React-based API.

HyperFrames' HTML+GSAP compositions have a much thinner browser dependency: the `window.__hf.seek(t)` protocol just needs GSAP timeline evaluation and CSS property computation. Neither requires a DOM.

---

## 2. Architecture

### 2.1 Three-Phase Pipeline

```
Phase 1: Scene Extraction (one-time, ~50ms)
  Chrome → CDP DOM.getDocument + CSS.getComputedStyle + DOM.getBoxModel
  → JSON scene graph: { elements, positions, sizes, styles, fonts, images, videos }

Phase 2: Animation Evaluation (per-frame, ~0.5ms)
  V8 isolate + GSAP → timeline.seek(t)
  → property deltas: { elementId → { transform, opacity, clipPath, ... } }

Phase 3: Paint + Encode (per-frame, ~2-5ms)
  Skia GPU canvas + property deltas → GPU texture
  → Hardware encoder → H.264/H.265 bitstream
  → FFmpeg mux with audio → final MP4
```

### 2.2 Component Architecture

```
packages/native-renderer/
├── Cargo.toml                    # Rust workspace member
├── src/
│   ├── lib.rs                    # Library root, NAPI exports
│   ├── scene/
│   │   ├── mod.rs                # Scene graph types
│   │   ├── extract.rs            # Chrome CDP → scene graph
│   │   └── parse.rs              # JSON scene → Rust types
│   ├── animation/
│   │   ├── mod.rs                # Animation evaluation
│   │   ├── v8_runtime.rs         # V8 isolate + GSAP loader
│   │   └── timeline.rs           # Pre-baked timeline cache
│   ├── paint/
│   │   ├── mod.rs                # Skia painting coordinator
│   │   ├── canvas.rs             # Skia surface + GPU context setup
│   │   ├── elements.rs           # CSS property → Skia draw call mapping
│   │   ├── text.rs               # Text rendering (Skia + HarfBuzz)
│   │   ├── effects.rs            # Shadows, blur, gradients, filters
│   │   └── video.rs              # Video frame compositing
│   ├── encode/
│   │   ├── mod.rs                # Encoder orchestration
│   │   ├── videotoolbox.rs       # macOS hardware encode
│   │   ├── nvenc.rs              # NVIDIA hardware encode
│   │   ├── vaapi.rs              # Linux Intel/AMD hardware encode
│   │   └── ffmpeg_fallback.rs    # CPU encode via FFmpeg pipe
│   └── pipeline.rs               # End-to-end render pipeline
├── napi/
│   └── index.rs                  # napi-rs bindings for Node.js integration
└── tests/
    ├── scene_test.rs
    ├── paint_test.rs
    └── pipeline_test.rs
```

### 2.3 Integration with Existing Stack

The native renderer slots into the existing producer as an alternative capture+encode backend:

```
                    ┌─────────────────────────┐
                    │   renderOrchestrator.ts  │
                    │   (existing producer)    │
                    └────────┬────────────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌─────────────┐  ┌────────────┐  ┌──────────────┐
    │Chrome Engine │  │ WebCodecs  │  │Native Render │ ← NEW
    │(CDP capture) │  │(browser)   │  │(Rust/Skia)   │
    └─────────────┘  └────────────┘  └──────────────┘
```

The CLI flag `hyperframes render --backend native` selects the native renderer directly and should fail loudly when unsupported features are detected. The CLI flag `hyperframes render --backend auto` is the production path: it selects native only for supported compositions and falls back to Chrome with explicit reasons for unsupported CSS, DOM, media, or embedded browser surfaces.

### 2.4 Patterns Learned from Professional Tools

| Pattern | Source | How We Use It |
|---|---|---|
| GPU-direct encoding via shared texture handles | OBS (`output_gpu_encoders`) | Skia GPU surface → NVENC/VideoToolbox without CPU readback |
| Double-buffered staging surfaces | OBS (`NUM_TEXTURES = 2`) | Paint frame N while encoding frame N-1 |
| Backend-agnostic graphics abstraction | OBS (`gs_exports` vtable) | Skia's built-in Metal/Vulkan/GL backends |
| Glyph atlas texture caching | OBS (FreeType → GPU atlas), GPU text renderers | Skia's glyph cache (automatic) |
| Pull-based evaluation with ROI | Nuke (demand-driven row model) | Only re-paint elements whose properties changed |
| Full-frame GPU compositing | Blender 4.2 compositor | Process entire frame on GPU, not tiles |
| Tick/Render separation | OBS (`tick_sources` → `render_main_texture`) | V8 evaluate → Skia paint (separate phases) |
| Node-graph GPU pipeline | DaVinci Fusion | Intermediate results stay in VRAM between effects |
| Pre-baked animation data | Standard in game engines | Optional: evaluate GSAP once, store all values in Rust Vec |

---

## 3. Theoretical Performance Model

### 3.1 Per-Frame Budget at 1080p (1920x1080)

| Component | Chrome CDP (current) | Native Renderer | Speedup |
|---|---|---|---|
| Animation eval | 5ms (CDP evaluate) | 0.5ms (V8 isolate) | 10x |
| Layout | 0ms (unchanged) | 0ms (static) | — |
| Paint | 15-30ms (Chrome paint + screenshot) | 1-4ms (Skia GPU) | 7-15x |
| Frame transfer | 8ms (base64 + WebSocket) | 0ms (stays on GPU) | ∞ |
| Encode | 5ms (FFmpeg CPU) | 0.5-2ms (hardware) | 3-10x |
| **Total** | **33-48ms** | **2-6.5ms** | **5-24x** |

### 3.2 End-to-End Render Time Projection

For a 30-second composition at 30fps (900 frames):

| Scenario | Chrome CDP | Native Renderer | Speedup |
|---|---|---|---|
| Simple (text + shapes) | 30s | 2-3s | 10-15x |
| Medium (images + transforms) | 45s | 4-6s | 8-11x |
| Complex (video + effects + text) | 90s | 8-12s | 8-11x |
| Remotion equivalent | 60-180s | 4-12s | **15-45x** |

### 3.3 Scaling Properties

| Dimension | Chrome CDP | Native Renderer |
|---|---|---|
| Resolution scaling | Quadratic (more pixels = slower screenshot + encode) | Sub-linear (GPU parallelism scales with pixel count) |
| Element count | Linear (more DOM = slower paint) | Sub-linear (Skia batches draw calls, Graphite sorts by pipeline) |
| Worker scaling | Diminishing >8 workers (CDP contention) | Linear with GPU cores (thousands of CUDA/Metal cores) |
| Memory per session | ~256MB (full Chrome process) | ~50MB (Skia context + V8 isolate) |

---

## 4. Technology Decisions

### 4.1 Skia over Vello/WebRender/Custom

| Criterion | Skia | Vello | WebRender | Custom |
|---|---|---|---|---|
| CSS feature coverage | Strong 2D drawing coverage; not a full browser renderer | Missing blur, shadows, glyph cache | Oriented toward web display lists | Must implement everything |
| Production proven | Chrome, Android, Flutter | Alpha | Servo, Firefox | — |
| GPU backends | Metal, Vulkan, GL, D3D, Graphite | wgpu (Metal/Vulkan/D3D12) | GL only | — |
| Text rendering | HarfBuzz + built-in shaping | Swash (less mature) | HarfBuzz | Must integrate |
| Rust bindings | `skia-safe` (mature, v0.93+) | Native Rust | Rust native | — |
| Community | Google-backed, massive | Small (linebender) | Mozilla/Igalia | — |

**Decision: Skia.** It gives us the same 2D raster/compositing foundation Chrome uses, which makes high-fidelity native output realistic for a constrained HyperFrames subset. It does not provide browser layout, SVG/canvas/iframe semantics, or every Chromium paint/compositing edge case by itself, so unsupported browser features must continue to trigger Chrome fallback. The `skia-safe` crate exposes the core API, and Graphite (Chrome M133+) adds multi-threaded recording and modern GPU batching.

### 4.2 V8 over QuickJS/Boa/Pre-bake

| Criterion | V8 (rusty_v8) | QuickJS | Boa | Pre-bake |
|---|---|---|---|---|
| GSAP compatibility | Perfect (Chrome's engine) | Good but edge cases | Partial ES2023 | Perfect (one-time eval) |
| Per-frame eval speed | 0.39ms (warm isolate) | 1-3ms | 5-10ms | 0ms (lookup table) |
| Startup cost | 5ms cold, <1ms snapshot | <1ms | <1ms | Pre-compute phase |
| Maintenance burden | Deno-maintained | Low | Low | Must re-bake on change |

**Decision: V8 for Phase 2, pre-bake as Phase 3 optimization.** V8 guarantees GSAP behaves identically to Chrome. Pre-baking (evaluate timeline once, store all property values in a Rust lookup table) eliminates JS overhead entirely but requires a pre-compute step.

### 4.3 Hardware Encoding Strategy

| Platform | Encoder | Zero-Copy Path | Fallback |
|---|---|---|---|
| macOS (Apple Silicon) | VideoToolbox | Skia Metal → IOSurface → VTCompressionSession | FFmpeg libx264 pipe |
| Linux NVIDIA | NVENC | Skia Vulkan → CUDA interop → NvEncRegisterResource | FFmpeg libx264 pipe |
| Linux Intel | QSV/VAAPI | Skia Vulkan → DRM PRIME fd → VAAPI | FFmpeg libx264 pipe |
| Docker/CI (no GPU) | — | — | FFmpeg libx264 pipe |

**Phase 1 uses FFmpeg pipe (simplest).** Phase 3 adds zero-copy paths per platform.

---

## 5. CSS Property Coverage Plan

### 5.1 Tier 1 — Covers 90% of Compositions (Phase 1)

These properties are used in virtually every HyperFrames composition:

| CSS Property | Skia Equivalent | Complexity |
|---|---|---|
| `transform: translate/rotate/scale` | `Canvas::concat` (3x3 matrix) | Trivial |
| `opacity` | `Paint::set_alpha` or `Canvas::save_layer_alpha` | Trivial |
| `background-color` | `Canvas::draw_rect` + `Paint::set_color` | Trivial |
| `border-radius` | `Canvas::draw_rrect` / `Canvas::clip_rrect` | Simple |
| `overflow: hidden` | `Canvas::clip_rect` / `Canvas::clip_rrect` | Simple |
| `width/height/position` | Layout from Chrome extraction | Pre-computed |
| `color` (text) | `Paint::set_color` on text | Trivial |
| `font-family/size/weight` | `skia_safe::Font` + `Typeface` | Simple |
| `visibility/display` | Skip element in draw | Trivial |

### 5.2 Tier 2 — Full Visual Fidelity (Phase 2)

| CSS Property | Skia Equivalent | Complexity |
|---|---|---|
| `box-shadow` | `Paint::set_mask_filter(MaskFilter::blur)` + offset draw | Medium |
| `filter: blur()` | `Paint::set_image_filter(ImageFilter::blur)` | Simple |
| `filter: brightness/contrast/saturate` | `Paint::set_color_filter(ColorFilter::matrix)` | Medium |
| `background: linear-gradient()` | `Shader::linear_gradient` | Medium |
| `background: radial-gradient()` | `Shader::radial_gradient` | Medium |
| `clip-path: polygon/circle/ellipse` | `Canvas::clip_path` with `Path` | Medium |
| `border` (solid/dashed) | `Canvas::draw_rrect` with `Paint::set_stroke` | Simple |
| `background-image: url()` | `Canvas::draw_image_rect` | Simple |
| `object-fit/object-position` | Computed source/dest rects for `draw_image_rect` | Medium |
| `mix-blend-mode` | `Paint::set_blend_mode` (Porter-Duff) | Simple |

### 5.3 Tier 3 — Edge Cases (Phase 3+)

| CSS Property | Approach |
|---|---|
| `backdrop-filter` | Render-to-texture + apply filter to region behind element |
| `mask-image` | Skia `MaskFilter` with image shader |
| `text-shadow` | Draw text twice: shadow (blurred, offset) then foreground |
| `-webkit-text-stroke` | `Paint::set_style(Stroke)` on text |
| `writing-mode: vertical` | `Paragraph` layout direction |
| CSS custom properties | Resolve during scene extraction |

### 5.4 Unsupported → Chrome Fallback

For any composition using properties not in Tier 1-3, the renderer falls back to the existing Chrome CDP pipeline. The CLI reports which properties triggered the fallback so users can optimize their compositions for native rendering.

---

## 6. Phase Plan

### Phase 1: Prove the Hypothesis (4-6 weeks, 1 engineer)

**Deliverable:** `hyperframes render --backend native` works on static compositions (no GSAP animation). Renders 10-50x faster than Chrome CDP on supported compositions.

**Scope:**
- Rust crate `@hyperframes/native-renderer`
- Chrome CDP extracts scene graph (one-shot)
- Skia paints static frames (Tier 1 CSS properties)
- FFmpeg pipe encodes (no hardware encode yet)
- Node.js integration via napi-rs
- Benchmark: side-by-side comparison on 5 test fixtures

### Phase 2: Animation + Full CSS (4-6 weeks, 1-2 engineers)

**Deliverable:** Animated compositions render natively. Full CSS Tier 1+2 coverage.

**Scope:**
- V8 isolate evaluates GSAP timeline per-frame
- Tier 2 CSS properties (shadows, blur, gradients, clip-path)
- Video frame compositing (FFmpeg extraction → Skia image overlay)
- Text rendering with font matching (Skia + HarfBuzz)
- Delta-only repaint (only re-render elements whose properties changed)

### Phase 3: Zero-Copy Hardware Encode (3-4 weeks, 1 engineer)

**Deliverable:** End-to-end GPU pipeline with no CPU pixel readback on at least one platform, with benchmark output separating paint-only, render-only, and full CLI speedups.

**Scope:**
- macOS: Skia Metal → IOSurface → VideoToolbox
- Linux: Skia Vulkan → CUDA interop → NVENC
- Double-buffered staging (paint N while encoding N-1)
- Pre-bake mode: evaluate GSAP once, store all frames' properties in Rust

### Phase 4: Hybrid Production Hardening (2-3 weeks)

**Deliverable:** Ship `--backend auto` as the output-safe production renderer: native acceleration for supported compositions, Chrome fallback for unsupported compositions, and proof artifacts that show the boundary.

**Scope:**
- Fallback detection (unsupported CSS → Chrome)
- Regression test parity (PSNR comparison against Chrome output)
- CI integration (Docker with no GPU → FFmpeg fallback)
- CLI documentation, `hyperframes doctor` checks for native renderer deps
- Side-by-side HTML report with CDP/native videos, poster frames, timing, PSNR/SSIM, and fallback reasons
- Release notes that use the allowed hybrid claim from Section 0.1

---

## 7. Phase 1 Implementation Plan

### Task 1: Rust Crate Scaffolding

**Files:**
- Create: `packages/native-renderer/Cargo.toml`
- Create: `packages/native-renderer/src/lib.rs`
- Create: `packages/native-renderer/src/scene/mod.rs`
- Create: `packages/native-renderer/src/scene/parse.rs`

- [ ] **Step 1: Initialize Cargo project**

```bash
cd packages && mkdir native-renderer && cd native-renderer
cargo init --lib
```

Add to `Cargo.toml`:
```toml
[package]
name = "hyperframes-native-renderer"
version = "0.1.0"
edition = "2021"

[dependencies]
skia-safe = { version = "0.93", features = ["textlayout"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
insta = "1"  # snapshot testing
```

- [ ] **Step 2: Define scene graph types**

Create `src/scene/mod.rs`:
```rust
pub mod parse;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Scene {
    pub width: f32,
    pub height: f32,
    pub elements: Vec<Element>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Element {
    pub id: String,
    pub kind: ElementKind,
    pub bounds: Rect,
    pub style: Style,
    pub children: Vec<Element>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ElementKind {
    Container,
    Text { content: String },
    Image { src: String },
    Video { src: String },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Style {
    pub background_color: Option<Color>,
    pub opacity: f32,
    pub border_radius: [f32; 4],
    pub overflow_hidden: bool,
    pub transform: Option<Transform2D>,
    pub visibility: bool,
    pub font_family: Option<String>,
    pub font_size: Option<f32>,
    pub font_weight: Option<u16>,
    pub color: Option<Color>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Transform2D {
    pub translate_x: f32,
    pub translate_y: f32,
    pub scale_x: f32,
    pub scale_y: f32,
    pub rotate_deg: f32,
}
```

- [ ] **Step 3: Add JSON scene parser**

Create `src/scene/parse.rs`:
```rust
use super::Scene;
use std::path::Path;

pub fn parse_scene_file(path: &Path) -> Result<Scene, String> {
    let content = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read scene file: {e}"))?;
    parse_scene_json(&content)
}

pub fn parse_scene_json(json: &str) -> Result<Scene, String> {
    serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse scene JSON: {e}"))
}
```

- [ ] **Step 4: Write test for JSON parsing**

Create `tests/scene_test.rs`:
```rust
use hyperframes_native_renderer::scene::{parse::parse_scene_json, Scene, Element, ElementKind, Rect, Style, Color};

#[test]
fn parse_minimal_scene() {
    let json = r#"{
        "width": 1920,
        "height": 1080,
        "elements": [{
            "id": "bg",
            "kind": "Container",
            "bounds": { "x": 0, "y": 0, "width": 1920, "height": 1080 },
            "style": {
                "background_color": { "r": 30, "g": 30, "b": 30, "a": 255 },
                "opacity": 1.0,
                "border_radius": [0, 0, 0, 0],
                "overflow_hidden": false,
                "transform": null,
                "visibility": true
            },
            "children": []
        }]
    }"#;

    let scene = parse_scene_json(json).unwrap();
    assert_eq!(scene.width, 1920.0);
    assert_eq!(scene.height, 1080.0);
    assert_eq!(scene.elements.len(), 1);
    assert_eq!(scene.elements[0].id, "bg");
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cargo test -p hyperframes-native-renderer
```
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/native-renderer/
git commit -m "feat(native-renderer): scaffold Rust crate with scene graph types"
```

---

### Task 2: Skia GPU Surface Setup

**Files:**
- Create: `packages/native-renderer/src/paint/mod.rs`
- Create: `packages/native-renderer/src/paint/canvas.rs`

- [ ] **Step 1: Add Skia feature flags to Cargo.toml**

Update `Cargo.toml` dependencies:
```toml
[dependencies]
skia-safe = { version = "0.93", features = ["textlayout", "gpu"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Create GPU surface factory**

Create `src/paint/canvas.rs`:
```rust
use skia_safe::{
    surfaces, Color4f, ColorType, ImageInfo, Surface,
};

pub struct RenderSurface {
    surface: Surface,
}

impl RenderSurface {
    /// Create a CPU-backed raster surface (Phase 1 — GPU in Phase 3).
    pub fn new_raster(width: i32, height: i32) -> Result<Self, String> {
        let surface = surfaces::raster_n32_premul((width, height))
            .ok_or("Failed to create Skia raster surface")?;
        Ok(Self { surface })
    }

    pub fn canvas(&mut self) -> &skia_safe::Canvas {
        self.surface.canvas()
    }

    /// Read back rendered pixels as RGBA bytes.
    pub fn read_pixels_rgba(&mut self) -> Option<Vec<u8>> {
        let info = ImageInfo::new(
            self.surface.width_height(),
            ColorType::RGBA8888,
            skia_safe::AlphaType::Premul,
            None,
        );
        let row_bytes = info.width() as usize * 4;
        let mut pixels = vec![0u8; row_bytes * info.height() as usize];
        let success = self.surface.read_pixels(
            &info,
            &mut pixels,
            row_bytes,
            skia_safe::IPoint::new(0, 0),
        );
        if success { Some(pixels) } else { None }
    }

    /// Encode the surface to JPEG bytes.
    pub fn encode_jpeg(&mut self, quality: u32) -> Option<Vec<u8>> {
        let image = self.surface.image_snapshot();
        let data = image.encode(None, skia_safe::EncodedImageFormat::JPEG, quality)?;
        Some(data.as_bytes().to_vec())
    }

    /// Encode the surface to PNG bytes.
    pub fn encode_png(&mut self) -> Option<Vec<u8>> {
        let image = self.surface.image_snapshot();
        let data = image.encode(None, skia_safe::EncodedImageFormat::PNG, 100)?;
        Some(data.as_bytes().to_vec())
    }

    pub fn clear(&mut self, color: Color4f) {
        self.surface.canvas().clear(color);
    }

    pub fn width(&self) -> i32 {
        self.surface.width()
    }

    pub fn height(&self) -> i32 {
        self.surface.height()
    }
}
```

Create `src/paint/mod.rs`:
```rust
pub mod canvas;
```

- [ ] **Step 3: Write test: create surface, clear, read pixels**

Add to `tests/paint_test.rs`:
```rust
use hyperframes_native_renderer::paint::canvas::RenderSurface;
use skia_safe::Color4f;

#[test]
fn create_surface_and_clear_red() {
    let mut surface = RenderSurface::new_raster(100, 100).unwrap();
    surface.clear(Color4f::new(1.0, 0.0, 0.0, 1.0)); // red

    let pixels = surface.read_pixels_rgba().unwrap();
    assert_eq!(pixels.len(), 100 * 100 * 4);
    // First pixel should be red (RGBA)
    assert_eq!(pixels[0], 255); // R
    assert_eq!(pixels[1], 0);   // G
    assert_eq!(pixels[2], 0);   // B
    assert_eq!(pixels[3], 255); // A
}

#[test]
fn encode_jpeg_produces_bytes() {
    let mut surface = RenderSurface::new_raster(100, 100).unwrap();
    surface.clear(Color4f::new(0.0, 0.0, 1.0, 1.0)); // blue

    let jpeg = surface.encode_jpeg(80).unwrap();
    // JPEG magic bytes: FF D8 FF
    assert_eq!(jpeg[0], 0xFF);
    assert_eq!(jpeg[1], 0xD8);
    assert!(jpeg.len() > 100); // should be a valid image
}
```

- [ ] **Step 4: Run tests**

```bash
cargo test -p hyperframes-native-renderer
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/native-renderer/src/paint/
git add packages/native-renderer/tests/paint_test.rs
git commit -m "feat(native-renderer): Skia surface creation and pixel readback"
```

---

### Task 3: Element Painting — Rects, RoundRects, Transforms, Opacity

**Files:**
- Create: `packages/native-renderer/src/paint/elements.rs`
- Modify: `packages/native-renderer/src/paint/mod.rs`

- [ ] **Step 1: Implement element painter**

Create `src/paint/elements.rs`:
```rust
use skia_safe::{
    Canvas, Color4f, Paint, RRect, Rect as SkRect, Matrix,
    paint::Style as PaintStyle, ClipOp,
};
use crate::scene::{Element, ElementKind, Rect, Style, Color, Transform2D};

pub fn paint_element(canvas: &Canvas, element: &Element) {
    if !element.style.visibility {
        return;
    }

    let save_count = canvas.save();

    apply_transform(canvas, &element.style, &element.bounds);
    apply_opacity_layer(canvas, &element.style);

    let sk_rect = to_sk_rect(&element.bounds);

    // Clip to bounds if overflow hidden
    if element.style.overflow_hidden {
        let clip = make_rrect(&sk_rect, &element.style.border_radius);
        canvas.clip_rrect(clip, ClipOp::Intersect, true);
    }

    // Paint background
    if let Some(bg) = &element.style.background_color {
        let mut paint = Paint::default();
        paint.set_anti_alias(true);
        paint.set_color4f(to_color4f(bg), None);
        paint.set_style(PaintStyle::Fill);

        if element.style.border_radius.iter().any(|r| *r > 0.0) {
            let rrect = make_rrect(&sk_rect, &element.style.border_radius);
            canvas.draw_rrect(rrect, &paint);
        } else {
            canvas.draw_rect(sk_rect, &paint);
        }
    }

    // Paint text
    if let ElementKind::Text { ref content } = element.kind {
        paint_text(canvas, element, content);
    }

    // Recurse into children
    for child in &element.children {
        paint_element(canvas, child);
    }

    canvas.restore_to_count(save_count);
}

fn apply_transform(canvas: &Canvas, style: &Style, bounds: &Rect) {
    // Position the element
    canvas.translate((bounds.x, bounds.y));

    if let Some(t) = &style.transform {
        // Transform origin is center of element
        let cx = bounds.width / 2.0;
        let cy = bounds.height / 2.0;
        canvas.translate((cx, cy));

        if t.rotate_deg != 0.0 {
            canvas.rotate(t.rotate_deg, None);
        }
        if t.scale_x != 1.0 || t.scale_y != 1.0 {
            canvas.scale((t.scale_x, t.scale_y));
        }

        canvas.translate((-cx, -cy));
        canvas.translate((t.translate_x, t.translate_y));
    }
}

fn apply_opacity_layer(canvas: &Canvas, style: &Style) {
    if style.opacity < 1.0 {
        let alpha = (style.opacity * 255.0).round() as u8;
        canvas.save_layer_alpha(None, alpha as u32);
    }
}

fn paint_text(canvas: &Canvas, element: &Element, content: &str) {
    let font_size = element.style.font_size.unwrap_or(16.0);
    let typeface = skia_safe::Typeface::default();
    let font = skia_safe::Font::new(typeface, font_size);

    let mut paint = Paint::default();
    paint.set_anti_alias(true);
    if let Some(color) = &element.style.color {
        paint.set_color4f(to_color4f(color), None);
    } else {
        paint.set_color4f(Color4f::new(1.0, 1.0, 1.0, 1.0), None);
    }

    // Draw at element origin + font ascent (baseline)
    let (_, metrics) = font.metrics();
    let y = -metrics.ascent;
    canvas.draw_str(content, (0.0, y), &font, &paint);
}

fn to_sk_rect(r: &Rect) -> SkRect {
    SkRect::from_xywh(0.0, 0.0, r.width, r.height)
}

fn make_rrect(rect: &SkRect, radii: &[f32; 4]) -> RRect {
    let mut rrect = RRect::new();
    rrect.set_rect_radii(
        *rect,
        &[
            (radii[0], radii[0]).into(), // top-left
            (radii[1], radii[1]).into(), // top-right
            (radii[2], radii[2]).into(), // bottom-right
            (radii[3], radii[3]).into(), // bottom-left
        ],
    );
    rrect
}

fn to_color4f(c: &Color) -> Color4f {
    Color4f::new(
        c.r as f32 / 255.0,
        c.g as f32 / 255.0,
        c.b as f32 / 255.0,
        c.a as f32 / 255.0,
    )
}
```

- [ ] **Step 2: Write test: paint a scene with nested elements**

Add to `tests/paint_test.rs`:
```rust
use hyperframes_native_renderer::scene::{Scene, Element, ElementKind, Rect, Style, Color};
use hyperframes_native_renderer::paint::{canvas::RenderSurface, elements::paint_element};
use skia_safe::Color4f;

#[test]
fn paint_scene_with_background_and_text() {
    let scene = Scene {
        width: 200.0,
        height: 200.0,
        elements: vec![Element {
            id: "bg".into(),
            kind: ElementKind::Container,
            bounds: Rect { x: 0.0, y: 0.0, width: 200.0, height: 200.0 },
            style: Style {
                background_color: Some(Color { r: 0, g: 0, b: 255, a: 255 }),
                opacity: 1.0,
                visibility: true,
                ..Default::default()
            },
            children: vec![Element {
                id: "title".into(),
                kind: ElementKind::Text { content: "Hello".into() },
                bounds: Rect { x: 10.0, y: 10.0, width: 180.0, height: 40.0 },
                style: Style {
                    color: Some(Color { r: 255, g: 255, b: 255, a: 255 }),
                    font_size: Some(24.0),
                    opacity: 1.0,
                    visibility: true,
                    ..Default::default()
                },
                children: vec![],
            }],
        }],
    };

    let mut surface = RenderSurface::new_raster(200, 200).unwrap();
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));

    for element in &scene.elements {
        paint_element(surface.canvas(), element);
    }

    let jpeg = surface.encode_jpeg(90).unwrap();
    assert!(jpeg.len() > 200); // valid JPEG with content
}

#[test]
fn paint_element_with_border_radius_and_opacity() {
    let element = Element {
        id: "card".into(),
        kind: ElementKind::Container,
        bounds: Rect { x: 20.0, y: 20.0, width: 160.0, height: 100.0 },
        style: Style {
            background_color: Some(Color { r: 255, g: 0, b: 0, a: 255 }),
            opacity: 0.5,
            border_radius: [12.0, 12.0, 12.0, 12.0],
            overflow_hidden: true,
            visibility: true,
            ..Default::default()
        },
        children: vec![],
    };

    let mut surface = RenderSurface::new_raster(200, 200).unwrap();
    surface.clear(Color4f::new(1.0, 1.0, 1.0, 1.0)); // white bg

    paint_element(surface.canvas(), &element);

    let pixels = surface.read_pixels_rgba().unwrap();
    // Corner pixel (0,0) should be white (not affected by rounded rect)
    assert_eq!(pixels[0], 255); // R = white
    // Center pixel (100, 70) should be blended red on white
    let center_idx = (70 * 200 + 100) * 4;
    assert!(pixels[center_idx] > 200); // R channel high (red blended with white at 50%)
}
```

- [ ] **Step 3: Run tests**

```bash
cargo test -p hyperframes-native-renderer
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/native-renderer/src/paint/elements.rs
git add packages/native-renderer/tests/paint_test.rs
git commit -m "feat(native-renderer): element painting with transforms, opacity, border-radius"
```

---

### Task 4: Scene Extraction from Chrome via CDP

**Files:**
- Create: `packages/native-renderer/src/scene/extract.ts` (TypeScript, runs in Node.js)
- Create: `packages/native-renderer/src/scene/extract.test.ts`

This task creates the bridge: Chrome renders the composition, we extract the layout tree as JSON, then feed it to the Rust renderer.

- [ ] **Step 1: Create the CDP scene extractor**

Create `packages/native-renderer/src/scene/extract.ts`:
```typescript
import type { Page } from "puppeteer-core";

export interface ExtractedScene {
  width: number;
  height: number;
  elements: ExtractedElement[];
}

export interface ExtractedElement {
  id: string;
  kind: "Container" | { Text: { content: string } } | { Image: { src: string } } | { Video: { src: string } };
  bounds: { x: number; y: number; width: number; height: number };
  style: {
    background_color: { r: number; g: number; b: number; a: number } | null;
    opacity: number;
    border_radius: [number, number, number, number];
    overflow_hidden: boolean;
    transform: { translate_x: number; translate_y: number; scale_x: number; scale_y: number; rotate_deg: number } | null;
    visibility: boolean;
    font_family: string | null;
    font_size: number | null;
    font_weight: number | null;
    color: { r: number; g: number; b: number; a: number } | null;
  };
  children: ExtractedElement[];
}

export async function extractScene(
  page: Page,
  width: number,
  height: number,
): Promise<ExtractedScene> {
  const elements = await page.evaluate(() => {
    function extractElement(el: HTMLElement): any {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const tag = el.tagName.toLowerCase();

      let kind: any = "Container";
      if (tag === "video") kind = { Video: { src: el.getAttribute("src") || "" } };
      else if (tag === "img") kind = { Image: { src: (el as HTMLImageElement).src } };
      else if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
        kind = { Text: { content: el.textContent || "" } };
      }

      const parseColor = (c: string) => {
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
        if (!m) return null;
        return { r: +m[1], g: +m[2], b: +m[3], a: Math.round((m[4] !== undefined ? +m[4] : 1) * 255) };
      };

      const br = [
        parseFloat(cs.borderTopLeftRadius) || 0,
        parseFloat(cs.borderTopRightRadius) || 0,
        parseFloat(cs.borderBottomRightRadius) || 0,
        parseFloat(cs.borderBottomLeftRadius) || 0,
      ] as [number, number, number, number];

      const children: any[] = [];
      for (const child of el.children) {
        if (child instanceof HTMLElement) {
          children.push(extractElement(child));
        }
      }

      return {
        id: el.id || el.getAttribute("data-name") || `anon-${Math.random().toString(36).slice(2, 8)}`,
        kind,
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        style: {
          background_color: parseColor(cs.backgroundColor),
          opacity: parseFloat(cs.opacity) || 1,
          border_radius: br,
          overflow_hidden: cs.overflow === "hidden",
          transform: null, // GSAP will provide this per-frame in Phase 2
          visibility: cs.visibility !== "hidden" && cs.display !== "none",
          font_family: cs.fontFamily || null,
          font_size: parseFloat(cs.fontSize) || null,
          font_weight: parseInt(cs.fontWeight) || null,
          color: parseColor(cs.color),
        },
        children,
      };
    }

    const root = document.querySelector("[data-composition-id]") || document.body;
    return Array.from(root.children)
      .filter((c): c is HTMLElement => c instanceof HTMLElement)
      .map(extractElement);
  });

  return { width, height, elements };
}
```

- [ ] **Step 2: Write test**

Create `packages/native-renderer/src/scene/extract.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import type { ExtractedScene, ExtractedElement } from "./extract";

describe("ExtractedScene types", () => {
  it("round-trips through JSON", () => {
    const scene: ExtractedScene = {
      width: 1920,
      height: 1080,
      elements: [{
        id: "bg",
        kind: "Container",
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
        style: {
          background_color: { r: 30, g: 30, b: 30, a: 255 },
          opacity: 1,
          border_radius: [0, 0, 0, 0],
          overflow_hidden: false,
          transform: null,
          visibility: true,
          font_family: null,
          font_size: null,
          font_weight: null,
          color: null,
        },
        children: [],
      }],
    };
    const json = JSON.stringify(scene);
    const parsed = JSON.parse(json) as ExtractedScene;
    expect(parsed.elements[0].id).toBe("bg");
    expect(parsed.elements[0].style.background_color?.r).toBe(30);
  });
});
```

- [ ] **Step 3: Run test**

```bash
bunx vitest run packages/native-renderer/src/scene/extract.test.ts
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/native-renderer/src/scene/
git commit -m "feat(native-renderer): CDP scene extraction from Chrome"
```

---

### Task 5: Render Pipeline — Scene JSON to Video Frames

**Files:**
- Create: `packages/native-renderer/src/pipeline.rs`
- Modify: `packages/native-renderer/src/lib.rs`

- [ ] **Step 1: Implement the render pipeline**

Create `src/pipeline.rs`:
```rust
use crate::scene::Scene;
use crate::paint::canvas::RenderSurface;
use crate::paint::elements::paint_element;
use skia_safe::Color4f;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};

pub struct RenderConfig {
    pub fps: u32,
    pub duration_secs: f64,
    pub quality: u32,
    pub output_path: String,
}

pub struct RenderResult {
    pub total_frames: u32,
    pub total_ms: u64,
    pub avg_paint_ms: f64,
    pub output_path: String,
}

/// Render a static scene (no animation) to a video file via FFmpeg pipe.
pub fn render_static(scene: &Scene, config: &RenderConfig) -> Result<RenderResult, String> {
    let total_frames = (config.fps as f64 * config.duration_secs).ceil() as u32;
    let width = scene.width as i32;
    let height = scene.height as i32;

    let mut surface = RenderSurface::new_raster(width, height)?;

    // Paint the static frame once
    surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
    for element in &scene.elements {
        paint_element(surface.canvas(), element);
    }

    let frame_jpeg = surface.encode_jpeg(config.quality)
        .ok_or("Failed to encode frame as JPEG")?;

    // Spawn FFmpeg with image2pipe input
    let mut ffmpeg = Command::new("ffmpeg")
        .args([
            "-y",
            "-f", "image2pipe",
            "-vcodec", "mjpeg",
            "-framerate", &config.fps.to_string(),
            "-i", "-",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-pix_fmt", "yuv420p",
            "-threads", "0",
            &config.output_path,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn FFmpeg: {e}"))?;

    let start = std::time::Instant::now();
    let stdin = ffmpeg.stdin.as_mut().ok_or("Failed to open FFmpeg stdin")?;

    // Write the same frame N times (static scene)
    for _ in 0..total_frames {
        stdin.write_all(&frame_jpeg)
            .map_err(|e| format!("Failed to write frame to FFmpeg: {e}"))?;
    }

    drop(ffmpeg.stdin.take());
    let output = ffmpeg.wait_with_output()
        .map_err(|e| format!("FFmpeg failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg exited with error: {stderr}"));
    }

    let total_ms = start.elapsed().as_millis() as u64;

    Ok(RenderResult {
        total_frames,
        total_ms,
        avg_paint_ms: 0.0, // static: painted once
        output_path: config.output_path.clone(),
    })
}
```

Update `src/lib.rs`:
```rust
pub mod scene;
pub mod paint;
pub mod pipeline;
```

- [ ] **Step 2: Write integration test**

Create `tests/pipeline_test.rs`:
```rust
use hyperframes_native_renderer::scene::{Scene, Element, ElementKind, Rect, Style, Color};
use hyperframes_native_renderer::pipeline::{render_static, RenderConfig};
use std::path::Path;

#[test]
fn render_static_scene_to_mp4() {
    let scene = Scene {
        width: 640.0,
        height: 360.0,
        elements: vec![
            Element {
                id: "bg".into(),
                kind: ElementKind::Container,
                bounds: Rect { x: 0.0, y: 0.0, width: 640.0, height: 360.0 },
                style: Style {
                    background_color: Some(Color { r: 20, g: 20, b: 40, a: 255 }),
                    opacity: 1.0,
                    visibility: true,
                    ..Default::default()
                },
                children: vec![
                    Element {
                        id: "card".into(),
                        kind: ElementKind::Container,
                        bounds: Rect { x: 50.0, y: 50.0, width: 540.0, height: 260.0 },
                        style: Style {
                            background_color: Some(Color { r: 255, g: 255, b: 255, a: 255 }),
                            opacity: 0.9,
                            border_radius: [16.0, 16.0, 16.0, 16.0],
                            overflow_hidden: true,
                            visibility: true,
                            ..Default::default()
                        },
                        children: vec![
                            Element {
                                id: "title".into(),
                                kind: ElementKind::Text { content: "Hello from Skia!".into() },
                                bounds: Rect { x: 30.0, y: 30.0, width: 480.0, height: 40.0 },
                                style: Style {
                                    color: Some(Color { r: 0, g: 0, b: 0, a: 255 }),
                                    font_size: Some(32.0),
                                    opacity: 1.0,
                                    visibility: true,
                                    ..Default::default()
                                },
                                children: vec![],
                            },
                        ],
                    },
                ],
            },
        ],
    };

    let output_path = "/tmp/hyperframes-native-test.mp4";
    let config = RenderConfig {
        fps: 30,
        duration_secs: 1.0,
        quality: 80,
        output_path: output_path.to_string(),
    };

    let result = render_static(&scene, &config).unwrap();

    assert_eq!(result.total_frames, 30);
    assert!(Path::new(output_path).exists());
    let file_size = std::fs::metadata(output_path).unwrap().len();
    assert!(file_size > 1000, "Output MP4 should be non-trivial size, got {file_size}");

    // Cleanup
    std::fs::remove_file(output_path).ok();
}
```

- [ ] **Step 3: Run integration test**

```bash
cargo test -p hyperframes-native-renderer -- --test-threads=1
```
Expected: PASS (requires FFmpeg installed)

- [ ] **Step 4: Commit**

```bash
git add packages/native-renderer/src/pipeline.rs
git add packages/native-renderer/src/lib.rs
git add packages/native-renderer/tests/pipeline_test.rs
git commit -m "feat(native-renderer): static scene → MP4 render pipeline via FFmpeg"
```

---

### Task 6: Benchmark — Native vs Chrome CDP

**Files:**
- Create: `packages/native-renderer/benches/render_bench.rs`

- [ ] **Step 1: Add criterion dependency**

Update `Cargo.toml`:
```toml
[dev-dependencies]
insta = "1"
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "render_bench"
harness = false
```

- [ ] **Step 2: Write benchmark**

Create `benches/render_bench.rs`:
```rust
use criterion::{criterion_group, criterion_main, Criterion};
use hyperframes_native_renderer::scene::{Scene, Element, ElementKind, Rect, Style, Color};
use hyperframes_native_renderer::paint::canvas::RenderSurface;
use hyperframes_native_renderer::paint::elements::paint_element;
use skia_safe::Color4f;

fn build_test_scene() -> Scene {
    let mut children = Vec::new();
    // 20 overlapping cards with text — representative of a composition
    for i in 0..20 {
        children.push(Element {
            id: format!("card-{i}"),
            kind: ElementKind::Container,
            bounds: Rect {
                x: 50.0 + (i as f32 * 10.0),
                y: 50.0 + (i as f32 * 15.0),
                width: 400.0,
                height: 200.0,
            },
            style: Style {
                background_color: Some(Color { r: (i * 12) as u8, g: 100, b: 200, a: 220 }),
                opacity: 0.8,
                border_radius: [12.0, 12.0, 12.0, 12.0],
                overflow_hidden: true,
                visibility: true,
                ..Default::default()
            },
            children: vec![Element {
                id: format!("text-{i}"),
                kind: ElementKind::Text { content: format!("Card {i} — Hello World") },
                bounds: Rect { x: 20.0, y: 20.0, width: 360.0, height: 30.0 },
                style: Style {
                    color: Some(Color { r: 255, g: 255, b: 255, a: 255 }),
                    font_size: Some(24.0),
                    opacity: 1.0,
                    visibility: true,
                    ..Default::default()
                },
                children: vec![],
            }],
        });
    }

    Scene {
        width: 1920.0,
        height: 1080.0,
        elements: vec![Element {
            id: "root".into(),
            kind: ElementKind::Container,
            bounds: Rect { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0 },
            style: Style {
                background_color: Some(Color { r: 15, g: 15, b: 30, a: 255 }),
                opacity: 1.0,
                visibility: true,
                ..Default::default()
            },
            children,
        }],
    }
}

fn bench_paint_frame(c: &mut Criterion) {
    let scene = build_test_scene();
    let mut surface = RenderSurface::new_raster(1920, 1080).unwrap();

    c.bench_function("paint_1080p_20_elements", |b| {
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element);
            }
        });
    });

    c.bench_function("paint_and_encode_jpeg_1080p", |b| {
        b.iter(|| {
            surface.clear(Color4f::new(0.0, 0.0, 0.0, 1.0));
            for element in &scene.elements {
                paint_element(surface.canvas(), element);
            }
            surface.encode_jpeg(80).unwrap();
        });
    });
}

criterion_group!(benches, bench_paint_frame);
criterion_main!(benches);
```

- [ ] **Step 3: Run benchmark**

```bash
cargo bench -p hyperframes-native-renderer
```

Expected output format:
```
paint_1080p_20_elements    time: [0.5ms 0.6ms 0.7ms]
paint_and_encode_jpeg_1080p time: [2.1ms 2.3ms 2.5ms]
```

Compare against the Chrome CDP baseline (~30-50ms/frame). A 10-20x speedup on CPU-only raster is expected. GPU surface in Phase 3 will add another 5-10x.

- [ ] **Step 4: Commit**

```bash
git add packages/native-renderer/benches/
git add packages/native-renderer/Cargo.toml
git commit -m "bench(native-renderer): Skia paint benchmark — 1080p, 20 elements"
```

---

## 8. Moat Analysis

### Why This Wins Long-Term

| Dimension | Remotion | HyperFrames Native |
|---|---|---|
| **Renderer** | Chrome (general-purpose browser) | Skia (Chrome's own paint engine, purpose-built) |
| **Animation** | React reconciler in full DOM | V8 isolate (GSAP only, no DOM overhead) |
| **Encoding** | FFmpeg CPU (separate process) | Hardware encoder, zero-copy from GPU |
| **Memory** | ~256MB per Chrome tab | ~50MB per Skia context |
| **Switching cost for them** | Rewrite every React component + abandon ecosystem | N/A |
| **Switching cost for us** | Keep HTML authoring, Rust renderer is transparent | N/A |
| **HDR** | Not possible (browser clamps to sRGB) | Native 10-bit pipeline through Skia |
| **8K support** | Impractical (Chrome memory + screenshot overhead) | Linear GPU scaling |
| **Cloud cost** | CPU-bound, expensive | GPU instances, 10-50x more throughput per $ |

### The Decisive Advantage

The HTML+GSAP authoring format is Hyperframes' API contract with users. The rendering backend is an implementation detail. Users write the same HTML compositions — the CLI transparently picks the fastest renderer that can handle the composition's CSS properties. Remotion can't do this because their API contract IS React-in-Chrome.

This means Hyperframes can adopt **any** rendering backend — Chrome (compatibility), WebCodecs (medium-term), Skia/Rust (long-term) — without breaking a single user composition. That architectural flexibility is the moat.
