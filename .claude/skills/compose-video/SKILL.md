---
name: compose-video
description: Create HyperFrames HTML video compositions. Use when asked to create a video, build an animation, make a composition, add a title card, or generate any HTML-based video content for HyperFrames.
---

# Compose Video

Create HyperFrames HTML compositions — the HTML files that become videos. This skill contains everything you need to generate valid compositions that work in the studio preview and the producer render pipeline.

## When to Use

- "Create a video about..."
- "Make a composition with..."
- "Build an animation that..."
- "Add a title card / lower third / overlay"
- "Wrap this video in a produced composition"
- Any task that produces an `index.html` for HyperFrames

## How HyperFrames Works

HTML is the source of truth for video. A composition is an HTML file where:

- **HTML elements** with `data-*` attributes define what appears and when
- **CSS** controls positioning and appearance
- **GSAP timeline** drives animations
- **The framework** automatically handles clip visibility, media playback, and timeline sync

You write the HTML. The framework does the rest.

### Framework-Managed Behavior

The framework reads data attributes and automatically manages:

- **Primitive clip timeline entries** — the framework reads `data-start`, `data-duration`, and `data-track-index` from primitive clips and adds them to the composition's GSAP timeline. You do not manually add primitive clips to the timeline in scripts.
- **Media playback** (play, pause, seek) for `<video>` and `<audio>`
- **Clip lifecycle** — clips are **mounted** (made visible on screen) and **unmounted** (removed from screen) based on `data-start` and `data-duration`
- **Timeline synchronization** (keeping media in sync with the GSAP master timeline)
- **Media loading** — the framework waits for all media elements to load before resolving timing and starting playback

Mounting and unmounting controls **presence**, not appearance. A clip that is mounted is on screen; a clip that is unmounted is not. Transitions (fade in, slide in, etc.) are separate — they are animated in scripts and happen _after_ a clip is mounted or _before_ it is unmounted.

The framework does **not** handle transitions, effects, or visual animation — those are driven by GSAP in JavaScript.

Do not manually call `video.play()`, `video.pause()`, set `audio.currentTime`, or mount/unmount clips in scripts. The framework owns media playback and clip lifecycle.

## Viewport

Every composition must include `data-width` and `data-height` so scripts and CSS can reference concrete pixel dimensions for layout.

| Format    | Width | Height |
| --------- | ----- | ------ |
| Landscape | 1920  | 1080   |
| Portrait  | 1080  | 1920   |

## Compositions

A composition is the fundamental grouping unit. Every clip — video, image, audio — must live inside a composition. The `index.html` file is itself a composition (the top-level one), and it can contain nested compositions. Any composition can be imported into another as a sub-composition — there is no special "root" type.

A composition carries the same core attributes as any other clip (`id`, `data-start`, `data-track-index`, `data-duration`), so it can be placed and timed on a timeline just like a video or image.

**Critical Rule: Every top-level HTML container MUST be a composition (i.e., have a `data-composition-id` attribute). You cannot create a top-level HTML container without an associated composition. All visual content must live inside a composition with data attributes to appear in the timeline.**

### Composition File Structure

Each composition should be defined in its own HTML file. This keeps compositions modular, reusable, and maintainable.

```
project/
├── index.html              # Root composition
├── compositions/
│   ├── intro-anim.html     # Intro animation composition
│   ├── caption-overlay.html # Caption composition
│   └── outro-title.html     # Outro composition
```

**Composition file format** (`compositions/intro-anim.html`):

```html
<template id="intro-anim-template">
  <div data-composition-id="intro-anim" data-width="1920" data-height="1080">
    <div class="title">Welcome!</div>
    <div class="subtitle">Let's get started</div>

    <style>
      [data-composition-id="intro-anim"] .title {
        font-size: 72px;
        color: white;
        text-align: center;
      }
      [data-composition-id="intro-anim"] .subtitle {
        font-size: 36px;
        color: #ccc;
        text-align: center;
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { opacity: 0, y: -50, duration: 1 });
      tl.from(".subtitle", { opacity: 0, y: 50, duration: 1 }, 0.5);
      window.__timelines["intro-anim"] = tl;
    </script>
  </div>
</template>
```

**GSAP must be included in every composition.** Each composition file must include `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>` before any script that uses GSAP. Compositions are loaded independently, so they cannot rely on a parent document having loaded GSAP.

The composition root inside the template must include `data-width` and `data-height`.

### Loading Compositions

Use `data-composition-src` to load a composition from an external HTML file:

```html
<div
  id="el-5"
  data-composition-id="intro-anim"
  data-composition-src="compositions/intro-anim.html"
  data-start="0"
  data-track-index="3"
></div>
```

The framework will:

1. Fetch the HTML file specified in `data-composition-src`
2. Extract the `<template>` content
3. Clone and mount it into the composition element
4. Execute any `<script>` tags within the template
5. Register the timeline in `window.__timelines`

### When to Use Separate Files vs Inline

**Use separate HTML files when:**

- The composition is reusable across multiple projects or scenes
- The composition has complex logic, styling, or structure (>20 lines)
- You want to keep the main `index.html` clean and focused on orchestration

**Use inline compositions when:**

- The composition is truly one-off and project-specific
- The composition is very simple (<10 lines total)
- You're prototyping and iterating quickly

## Clip Types

A clip is any discrete block on the timeline, represented as an HTML element with data attributes.

- `<video>` — Video clips, B-roll, A-roll
- `<img>` — Static images, overlays
- `<audio>` — Music, sound effects
- `<div data-composition-id="...">` — Nested compositions (animations, grouped sequences)

## HTML Attributes

### All Clips

| Attribute          | Required                                                    | Values                                                                   |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `id`               | Yes                                                         | Unique identifier (e.g., `"el-1"`)                                       |
| `data-start`       | Yes                                                         | Seconds (e.g., `"0"`, `"5.5"`) or clip ID reference (e.g., `"el-intro"`) |
| `data-duration`    | Required for img/div/compositions, optional for video/audio | Seconds. Video/audio defaults to source media duration if omitted.       |
| `data-track-index` | Yes                                                         | Integer. Clips on the same track **cannot overlap in time**.             |
| `data-media-start` | No                                                          | Trim offset into source file (seconds)                                   |
| `data-volume`      | No                                                          | 0-1 (default 1)                                                          |

**Important:** `data-track-index` does **not** affect visual layering — use CSS `z-index` to control which elements render in front of others.

### Composition Clips

| Attribute                    | Required | Values                                                                      |
| ---------------------------- | -------- | --------------------------------------------------------------------------- |
| `data-composition-id`        | Yes      | Unique composition ID                                                       |
| `data-duration`              | Yes      | Explicit duration in seconds. Takes precedence over GSAP timeline duration. |
| `data-width` / `data-height` | Yes      | Pixel dimensions                                                            |
| `data-composition-src`       | No       | Path to external HTML file containing the composition template              |

## Relative Timing

Instead of calculating absolute start times, a clip can reference another clip's `id` in its `data-start` attribute. This means "start when that clip ends."

```html
<video id="intro" data-start="0" data-duration="10" data-track-index="0" src="..."></video>
<video id="main" data-start="intro" data-duration="20" data-track-index="0" src="..."></video>
<video id="outro" data-start="main" data-duration="5" data-track-index="0" src="..."></video>
```

`main` resolves to second 10, `outro` resolves to second 30. If `intro`'s duration changes, downstream clips shift automatically.

### Offsets (gaps and overlaps)

```html
<!-- 2s gap after intro -->
<video
  id="scene-a"
  data-start="intro + 2"
  data-duration="20"
  data-track-index="0"
  src="..."
></video>

<!-- 0.5s overlap for crossfade (different track since same-track clips can't overlap) -->
<video
  id="scene-b"
  data-start="intro - 0.5"
  data-duration="20"
  data-track-index="1"
  src="..."
></video>
```

### Rules

- **Same composition only** — references resolve within the clip's parent composition
- **No circular references** — A cannot start after B if B starts after A
- **Referenced clip must have a known duration** — either explicit `data-duration` or inferred from source media
- **Parsing** — if the value is a valid number, it is absolute seconds; otherwise parsed as `<id>`, `<id> + <number>`, or `<id> - <number>`

## Video Clips

```html
<video
  id="el-1"
  data-start="0"
  data-duration="15"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
></video>
```

Videos MUST be `muted` and `playsinline`. Audio MUST be a separate `<audio>` element, even if the source is the same file.

## Audio Clips

```html
<audio
  id="el-audio"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="video.mp4"
  data-volume="0.8"
></audio>
```

Never rely on `<video>` for audio. The framework manages video and audio playback independently.

## Two Layers: Primitives and Scripts

Every composition has the same two layers:

- **HTML** — primitive clips (`video`, `img`, `audio`, nested `div[data-composition-id]`). Declarative structure: what plays, when, and on which track.
- **Script** — effects, transitions, dynamic DOM, canvas, SVG — creative animation and visuals via GSAP. Scripts do **not** control media playback or clip visibility.

### Script Isolation

Each composition's script is scoped to that composition. When loaded via `data-composition-src`, its inline `<script>` and `<style>` tags are automatically included and scoped.

## Timeline Contract

The framework initializes `window.__timelines = {}` before any scripts run. Every composition **must** create a GSAP timeline and register it:

```js
const tl = gsap.timeline({ paused: true });
// ... add tweens, nested timelines, etc.
window.__timelines["<data-composition-id>"] = tl;
```

### Rules

- **Every composition needs a script** — at minimum, to create and register its timeline.
- **All timelines start paused** — create with `{ paused: true }`. The top-level timeline is controlled externally by the player or renderer.
- **Framework auto-nests sub-timelines** — you do **not** need to manually add sub-composition timelines to the master timeline. The framework automatically nests any timeline registered in `window.__timelines` into its parent based on `data-start`.
- **Duration source** — a composition's duration comes from its required `data-duration` attribute. `data-duration` takes precedence over the GSAP timeline duration.
- **NEVER create empty tweens** like `tl.to({}, { duration: N })` or `tl.set({}, {}, N)` just to set duration — use `data-duration` instead.
- **Timelines must be finite** — every composition must have a concrete duration via `data-duration`, and its GSAP timeline must have tweens with explicit durations that sum to > 0.

### What NOT to do

```js
// UNNECESSARY - the framework does this automatically
if (window.__timelines["captions"]) {
  masterTL.add(window.__timelines["captions"], 0);
}

// WRONG - use data-duration instead
tl.set({}, {}, VIDEO_DURATION_IN_SECONDS);
```

## Rules (Non-Negotiable)

### Deterministic Output (CRITICAL)

All animations, scripts, and timeline logic MUST be completely deterministic. The renderer executes compositions in a headless server environment and must produce **byte-for-byte identical output** every time.

**NEVER use:**

- `Math.random()` or any randomness
- `Date.now()`, `performance.now()`, or time-based logic
- Probabilistic behavior of any kind

**Use instead:**

- Array indexing with predictable patterns (e.g., `items[index % items.length]`)
- Deterministic functions based on clip index, timeline position, or other known values
- Fixed sequences defined explicitly in arrays or data structures

### GSAP Animation Conflicts

Never animate the same CSS property on an element from multiple timelines simultaneously — this causes flickering/artifacts in headless (Puppeteer) renders even if it looks fine in a browser.

- Animate each property only once per element at any given time
- If a selector (`.item`, tag) matches multiple elements, do NOT also animate those elements individually at the same time
- Ensure animation targets are mutually exclusive sets of elements

```js
// BAD - same elements animated twice simultaneously
tl.to(".item", { textShadow: "..." }, 0);
items.forEach((item, i) => {
  tl.fromTo(item, { opacity: 0 }, { opacity: 1 }, i * 0.1);
});

// GOOD - sequential timing
items.forEach((item, i) => {
  tl.fromTo(item, { opacity: 0 }, { opacity: 1 }, i * 0.1);
});
tl.to(".item", { textShadow: "..." }, items.length * 0.1 + 0.5);

// GOOD - parent/child separation
tl.to(".container", { scale: 1.1 }, 0);
items.forEach((item, i) => {
  tl.fromTo(item, { opacity: 0 }, { opacity: 1 }, i * 0.1);
});
```

### GSAP Animations

Only animate visual properties. The framework owns everything else.

**DO animate:** `opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `width`/`height` on non-media elements, `borderRadius`, CSS transforms

**DO NOT animate or control:**

- `visibility` (framework manages this)
- `video.play()` / `video.pause()` / `video.currentTime`
- `audio.play()` / `audio.pause()` / `audio.currentTime`
- `display` property on timed clips

## Never Do

1. **Never forget `window.__timelines` registration** — nothing works without it
2. **Never use video for audio** — always muted video + separate audio element
3. **Never nest video inside a timed div** — video must be a direct stage child (or inside a non-timed wrapper)
4. **Never use `data-layer`** — use `data-track-index`
5. **Never use `data-end` in source** — use `data-duration`
6. **Never animate video element dimensions** — use a non-timed wrapper div
7. **Never call play/pause/seek on media** — framework owns media playback
8. **Never create empty tweens to set duration** — use `data-duration` on the composition
9. **Never use `Math.random()` or any non-deterministic logic** — renderer requires identical output every time
10. **Never create a top-level container without `data-composition-id`** — all visual content must be in a composition

## Wrapping Dynamic Content in Compositions

When you have dynamic or script-animated content (captions, emojis, overlays, text animations), wrap them in a composition element. Children inside can be freely created and animated via JavaScript — they don't need individual data attributes.

### Wrong: Dynamic content outside a composition

```html
<!-- BAD: captions-container is not a composition - won't appear in timeline -->
<div id="ui-layer">
  <div id="captions-container"></div>
  <div class="emoji" id="emoji-1">🤩</div>
</div>
```

### Correct: Compositions loaded from files (preferred)

```html
<div
  id="captions-comp"
  data-composition-id="captions"
  data-composition-src="compositions/captions.html"
  data-start="0"
  data-track-index="5"
></div>

<div
  id="emojis-comp"
  data-composition-id="emojis"
  data-composition-src="compositions/emojis.html"
  data-start="0"
  data-track-index="6"
></div>
```

### Correct: Inline composition (for simple one-offs)

```html
<div
  id="captions-comp"
  data-composition-id="captions"
  data-start="0"
  data-duration="60"
  data-track-index="5"
  data-width="1920"
  data-height="1080"
>
  <div id="captions-container"></div>
  <script>
    const captionTL = gsap.timeline({ paused: true });
    // Dynamically create and animate caption groups...
    window.__timelines["captions"] = captionTL;
  </script>
</div>
```

## Patterns

### Picture-in-Picture (Video in a Frame)

Animate a wrapper div for position/size. The video fills the wrapper. The wrapper has NO data attributes.

```html
<div
  id="pip-frame"
  style="position:absolute;top:0;left:0;width:1920px;height:1080px;z-index:50;overflow:hidden;"
>
  <video
    id="el-video"
    data-start="0"
    data-duration="60"
    data-track-index="0"
    src="talking-head.mp4"
    muted
    playsinline
  ></video>
</div>
```

```js
tl.to(
  "#pip-frame",
  { top: 700, left: 1360, width: 500, height: 280, borderRadius: 16, duration: 1 },
  10,
);
tl.to("#pip-frame", { left: 40, duration: 0.6 }, 30);
```

### Title Card with Fade

```html
<div
  id="title-card"
  data-start="0"
  data-duration="5"
  data-track-index="5"
  style="display:flex;align-items:center;justify-content:center;background:#111;z-index:60;"
>
  <h1 style="font-size:64px;color:#fff;opacity:0;">My Video Title</h1>
</div>
```

```js
tl.to("#title-card h1", { opacity: 1, duration: 0.6 }, 0.3);
tl.to("#title-card", { opacity: 0, duration: 0.5 }, 4);
```

### Slide Show with Section Headers

Use separate elements on the same track, each with its own time range. Slides auto-mount/unmount based on `data-start`/`data-duration`.

```html
<div class="slide" data-start="0" data-duration="30" data-track-index="3">...</div>
<div class="slide" data-start="30" data-duration="25" data-track-index="3">...</div>
<div class="slide" data-start="55" data-duration="20" data-track-index="3">...</div>
```

## Top-Level Composition Example

```html
<div
  id="comp-1"
  data-composition-id="my-video"
  data-start="0"
  data-duration="60"
  data-width="1920"
  data-height="1080"
>
  <!-- Primitive clips -->
  <video
    id="el-1"
    data-start="0"
    data-duration="10"
    data-track-index="0"
    src="..."
    muted
    playsinline
  ></video>
  <video
    id="el-2"
    data-start="el-1"
    data-duration="8"
    data-track-index="0"
    src="..."
    muted
    playsinline
  ></video>
  <img id="el-3" data-start="5" data-duration="4" data-track-index="1" src="..." />
  <audio id="el-4" data-start="0" data-duration="30" data-track-index="2" src="..." />

  <!-- Sub-compositions loaded from files -->
  <div
    id="el-5"
    data-composition-id="intro-anim"
    data-composition-src="compositions/intro-anim.html"
    data-start="0"
    data-track-index="3"
  ></div>

  <div
    id="el-6"
    data-composition-id="captions"
    data-composition-src="compositions/caption-overlay.html"
    data-start="0"
    data-track-index="4"
  ></div>

  <script>
    // Just register the timeline — framework auto-nests sub-compositions
    const tl = gsap.timeline({ paused: true });
    window.__timelines["my-video"] = tl;
  </script>
</div>
```

## Rendering

Compositions render to MP4 via the producer. The producer loads the HTML in headless Chrome, seeks frame-by-frame, screenshots each frame, and encodes to H.264 with FFmpeg. Preview and render use the same runtime — WYSIWYG.

## Output Checklist

- [ ] Every top-level HTML container is a composition (`data-composition-id` required)
- [ ] Every composition has `data-width` and `data-height` attributes
- [ ] Each composition has a `data-duration` attribute
- [ ] NEVER use empty tweens like `tl.to({}, { duration: N })` — use `data-duration` instead
- [ ] Each reusable composition is in its own HTML file (in `compositions/` directory)
- [ ] Compositions loaded via `data-composition-src` attribute
- [ ] Each composition file uses `<template>` tag to wrap its content
- [ ] `window.__timelines` given all compositions' timelines
- [ ] ALL code is 100% deterministic — no `Math.random()`, `Date.now()`, or any randomness
- [ ] Every composition includes its own GSAP script tag: `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`
