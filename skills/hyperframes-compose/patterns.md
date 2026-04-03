# Composition Patterns

## Picture-in-Picture (Video in a Frame)

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

## Title Card with Fade

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

## Slide Show with Section Headers

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

## Reusable Components (data-props)

Write a composition once, use it N times with different data. Avoids copy-pasting HTML for repeated elements like cards, team members, or chart bars.

**Component file (compositions/stat-card.html):**

```html
<template id="stat-card-template">
  <div data-composition-id="stat-card" data-width="1920" data-height="1080">
    <style>
      .stat-value { font-size: 120px; font-weight: 900; color: {{color}}; }
      .stat-label { font-size: 32px; color: #fff; }
    </style>
    <div class="stat-value" id="val-inner">{{value}}</div>
    <div class="stat-label" id="lbl-inner">{{label}}</div>
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      tl.from("#val-inner", { opacity: 0, scale: 0.5, duration: 0.8, ease: "back.out(2)" }, 0.2);
      tl.from("#lbl-inner", { opacity: 0, y: 20, duration: 0.5 }, 0.6);
      window.__timelines["stat-card"] = tl;
    </script>
  </div>
</template>
```

**Root (index.html) — 3 instances:**

```html
<div
  class="clip"
  data-composition-id="revenue"
  data-composition-src="compositions/stat-card.html"
  data-props='{"value":"$2.4M","label":"Revenue","color":"#22c55e"}'
  data-start="0"
  data-duration="3"
  data-track-index="1"
></div>

<div
  class="clip"
  data-composition-id="users"
  data-composition-src="compositions/stat-card.html"
  data-props='{"value":"14K","label":"Active Users","color":"#3b82f6"}'
  data-start="3"
  data-duration="3"
  data-track-index="1"
></div>

<div
  class="clip"
  data-composition-id="nps"
  data-composition-src="compositions/stat-card.html"
  data-props='{"value":"72","label":"NPS Score","color":"#f59e0b"}'
  data-start="6"
  data-duration="3"
  data-track-index="1"
></div>
```

**Key:** Each host needs a unique `data-composition-id`. The `{{key}}` placeholders work in HTML, CSS, and scripts.
