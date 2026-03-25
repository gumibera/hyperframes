---
name: composing-video
description: Generates HyperFrames HTML video compositions from scratch or by editing existing ones. Handles composition structure, GSAP timelines, clip timing, sub-compositions, and asset references. Use when creating videos, building animations, making compositions, adding title cards, or generating any HTML-based video content for HyperFrames.
---

# Composing Video

Generate valid HyperFrames compositions that work in the studio preview and the producer render pipeline.

## How HyperFrames Works

HTML is the source of truth for video:

- **HTML elements** with `data-*` attributes define what appears and when
- **CSS** controls positioning and appearance
- **GSAP timeline** drives animations
- **The framework** automatically handles clip visibility, media playback, and timeline sync

### Framework-Managed Behavior

The framework automatically manages:

- **Primitive clip timeline entries** — reads `data-start`, `data-duration`, `data-track-index` and adds them to the GSAP timeline. Do not manually add primitive clips to the timeline in scripts.
- **Media playback** (play, pause, seek) for `<video>` and `<audio>`
- **Clip lifecycle** — clips are mounted/unmounted based on `data-start` and `data-duration`
- **Timeline synchronization** and **media loading**

Mounting controls **presence**, not appearance. Transitions (fade, slide) are animated in scripts after mount or before unmount.

Do not call `video.play()`, `video.pause()`, set `audio.currentTime`, or mount/unmount clips in scripts.

## Compositions

Every clip must live inside a composition. The `index.html` is the top-level composition; it can contain nested sub-compositions. Any composition can be imported into another — there is no special "root" type.

**Every top-level HTML container MUST have a `data-composition-id`.** No bare containers.

### Composition File Structure

Each reusable composition goes in its own HTML file using the `<template>` format:

```
project/
├── index.html
├── compositions/
│   ├── intro-anim.html
│   └── caption-overlay.html
├── fonts/
│   └── BrandFont.woff2
├── assets/
│   ├── logo.png
│   └── b-roll.mp4
└── presenter.mp4
```

**Composition file format** (`compositions/intro-anim.html`):

```html
<template id="intro-anim-template">
  <div data-composition-id="intro-anim" data-width="1920" data-height="1080">
    <div class="title">Welcome!</div>

    <style>
      [data-composition-id="intro-anim"] .title {
        font-size: 72px;
        color: white;
      }
    </style>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from(".title", { opacity: 0, y: -50, duration: 1 });
      window.__timelines["intro-anim"] = tl;
    </script>
  </div>
</template>
```

**Requirements:**

- Template `id` must be `<composition-id>-template`
- Composition root must have `data-composition-id`, `data-width`, `data-height`
- CSS must be scoped with `[data-composition-id="<id>"]` prefix
- Script must initialize `window.__timelines = window.__timelines || {}` before assigning

### Loading Sub-Compositions

```html
<div
  id="el-5"
  data-composition-id="intro-anim"
  data-composition-src="compositions/intro-anim.html"
  data-start="0"
  data-duration="5"
  data-track-index="3"
  data-width="1920"
  data-height="1080"
></div>
```

Host elements require ALL of: `data-composition-id`, `data-composition-src`, `data-start`, `data-duration`, `data-width`, `data-height`, `data-track-index`.

The framework auto-fetches the template, mounts it, executes scripts, and nests the timeline.

### Inline vs Separate Files

**Separate file** when reusable, complex (>20 lines), or for clean orchestration.
**Inline** when one-off, simple (<10 lines), or prototyping.

## Clip Types

- `<video>` — Video clips (always `muted playsinline`, audio via separate `<audio>`)
- `<img>` — Static images, overlays
- `<audio>` — Music, sound effects
- `<div data-composition-id="...">` — Nested compositions

## HTML Attributes

### All Clips

| Attribute          | Required                                                    | Values                                            |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------- |
| `id`               | Yes                                                         | Unique identifier                                 |
| `data-start`       | Yes                                                         | Seconds or clip ID reference (e.g., `"el-intro"`) |
| `data-duration`    | Required for img/div/compositions, optional for video/audio | Seconds                                           |
| `data-track-index` | Yes                                                         | Integer. Same track = no overlap.                 |
| `data-media-start` | No                                                          | Trim offset into source (seconds)                 |
| `data-volume`      | No                                                          | 0-1 (default 1)                                   |

`data-track-index` does **not** affect visual layering — use CSS `z-index`.

### Composition Clips

| Attribute                    | Required | Values                                                 |
| ---------------------------- | -------- | ------------------------------------------------------ |
| `data-composition-id`        | Yes      | Unique composition ID                                  |
| `data-duration`              | Yes      | Seconds. Takes precedence over GSAP timeline duration. |
| `data-width` / `data-height` | Yes      | Pixel dimensions                                       |
| `data-composition-src`       | No       | Path to external HTML template                         |

## Viewport

| Format    | Width | Height |
| --------- | ----- | ------ |
| Landscape | 1920  | 1080   |
| Portrait  | 1080  | 1920   |

## Relative Timing

Reference another clip's `id` in `data-start` to mean "start when that clip ends":

```html
<video id="intro" data-start="0" data-duration="10" data-track-index="0" src="..."></video>
<video id="main" data-start="intro" data-duration="20" data-track-index="0" src="..."></video>
```

Offsets: `data-start="intro + 2"` (2s gap), `data-start="intro - 0.5"` (0.5s overlap, must be different track).

**Rules:** Same composition only. No circular refs. Referenced clip must have known duration.

## Assets

Relative paths from project root:

```html
<video src="presenter.mp4" muted playsinline ...></video>
<audio src="background-music.mp3" ...></audio>
<img src="assets/logo.png" ... />
```

Fonts in `fonts/`:

```css
@font-face {
  font-family: "BrandFont";
  src: url("fonts/BrandFont.woff2");
}
```

## Timeline Contract

Every composition must create and register a GSAP timeline:

```js
window.__timelines = window.__timelines || {};
const tl = gsap.timeline({ paused: true });
// ... tweens ...
window.__timelines["<data-composition-id>"] = tl;
```

**Rules:**

- Every composition needs a script to register its timeline
- All timelines start paused (`{ paused: true }`)
- Framework auto-nests sub-timelines — do NOT manually add them
- `data-duration` defines composition duration (takes precedence over timeline)
- NEVER create empty tweens (`tl.to({}, { duration: N })`) — use `data-duration`
- Timelines must have tweens with explicit durations summing to > 0

## Rules (Non-Negotiable)

### Deterministic Output (CRITICAL)

The renderer must produce **byte-for-byte identical output** every time.

**NEVER:** `Math.random()`, `Date.now()`, `performance.now()`, any randomness.

**Instead:** Array indexing with predictable patterns, deterministic functions, fixed sequences.

### GSAP Animation Conflicts

Never animate the same CSS property on an element from multiple timelines simultaneously — causes flickering in headless renders.

- One property per element at a time
- Overlapping selectors must not animate the same properties simultaneously
- Resolution: sequential timing, parent/child separation, or different properties

### Allowed GSAP Animations

**DO animate:** `opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `width`/`height` on non-media elements, `borderRadius`, CSS transforms

**DO NOT:** `visibility`, `video.play()`/`pause()`/`currentTime`, `audio.play()`/`pause()`/`currentTime`, `display` on timed clips

## Never Do

1. Forget `window.__timelines` registration
2. Use video for audio — always muted video + separate `<audio>`
3. Nest video inside a timed div — use a non-timed wrapper
4. Use `data-layer` — use `data-track-index`
5. Use `data-end` — use `data-duration`
6. Animate video element dimensions — use a wrapper div
7. Call play/pause/seek on media
8. Create empty tweens for duration — use `data-duration`
9. Use `Math.random()` or any non-deterministic logic
10. Create a top-level container without `data-composition-id`

## Patterns and Examples

See [patterns.md](patterns.md) for:

- Picture-in-Picture
- Title card with fade
- Slide show
- Wrapping dynamic content
- Complete top-level composition example

## Output Checklist

- [ ] Every top-level container has `data-composition-id`
- [ ] Every composition has `data-width`, `data-height`, `data-duration`
- [ ] Sub-composition hosts have ALL required attributes
- [ ] Template files use `<template id="<comp-id>-template">` wrapper
- [ ] CSS scoped with `[data-composition-id="<id>"]`
- [ ] `window.__timelines` initialized and all timelines registered
- [ ] No empty tweens — duration via `data-duration`
- [ ] ALL code is 100% deterministic
- [ ] Videos are `muted playsinline` with separate `<audio>` for sound
