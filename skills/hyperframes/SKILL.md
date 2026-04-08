---
name: hyperframes
description: Create video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions in HyperFrames HTML. Use when asked to build any HTML-based video content, add captions or subtitles synced to audio, generate text-to-speech narration, create audio-reactive animation (beat sync, glow, pulse driven by music), add animated text highlighting (marker sweeps, hand-drawn circles, burst lines, scribble, sketchout), or add transitions between scenes (crossfades, wipes, reveals, shader transitions). Covers composition authoring, timing, media, and the full video production workflow. For CLI commands (init, lint, preview, render, transcribe, tts) see the hyperframes-cli skill.
---

# HyperFrames

HTML is the source of truth for video. A composition is an HTML file with `data-*` attributes for timing, a GSAP timeline for animation, and CSS for appearance.

When no `visual-style.md` or animation direction is provided, follow [house-style.md](./house-style.md) for motion defaults, sizing, and color palettes.

## Data Attributes

### All Clips

| Attribute          | Required                          | Values                                                 |
| ------------------ | --------------------------------- | ------------------------------------------------------ |
| `id`               | Yes                               | Unique identifier                                      |
| `data-start`       | Yes                               | Seconds or clip ID reference (`"el-1"`, `"intro + 2"`) |
| `data-duration`    | Required for img/div/compositions | Seconds. Video/audio defaults to media duration.       |
| `data-track-index` | Yes                               | Integer. Same-track clips cannot overlap.              |
| `data-media-start` | No                                | Trim offset into source (seconds)                      |
| `data-volume`      | No                                | 0-1 (default 1)                                        |

`data-track-index` does **not** affect visual layering — use CSS `z-index`.

### Composition Clips

| Attribute                    | Required | Values                                       |
| ---------------------------- | -------- | -------------------------------------------- |
| `data-composition-id`        | Yes      | Unique composition ID                        |
| `data-duration`              | Yes      | Takes precedence over GSAP timeline duration |
| `data-width` / `data-height` | Yes      | Pixel dimensions (1920x1080 or 1080x1920)    |
| `data-composition-src`       | No       | Path to external HTML file                   |

## Composition Structure

Every composition is a `<template>` wrapping a `<div>` with `data-composition-id`:

```html
<template id="my-comp-template">
  <div data-composition-id="my-comp" data-width="1920" data-height="1080">
    <!-- content -->
    <style>
      [data-composition-id="my-comp"] {
        /* scoped styles */
      }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      // tweens...
      window.__timelines["my-comp"] = tl;
    </script>
  </div>
</template>
```

Load in root: `<div id="el-1" data-composition-id="my-comp" data-composition-src="compositions/my-comp.html" data-start="0" data-duration="10" data-track-index="1"></div>`

## Video and Audio

Video must be `muted playsinline`. Audio is always a separate `<audio>` element:

```html
<video
  id="el-v"
  data-start="0"
  data-duration="30"
  data-track-index="0"
  src="video.mp4"
  muted
  playsinline
></video>
<audio
  id="el-a"
  data-start="0"
  data-duration="30"
  data-track-index="2"
  src="video.mp4"
  data-volume="1"
></audio>
```

## Timeline Contract

- All timelines start `{ paused: true }` — the player controls playback
- Register every timeline: `window.__timelines["<composition-id>"] = tl`
- Framework auto-nests sub-timelines — do NOT manually add them
- Duration comes from `data-duration`, not from GSAP timeline length

## Rules (Non-Negotiable)

**Deterministic:** No `Math.random()`, `Date.now()`, or time-based logic. Use a seeded PRNG if you need pseudo-random values (e.g. mulberry32).

**GSAP:** Only animate visual properties (`opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `borderRadius`, transforms). Do NOT animate `visibility`, `display`, or call `video.play()`/`audio.play()`.

**Animation conflicts:** Never animate the same property on the same element from multiple timelines simultaneously.

**No `repeat: -1`:** Infinite-repeat timelines break the capture engine. Calculate the exact repeat count from composition duration: `repeat: Math.ceil(duration / cycleDuration) - 1`.

**Synchronous timeline construction:** Never build timelines inside `async`/`await`, `setTimeout`, or Promises. The capture engine reads `window.__timelines` synchronously after page load. If you need fonts loaded first, use a synchronous `document.fonts.load()` call or rely on `font-display: block` — the engine waits for the page `load` event.

**Centering text:** Use `width: 100%; left: 0; text-align: center` — NOT `left: 50%; transform: translateX(-50%)`. The second approach breaks when GSAP animates `x`, because GSAP's `x` compounds with the existing translateX.

**GSAP `x` and `y` are RELATIVE offsets, not screen coordinates.** An element at CSS `left: 400px` with GSAP `x: 200` renders at 600px. Never use GSAP `x` values above 300 or below -300 for content slides — those are almost certainly absolute coordinates confused for relative offsets.

**Preventing overlap:** Calculate the actual bottom edge of every element before placing the next one. Bottom edge = `top` + (`fontSize` × `lineHeight` × `numberOfLines`). A 200px font with `line-height: 1` and a `<br>` (2 lines) at `top: 350px` has its bottom at 350 + 200×1×2 = 750px — the next element must start at 770px+, not 610px. Always do this math. After placing all elements in a scene, check for collisions: list every element visible at the same timestamp with its top and bottom edge, and verify no ranges overlap.

**Safe zones:** Keep text inset 40px from all edges. The bottom 80px is too close to playback controls — keep baselines above `data-height - 80`.

**Never do:**

1. Forget `window.__timelines` registration
2. Use video for audio — always muted video + separate `<audio>`
3. Nest video inside a timed div — use a non-timed wrapper
4. Use `data-layer` (use `data-track-index`) or `data-end` (use `data-duration`)
5. Animate video element dimensions — animate a wrapper div
6. Call play/pause/seek on media — framework owns playback
7. Create a top-level container without `data-composition-id`
8. Use `repeat: -1` on any timeline or tween — always finite repeats
9. Build timelines asynchronously (inside `async`, `setTimeout`, `Promise`)

## Typography and Assets

- Load fonts via `<link>` tags with `display=block` in `<head>`, NOT via CSS `@import` — `@import` is async and may not complete before the first frame capture
- Use `font-display: block` for `@font-face` declarations
- Add `crossorigin="anonymous"` to external media
- **Minimum font sizes for rendered video (1080p at DPR 1):**
  - Body/label text: 20px minimum (landscape), 18px minimum (portrait)
  - Data labels, axis labels, footnotes: 16px minimum — anything smaller becomes illegible after encoding
  - Headlines: 36px+ recommended
  - Avoid sub-14px text entirely — it will be unreadable in the final MP4
- For dynamic text overflow, use `window.__hyperframes.fitTextFontSize(text, { maxWidth, fontFamily, fontWeight })` — returns `{ fontSize, fits }`
- All files live at the project root alongside `index.html`; sub-compositions use `../`

### Backgrounds and Color

- **Avoid full-screen linear gradients on dark backgrounds** — H.264 encoding creates visible color banding. Prefer: solid colors, radial gradients with limited range, or subtle noise/texture overlays to break up banding.
- For dark themes, use solid `#000` or `#0A0A0A` with localized radial glows rather than a linear gradient spanning the full viewport.

## Editing Existing Compositions

- Read the full composition first — match existing fonts, colors, animation patterns
- Only change what was requested
- Preserve timing of unrelated clips

## Output Checklist

- [ ] Every top-level container has `data-composition-id`, `data-width`, `data-height`, `data-duration`
- [ ] Compositions in own HTML files, loaded via `data-composition-src`
- [ ] `<template>` wrapper on sub-compositions
- [ ] `window.__timelines` registered for every composition
- [ ] Timeline construction is synchronous (no async/await wrapping timeline code)
- [ ] No `repeat: -1` on any tween or nested timeline
- [ ] No text below 16px (data labels, footnotes) or 20px (body text)
- [ ] No full-screen linear dark gradients (use radial or solid + localized glow)
- [ ] Fonts loaded via `<link>` with `display=block`, not CSS `@import`
- [ ] 100% deterministic
- [ ] Each composition includes GSAP script tag
- [ ] `npx hyperframes lint` and `npx hyperframes validate` both pass

---

## References (loaded on demand)

- **[references/captions.md](references/captions.md)** — Captions, subtitles, lyrics, karaoke synced to audio. Tone-adaptive style detection, per-word styling, text overflow prevention, caption exit guarantees, word grouping. Read when adding any text synced to audio timing.
- **[references/tts.md](references/tts.md)** — Text-to-speech with Kokoro-82M. Voice selection, speed tuning, TTS+captions workflow. Read when generating narration or voiceover.
- **[references/audio-reactive.md](references/audio-reactive.md)** — Audio-reactive animation: map frequency bands and amplitude to GSAP properties. Read when visuals should respond to music, voice, or sound.
- **[references/audio-choreography.md](references/audio-choreography.md)** — Beat-mapped choreography: analyze audio energy/structure, time animation events to beats, match intensity to energy phases. Read when visuals should be synced to music structure without per-frame pulsing — reveals land on beats, transitions match energy changes.
- **[references/marker-highlight.md](references/marker-highlight.md)** — Animated text highlighting via canvas overlays: marker pen, circle, burst, scribble, sketchout. Read when adding visual emphasis to text.
- **[house-style.md](house-style.md)** — Default motion, sizing, and color palettes when no style is specified.
- **[patterns.md](patterns.md)** — PiP, title cards, slide show patterns.
- **[data-in-motion.md](data-in-motion.md)** — Data, stats, and infographic patterns.
- **[references/transcript-guide.md](references/transcript-guide.md)** — Transcription commands, whisper models, external APIs, troubleshooting.
- **[references/dynamic-techniques.md](references/dynamic-techniques.md)** — Dynamic caption animation techniques (karaoke, clip-path, slam, scatter, elastic, 3D).

- **[references/transitions.md](references/transitions.md)** — Scene transitions: crossfades, wipes, reveals, shader transitions. Energy/mood selection, narrative position, CSS vs WebGL guidance. Read when a composition has multiple scenes that need visual handoffs.
  - [transitions/catalog.md](references/transitions/catalog.md) — Hard rules, scene template, and routing to per-type implementation code.
  - [transitions/shader-setup.md](references/transitions/shader-setup.md) — WebGL boilerplate for shader transitions.
  - [transitions/shader-transitions.md](references/transitions/shader-transitions.md) — 14 fragment shaders.

GSAP patterns and effects are in the `/gsap` skill.
