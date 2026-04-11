---
name: hyperframes
description: Create video compositions, animations, title cards, overlays, captions, voiceovers, audio-reactive visuals, and scene transitions in HyperFrames HTML. Use when asked to build any HTML-based video content, add captions or subtitles synced to audio, generate text-to-speech narration, create audio-reactive animation (beat sync, glow, pulse driven by music), add animated text highlighting (marker sweeps, hand-drawn circles, burst lines, scribble, sketchout), or add transitions between scenes (crossfades, wipes, reveals, shader transitions). Covers composition authoring, timing, media, and the full video production workflow. For CLI commands (init, lint, preview, render, transcribe, tts) see the hyperframes-cli skill.
---

# HyperFrames

HTML is the source of truth for video. A composition is an HTML file with `data-*` attributes for timing, a GSAP timeline for animation, and CSS for appearance. The framework handles clip visibility, media playback, and timeline sync.

## Approach

Before writing HTML, think at a high level:

1. **What** — what should the viewer experience? Identify the narrative arc, key moments, and emotional beats.
2. **Structure** — how many compositions, which are sub-compositions vs inline, what tracks carry what (video, audio, overlays, captions).
3. **Timing** — which clips drive the duration, where do transitions land, what's the pacing.
4. **Layout** — build the end-state first. See "Layout Before Animation" below.
5. **Animate** — then add motion using the rules below.

For small edits (fix a color, adjust timing, add one element), skip straight to the rules.

When no `visual-style.md` or animation direction is provided, follow [house-style.md](./house-style.md) for motion defaults, sizing, and color palettes.

## Layout Before Animation

Position every element where it should be at its **most visible moment** — the frame where it's fully entered, correctly placed, and not yet exiting. Write this as static HTML+CSS first. No GSAP yet.

**Why this matters:** If you position elements at their animated start state (offscreen, scaled to 0, opacity 0) and tween them to where you think they should land, you're guessing the final layout. Overlaps are invisible until the video renders. By building the end state first, you can see and fix layout problems before adding any motion.

### The process

1. **Identify the hero frame** for each scene — the moment when the most elements are simultaneously visible. This is the layout you build.
2. **Write static CSS** for that frame. Every element at its final `top`, `left`, `width`, `height`. Use the browser or `npx hyperframes preview` to visually verify nothing overlaps unintentionally.
3. **Add entrances with `gsap.from()`** — animate FROM offscreen/invisible TO the CSS position. The CSS position is the ground truth; the tween describes the journey to get there.
4. **Add exits with `gsap.to()`** — animate TO offscreen/invisible FROM the CSS position.

### Example

```css
/* Step 1-2: Layout the end state. This is what the viewer sees at peak visibility. */
.title {
  position: absolute;
  top: 200px;
  left: 160px;
  opacity: 1;
}
.subtitle {
  position: absolute;
  top: 320px;
  left: 160px;
  opacity: 1;
}
.logo {
  position: absolute;
  bottom: 80px;
  right: 80px;
  opacity: 1;
}
```

```js
// Step 3: Animate INTO those positions
tl.from(".title", { y: 60, opacity: 0, duration: 0.6, ease: "power3.out" }, 0);
tl.from(".subtitle", { y: 40, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.2);
tl.from(".logo", { scale: 0.8, opacity: 0, duration: 0.4, ease: "power2.out" }, 0.3);

// Step 4: Animate OUT from those positions
tl.to(".title", { y: -40, opacity: 0, duration: 0.4, ease: "power2.in" }, 3);
tl.to(".subtitle", { y: -30, opacity: 0, duration: 0.3, ease: "power2.in" }, 3.1);
tl.to(".logo", { scale: 0.9, opacity: 0, duration: 0.3, ease: "power2.in" }, 3.2);
```

### When elements share space across time

If element A exits before element B enters in the same area, both should have correct CSS positions for their respective hero frames. The timeline ordering guarantees they never visually coexist — but if you skip the layout step, you won't catch the case where they accidentally overlap due to a timing error.

### What counts as intentional overlap

Layered effects (glow behind text, shadow elements, background patterns) and z-stacked designs (card stacks, depth layers) are intentional. The layout step is about catching **unintentional** overlap — two headlines landing on top of each other, a stat covering a label, content bleeding off-frame.

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
- Never create empty tweens to set duration

## Rules (Non-Negotiable)

**Deterministic:** No `Math.random()`, `Date.now()`, or time-based logic. Use a seeded PRNG if you need pseudo-random values (e.g. mulberry32).

**GSAP:** Only animate visual properties (`opacity`, `x`, `y`, `scale`, `rotation`, `color`, `backgroundColor`, `borderRadius`, transforms). Do NOT animate `visibility`, `display`, or call `video.play()`/`audio.play()`.

**Animation conflicts:** Never animate the same property on the same element from multiple timelines simultaneously.

**No `repeat: -1`:** Infinite-repeat timelines break the capture engine. Calculate the exact repeat count from composition duration: `repeat: Math.ceil(duration / cycleDuration) - 1`.

**Synchronous timeline construction:** Never build timelines inside `async`/`await`, `setTimeout`, or Promises. The capture engine reads `window.__timelines` synchronously after page load. Fonts are embedded by the compiler, so they're available immediately — no need to wait for font loading.

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

- **Fonts:** Just write the `font-family` you want in CSS — the compiler embeds supported fonts automatically via `@font-face` with inline data URIs. No `<link>` tags or `@import` needed. If a font isn't in the supported set, the compiler warns and you should add it to `deterministicFonts.ts`.
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
- [ ] Font families declared in CSS (compiler embeds them automatically)
- [ ] 100% deterministic
- [ ] Each composition includes GSAP script tag
- [ ] `npx hyperframes lint` and `npx hyperframes validate` both pass

---

## References (loaded on demand)

- **[references/captions.md](references/captions.md)** — Captions, subtitles, lyrics, karaoke synced to audio. Tone-adaptive style detection, per-word styling, text overflow prevention, caption exit guarantees, word grouping. Read when adding any text synced to audio timing.
- **[references/tts.md](references/tts.md)** — Text-to-speech with Kokoro-82M. Voice selection, speed tuning, TTS+captions workflow. Read when generating narration or voiceover.
- **[references/audio-reactive.md](references/audio-reactive.md)** — Audio-reactive animation: map frequency bands and amplitude to GSAP properties. Read when visuals should respond to music, voice, or sound.
- **[references/marker-highlight.md](references/marker-highlight.md)** — Animated text highlighting via canvas overlays: marker pen, circle, burst, scribble, sketchout. Read when adding visual emphasis to text.
- **[references/fonts.md](references/fonts.md)** — Typography: typographic tension and contrast principles, font pairing theory, case studies from SSENSE/Acne/Stripe/Fly.io/Collins, failure modes, runtime font discovery. Read when picking and pairing typefaces.
- **[references/motion-principles.md](references/motion-principles.md)** — Motion design principles: easing as emotion, timing as weight, choreography as hierarchy, scene pacing, ambient motion, anti-patterns. Read when choreographing GSAP animations.
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
