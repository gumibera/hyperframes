---
name: transitions
description: Scene transition constraints and patterns for HyperFrames. Use when adding crossfades, wipes, or reveals between scenes in a composition.
---

# Transitions

Constraints and patterns for scene-to-scene transitions in HyperFrames compositions.

## When to Use

- Adding a crossfade, wipe, or reveal between video clips or scenes
- User asks for "smooth transition", "crossfade", or "scene change"
- Connecting two sequential clips visually

## Core Constraint: Same-Track Clips Cannot Overlap

Clips on the same `data-track-index` cannot overlap in time. This is enforced by the framework. If two clips need to overlap (for a crossfade), they must be on **different tracks**.

## Pattern: Crossfade

Two clips on separate tracks. The outgoing clip fades out while the incoming clip fades in during the overlap window.

```html
<!-- Outgoing clip: track 0, ends at 10s -->
<video
  id="el-1"
  data-start="0"
  data-duration="10"
  data-track-index="0"
  src="clip-a.mp4"
  muted
  playsinline
  style="z-index:1;"
></video>

<!-- Incoming clip: track 1, starts at 9s (1s overlap) -->
<video
  id="el-2"
  data-start="9"
  data-duration="15"
  data-track-index="1"
  src="clip-b.mp4"
  muted
  playsinline
  style="z-index:2;"
></video>
```

```js
// Fade out clip A during overlap
tl.to("#el-1", { opacity: 0, duration: 1, ease: "power2.inOut" }, 9);
// Fade in clip B during overlap
tl.fromTo("#el-2", { opacity: 0 }, { opacity: 1, duration: 1, ease: "power2.inOut" }, 9);
```

**Key rules:**

- The overlap window is `incoming.start` to `outgoing.end`
- Both clips must be on different tracks
- Use `z-index` to control which clip renders on top during the transition
- Animate `opacity` — do not animate `visibility` or `display`

## Pattern: Wipe / Reveal

An overlay composition that covers the frame, hides the cut, then reveals the new content.

```html
<!-- Clip A and Clip B are sequential on track 0 -->
<video
  id="el-1"
  data-start="0"
  data-duration="10"
  data-track-index="0"
  src="clip-a.mp4"
  muted
  playsinline
></video>
<video
  id="el-2"
  data-start="10"
  data-duration="15"
  data-track-index="0"
  src="clip-b.mp4"
  muted
  playsinline
></video>

<!-- Wipe overlay on track 3, spans the cut point -->
<div
  id="wipe-comp"
  data-composition-id="wipe"
  data-composition-src="compositions/wipe.html"
  data-start="9"
  data-duration="2"
  data-track-index="3"
  data-width="1920"
  data-height="1080"
  style="z-index:100;"
></div>
```

Wipe composition (`compositions/wipe.html`):

```html
<template id="wipe-template">
  <div data-composition-id="wipe" data-width="1920" data-height="1080">
    <div
      id="wipe-bar"
      style="
      position:absolute; top:0; left:0;
      width:1920px; height:1080px;
      background:#111; transform:translateX(-100%);
    "
    ></div>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      const tl = gsap.timeline({ paused: true });
      // Sweep in from left, covering the frame
      tl.to("#wipe-bar", { x: 0, duration: 0.5, ease: "power3.inOut" }, 0.5);
      // Hold for a beat while the cut happens underneath
      // Sweep out to the right, revealing new content
      tl.to("#wipe-bar", { x: 1920, duration: 0.5, ease: "power3.inOut" }, 1.2);
      window.__timelines["wipe"] = tl;
    </script>
  </div>
</template>
```

**Key rules:**

- The wipe composition spans the cut point (starts before the cut, ends after)
- The wipe must have a high `z-index` to render above both clips
- Clips can be on the same track (no overlap) since the wipe covers the hard cut
- Time the wipe so the frame is fully covered at the exact cut point

## Pattern: Scanline Sweep

A partial-frame element sweeps across, creating a stylized transition.

```js
const tl = gsap.timeline({ paused: true });

// Scanline starts above frame, sweeps down
tl.fromTo("#scanline", { y: -320 }, { y: 1920, duration: 1.5, ease: "power3.inOut" }, 0);
```

Style the scanline with gradients, glow, or accent colors for visual interest.

## Constraints

- **Transitions are compositions.** Wrap transition elements in a composition with `data-composition-id`. Do not use bare divs without data attributes.
- **Do not animate video element dimensions.** If you need to scale video during a transition, animate a wrapper div.
- **Use GSAP, not CSS transitions.** CSS transitions are not deterministic in the renderer.
- **Deterministic.** No `Math.random()`, no `Date.now()`.
- **Transitions must not affect media playback.** Never call `play()`, `pause()`, or set `currentTime`. The framework owns media.
- **Keep transitions short.** 0.3s–1.5s. Longer transitions feel sluggish in rendered video.

## Timing with Relative References

Use relative `data-start` to keep transitions aligned when clip durations change:

```html
<video
  id="intro"
  data-start="0"
  data-duration="10"
  data-track-index="0"
  src="..."
  muted
  playsinline
></video>

<!-- Transition starts 1s before intro ends -->
<div
  id="wipe-comp"
  data-composition-id="wipe"
  data-composition-src="compositions/wipe.html"
  data-start="intro - 1"
  data-duration="2"
  data-track-index="3"
  data-width="1920"
  data-height="1080"
  style="z-index:100;"
></div>

<video
  id="main"
  data-start="intro"
  data-duration="20"
  data-track-index="0"
  src="..."
  muted
  playsinline
></video>
```

If `intro`'s duration changes, the wipe and `main` shift automatically.

## Anti-Patterns

- **Overlapping clips on the same track.** Framework will reject this. Use different tracks for crossfades.
- **CSS `transition` property.** Not deterministic in headless rendering. Use GSAP.
- **Animating `display` property.** Use `opacity` instead.
- **Transitions longer than 2s.** Feels slow in video.
