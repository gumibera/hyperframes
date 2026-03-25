# Composition Patterns

## Picture-in-Picture (Video in a Frame)

Animate a wrapper div for position/size. The wrapper has NO data attributes.

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
  {
    top: 700,
    left: 1360,
    width: 500,
    height: 280,
    borderRadius: 16,
    duration: 1,
  },
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

## Slide Show

Separate elements on the same track auto-mount/unmount based on timing:

```html
<div class="slide" data-start="0" data-duration="30" data-track-index="3">...</div>
<div class="slide" data-start="30" data-duration="25" data-track-index="3">...</div>
<div class="slide" data-start="55" data-duration="20" data-track-index="3">...</div>
```

## Wrapping Dynamic Content

Script-animated content (captions, emojis, overlays) must live inside a composition.

**Wrong:**

```html
<!-- BAD: not a composition, won't appear in timeline -->
<div id="ui-layer">
  <div id="captions-container"></div>
</div>
```

**Right (external file):**

```html
<div
  id="captions-comp"
  data-composition-id="captions"
  data-composition-src="compositions/captions.html"
  data-start="0"
  data-duration="60"
  data-track-index="5"
  data-width="1920"
  data-height="1080"
></div>
```

**Right (inline):**

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
    window.__timelines = window.__timelines || {};
    const captionTL = gsap.timeline({ paused: true });
    // ...
    window.__timelines["captions"] = captionTL;
  </script>
</div>
```

## Complete Top-Level Composition

```html
<div
  id="comp-1"
  data-composition-id="my-video"
  data-start="0"
  data-duration="60"
  data-width="1920"
  data-height="1080"
>
  <video
    id="el-1"
    data-start="0"
    data-duration="10"
    data-track-index="0"
    src="intro.mp4"
    muted
    playsinline
  ></video>
  <video
    id="el-2"
    data-start="el-1"
    data-duration="8"
    data-track-index="0"
    src="main.mp4"
    muted
    playsinline
  ></video>
  <img id="el-3" data-start="5" data-duration="4" data-track-index="1" src="assets/logo.png" />
  <audio id="el-4" data-start="0" data-duration="30" data-track-index="2" src="intro.mp4" />

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

  <div
    id="el-6"
    data-composition-id="captions"
    data-composition-src="compositions/caption-overlay.html"
    data-start="0"
    data-duration="60"
    data-track-index="4"
    data-width="1920"
    data-height="1080"
  ></div>

  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    // Root timeline — framework auto-nests sub-compositions
    window.__timelines["my-video"] = tl;
  </script>
</div>
```
