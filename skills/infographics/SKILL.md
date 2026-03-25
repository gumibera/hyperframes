---
name: infographics
description: Design and animate professional infographic compositions in HyperFrames. Use when a composition needs stats, comparisons, processes, timelines, or any data visualization with clean design and contextual animation.
---

# Infographics

Design and animate professional infographic compositions with clean typography, intentional layout, and animations that reinforce the data story.

## When to Use

- Composition mentions stats, percentages, numbers, or comparisons
- Content describes a process, timeline, hierarchy, or flow
- User asks for "infographic", "data visualization", or "stats overlay"
- The narrative has quantitative claims that benefit from visual reinforcement

## Design Principles

### Typography Hierarchy

Every infographic has exactly three levels:

1. **Hero number/stat** — the largest element, the thing you see first. 120-280px. Bold weight.
2. **Label/title** — what the number means. 24-48px. Medium weight. Muted color.
3. **Supporting context** — comparison, source, timeframe. 16-24px. Light weight or dimmed.

```css
.stat-hero {
  font-size: 200px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
}
.stat-label {
  font-size: 36px;
  font-weight: 500;
  opacity: 0.7;
  letter-spacing: 0.02em;
}
.stat-context {
  font-size: 20px;
  font-weight: 400;
  opacity: 0.5;
}
```

### Layout Rules

- **One idea per frame.** Don't combine unrelated stats. Each infographic composition shows one concept.
- **Grid-aligned.** Use an invisible grid (margins: 80px, gutters: 40px). Elements snap to grid lines.
- **Generous whitespace.** At least 30% of the frame should be empty. Cramped layouts look amateur.
- **Left-aligned or centered.** Never right-aligned unless the layout demands it (RTL, split-screen right panel).
- **Consistent margins.** 80px from all edges minimum. Content never touches the frame edge.

### Color

- **Two colors maximum** per infographic — one for the hero element, one for everything else.
- **Accent color for the stat.** The number/bar/chart gets the accent. Labels and context stay neutral.
- **Dark backgrounds for video overlays.** Use `rgba(0,0,0,0.85)` or solid `#111` — never pure black.
- **No gradients, no shadows, no glows.** Flat, clean, confident.

### What NOT to Do

- No clip art, icons-for-decoration, or stock imagery
- No rounded-everything — use sharp corners or very subtle radius (4-8px max)
- No borders around stats — the typography IS the design
- No more than 3 colors in a single frame
- No center-of-screen placement for everything — use intentional asymmetry
- No decorative animation — every movement communicates something

## Infographic Types

### Single Stat

The most common. One number, one label, optional context.

```html
<div
  class="stat-frame"
  style="
  position:absolute; inset:0;
  display:flex; flex-direction:column;
  align-items:flex-start; justify-content:center;
  padding: 0 160px;
"
>
  <span
    class="stat-hero"
    id="stat-num"
    style="
    font-family:'Inter',sans-serif; font-size:200px; font-weight:800;
    color:#ffffff; letter-spacing:-0.04em; line-height:1;
  "
    >0%</span
  >
  <span
    class="stat-label"
    style="
    font-family:'Inter',sans-serif; font-size:36px; font-weight:500;
    color:rgba(255,255,255,0.6); margin-top:16px; letter-spacing:0.02em;
  "
    >increase in engagement</span
  >
</div>
```

### Comparison (Side-by-Side)

Two stats contrasted. Use a vertical divider or spatial separation.

```html
<div style="position:absolute;inset:0;display:flex;">
  <!-- Left stat -->
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;">
    <span id="stat-before" style="font-size:160px;font-weight:800;color:rgba(255,255,255,0.4);"
      >12%</span
    >
    <span style="font-size:28px;color:rgba(255,255,255,0.4);margin-top:12px;">Before</span>
  </div>
  <!-- Divider -->
  <div style="width:2px;background:rgba(255,255,255,0.1);margin:120px 0;"></div>
  <!-- Right stat -->
  <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;">
    <span id="stat-after" style="font-size:160px;font-weight:800;color:#ffffff;">47%</span>
    <span style="font-size:28px;color:rgba(255,255,255,0.6);margin-top:12px;">After</span>
  </div>
</div>
```

### Bar Chart

Horizontal bars. The bar width IS the data.

```html
<div style="position:absolute;top:50%;left:160px;right:160px;transform:translateY(-50%);">
  <div class="bar-row" style="margin-bottom:32px;">
    <span style="font-size:20px;color:rgba(255,255,255,0.6);display:block;margin-bottom:8px;"
      >Desktop</span
    >
    <div style="display:flex;align-items:center;gap:16px;">
      <div id="bar-1" style="height:48px;width:0%;background:#ffffff;border-radius:4px;"></div>
      <span id="bar-1-label" style="font-size:32px;font-weight:700;color:#ffffff;opacity:0;"
        >72%</span
      >
    </div>
  </div>
  <div class="bar-row">
    <span style="font-size:20px;color:rgba(255,255,255,0.6);display:block;margin-bottom:8px;"
      >Mobile</span
    >
    <div style="display:flex;align-items:center;gap:16px;">
      <div
        id="bar-2"
        style="height:48px;width:0%;background:rgba(255,255,255,0.3);border-radius:4px;"
      ></div>
      <span
        id="bar-2-label"
        style="font-size:32px;font-weight:700;color:rgba(255,255,255,0.6);opacity:0;"
        >34%</span
      >
    </div>
  </div>
</div>
```

### Progress / Meter

A single horizontal line that fills. Good for "X out of Y" or percentage completion.

```html
<div style="position:absolute;bottom:200px;left:160px;right:160px;">
  <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;">
    <span style="font-size:24px;color:rgba(255,255,255,0.5);">Progress</span>
    <span id="progress-label" style="font-size:48px;font-weight:800;color:#ffffff;">0%</span>
  </div>
  <div
    style="width:100%;height:8px;background:rgba(255,255,255,0.1);border-radius:4px;overflow:hidden;"
  >
    <div
      id="progress-fill"
      style="width:0%;height:100%;background:#ffffff;border-radius:4px;"
    ></div>
  </div>
</div>
```

### Process / Steps

Numbered steps with a connecting line. Show one step at a time or reveal sequentially.

```html
<div style="position:absolute;top:50%;left:160px;right:160px;transform:translateY(-50%);">
  <div
    class="step"
    id="step-1"
    style="display:flex;align-items:flex-start;gap:24px;margin-bottom:48px;opacity:0;"
  >
    <span style="font-size:64px;font-weight:800;color:rgba(255,255,255,0.15);line-height:1;"
      >01</span
    >
    <div>
      <span style="font-size:32px;font-weight:700;color:#ffffff;display:block;">Capture</span>
      <span style="font-size:20px;color:rgba(255,255,255,0.5);display:block;margin-top:4px;"
        >Record your content</span
      >
    </div>
  </div>
  <div
    class="step"
    id="step-2"
    style="display:flex;align-items:flex-start;gap:24px;margin-bottom:48px;opacity:0;"
  >
    <span style="font-size:64px;font-weight:800;color:rgba(255,255,255,0.15);line-height:1;"
      >02</span
    >
    <div>
      <span style="font-size:32px;font-weight:700;color:#ffffff;display:block;">Edit</span>
      <span style="font-size:20px;color:rgba(255,255,255,0.5);display:block;margin-top:4px;"
        >Compose in HyperFrames</span
      >
    </div>
  </div>
  <div class="step" id="step-3" style="display:flex;align-items:flex-start;gap:24px;opacity:0;">
    <span style="font-size:64px;font-weight:800;color:rgba(255,255,255,0.15);line-height:1;"
      >03</span
    >
    <div>
      <span style="font-size:32px;font-weight:700;color:#ffffff;display:block;">Publish</span>
      <span style="font-size:20px;color:rgba(255,255,255,0.5);display:block;margin-top:4px;"
        >Render and share</span
      >
    </div>
  </div>
</div>
```

## Animation Patterns

Every animation serves one of three purposes: **reveal**, **emphasize**, or **connect**. If an animation doesn't do one of these, remove it.

### Count-Up (for numbers)

The number counts from 0 to its final value. This IS the reveal — don't also fade in.

```js
// Count from 0 to 47
const target = { val: 0 };
tl.to(
  target,
  {
    val: 47,
    duration: 1.2,
    ease: "power2.out",
    onUpdate: () => {
      document.getElementById("stat-num").textContent = Math.round(target.val) + "%";
    },
  },
  startTime,
);
```

- **Duration:** 0.8-1.5s depending on the magnitude of the number
- **Ease:** `power2.out` — fast start, gentle land. The number "arrives" at its value.
- **Never linear.** Linear count-up feels mechanical.

### Bar Growth (for bar charts)

Bars grow from 0% to their target width. Stagger each bar.

```js
tl.to("#bar-1", { width: "72%", duration: 0.8, ease: "power3.out" }, startTime);
tl.to("#bar-1-label", { opacity: 1, duration: 0.3 }, startTime + 0.6);

tl.to("#bar-2", { width: "34%", duration: 0.8, ease: "power3.out" }, startTime + 0.2);
tl.to("#bar-2-label", { opacity: 1, duration: 0.3 }, startTime + 0.8);
```

- **Stagger:** 0.15-0.25s between bars
- **Label appears** near the end of the bar's growth, not simultaneously
- **Ease:** `power3.out` — bars decelerate as they reach their target

### Progress Fill

The fill bar and the label count up in sync.

```js
const progress = { val: 0 };
tl.to(
  progress,
  {
    val: 78,
    duration: 1.5,
    ease: "power2.inOut",
    onUpdate: () => {
      document.getElementById("progress-fill").style.width = progress.val + "%";
      document.getElementById("progress-label").textContent = Math.round(progress.val) + "%";
    },
  },
  startTime,
);
```

### Entrance Choreography

Elements enter in reading order: top-to-bottom, primary-to-secondary. The hero element enters first, supporting elements follow.

```js
// 1. Hero stat enters (the thing you see first)
tl.fromTo(
  "#stat-num",
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.5, ease: "power3.out" },
  startTime,
);

// 2. Label follows (explains what the number means)
tl.fromTo(
  ".stat-label",
  { opacity: 0, y: 20 },
  { opacity: 1, y: 0, duration: 0.4, ease: "power3.out" },
  startTime + 0.15,
);

// 3. Context last (supporting detail)
tl.fromTo(
  ".stat-context",
  { opacity: 0 },
  { opacity: 1, duration: 0.3, ease: "power2.out" },
  startTime + 0.3,
);
```

- **Stagger:** 0.1-0.2s between hierarchy levels
- **Direction:** `y: 20-30` (subtle upward movement). Never from the sides for stats.
- **Duration:** decreases with hierarchy — hero 0.5s, label 0.4s, context 0.3s
- **Ease:** `power3.out` for primary, `power2.out` for secondary

### Exit

Clean, fast, uniform. All elements exit together — don't reverse the entrance choreography.

```js
tl.to(".stat-frame", { opacity: 0, duration: 0.3, ease: "power2.in" }, exitTime);
```

- **Duration:** 0.2-0.4s. Exits are faster than entrances.
- **No y movement on exit.** Just fade. The next frame takes over.

### Sequential Steps

Each step enters one at a time, synchronized to narration.

```js
steps.forEach((step, i) => {
  // Step number gets accent color when active
  tl.to(step.el, { opacity: 1, duration: 0.4, ease: "power2.out" }, step.startTime);
  tl.to(step.numberEl, { color: accentColor, duration: 0.3 }, step.startTime);

  // Previous step dims
  if (i > 0) {
    tl.to(steps[i - 1].el, { opacity: 0.3, duration: 0.3 }, step.startTime);
    tl.to(steps[i - 1].numberEl, { color: dimColor, duration: 0.3 }, step.startTime);
  }
});
```

### Comparison Reveal

Show both sides, but reveal the "after" with emphasis.

```js
// "Before" appears first, muted
tl.fromTo("#stat-before", { opacity: 0 }, { opacity: 1, duration: 0.4 }, startTime);

// Pause for the viewer to register "before"
// "After" enters with more energy
tl.fromTo(
  "#stat-after",
  { opacity: 0, scale: 0.8 },
  { opacity: 1, scale: 1, duration: 0.5, ease: "back.out(1.4)" },
  startTime + 0.6,
);
```

## Timing to Narration

Infographics must sync to the spoken content. The stat appears when the narrator says the number.

```js
// Transcript: "...engagement increased by forty-seven percent..."
// "forty-seven" starts at 3.2s, "percent" ends at 3.9s
// Start count-up at 3.2s, land at 3.9s
const STAT_START = 3.2;
const STAT_LAND = 3.9;

tl.to(
  target,
  {
    val: 47,
    duration: STAT_LAND - STAT_START,
    ease: "power2.out",
    onUpdate: () => {
      el.textContent = Math.round(target.val) + "%";
    },
  },
  STAT_START,
);
```

- **Stat appears** when the narrator starts saying the number
- **Stat lands** (finishes counting) when the narrator finishes saying it
- **Label appears** immediately after the stat lands
- **Exit** when the narrator moves to the next topic (or 1-2s after if there's a pause)

## Composition Structure

Each infographic is its own composition file:

```html
<template id="stat-47-template">
  <div data-composition-id="stat-47" data-width="1920" data-height="1080">
    <!-- Layout HTML here -->

    <style>
      [data-composition-id="stat-47"] {
        /* scoped styles */
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        // Animations here
        window.__timelines["stat-47"] = tl;
      })();
    </script>
  </div>
</template>
```

Load in the root composition:

```html
<div
  id="el-stat-47"
  data-composition-id="stat-47"
  data-composition-src="compositions/stat-47.html"
  data-start="3"
  data-duration="5"
  data-track-index="4"
  data-width="1920"
  data-height="1080"
  style="z-index:30;"
></div>
```

## Constraints

- **Deterministic.** No `Math.random()`, no `Date.now()`.
- **Register timeline.** `window.__timelines["composition-id"] = tl;`
- **Scoped CSS.** `[data-composition-id="..."]` prefix on all selectors.
- **One infographic per composition.** Don't pack multiple stats into one file.
- **Count-up uses `onUpdate`.** This is the one place callback-driven animation is appropriate. The callback must be deterministic (same input → same display at any given time).
- **Font loading.** Include `@import url(...)` in the composition's `<style>` block. Don't rely on the parent loading fonts.
- **Dark backgrounds for overlays.** If the infographic overlays video, use a semi-transparent or solid dark background so text is readable.
