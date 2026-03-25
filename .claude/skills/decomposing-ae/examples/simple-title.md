# Simple Title Card Example

A worked example showing how a 2-layer AE composition (solid background + text with opacity keyframes) maps to HyperFrames output.

---

## JSON Input (from parse-aepx.py)

```json
{
  "name": "title-card",
  "width": 1920,
  "height": 1080,
  "frameRate": 30,
  "duration": 5.0,
  "layers": [
    {
      "index": 1,
      "name": "Title Text",
      "type": "text",
      "inPoint": 0.0,
      "outPoint": 5.0,
      "parentIndex": null,
      "textContent": "Welcome",
      "fontFamily": "Montserrat",
      "fontSize": 72,
      "fontColor": "#ffffff",
      "transform": {
        "anchorPoint": { "value": [960, 540, 0], "keyframes": null },
        "position": { "value": [960, 540, 0], "keyframes": null },
        "scale": { "value": [1, 1, 1], "keyframes": null },
        "rotation": { "value": 0, "keyframes": null },
        "opacity": {
          "value": 1,
          "keyframes": [
            { "time": 0.0, "value": 0, "easing": { "type": "linear" } },
            { "time": 0.5, "value": 1, "easing": { "type": "easeOut" } }
          ]
        }
      },
      "effects": [],
      "masks": [],
      "blendMode": "normal",
      "trackMatteType": null,
      "expression": null
    },
    {
      "index": 2,
      "name": "Background",
      "type": "solid",
      "inPoint": 0.0,
      "outPoint": 5.0,
      "parentIndex": null,
      "transform": {
        "anchorPoint": { "value": [960, 540, 0], "keyframes": null },
        "position": { "value": [960, 540, 0], "keyframes": null },
        "scale": { "value": [1, 1, 1], "keyframes": null },
        "rotation": { "value": 0, "keyframes": null },
        "opacity": { "value": 1, "keyframes": null }
      },
      "effects": [],
      "masks": [],
      "blendMode": "normal",
      "trackMatteType": null,
      "expression": null
    }
  ]
}
```

---

## HyperFrames Output (`compositions/title-card.html`)

```html
<template id="title-card-template">
  <div data-composition-id="title-card" data-width="1920" data-height="1080">
    <!-- Layer 2: Background (solid) — lower track -->
    <div
      id="ae-title-card-2"
      data-start="0"
      data-duration="5"
      data-track-index="0"
      style="position:absolute; left:0; top:0; width:1920px; height:1080px; background:#111; z-index:0;"
    ></div>

    <!-- Layer 1: Title Text — higher track (AE layer order: 1 = top) -->
    <div
      id="ae-title-card-1"
      data-start="0"
      data-duration="5"
      data-track-index="1"
      style="position:absolute; left:0; top:0; width:1920px; height:1080px;
             display:flex; align-items:center; justify-content:center; z-index:1;"
    >
      <span style="font-family:'Montserrat',sans-serif; font-size:72px; color:#ffffff; opacity:0;">
        Welcome
      </span>
    </div>

    <style>
      [data-composition-id="title-card"] * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
    </style>

    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      // Title Text opacity: fade in from 0 to 1 over 0.5s
      tl.to("#ae-title-card-1 span", { opacity: 1, duration: 0.5, ease: "power2.out" }, 0);

      window.__timelines["title-card"] = tl;
    </script>
  </div>
</template>
```

---

## Mapping Decisions

- **Solid → `<div>` with background**: No media source, just a colored rectangle
- **Text → `<div>` with styled `<span>`**: Font family, size, color from text data
- **Anchor/Position at center → centered with flexbox**: When anchor and position both equal comp center, use flex centering
- **Opacity keyframes → GSAP tween**: `linear` easing maps to `"none"`, `easeOut` maps to `"power2.out"`
- **Layer order → track-index**: AE layer 1 (top) gets higher track-index and z-index
- **Element IDs**: Pattern `ae-<comp-id>-<layer-index>`
- **CSS scoping**: `[data-composition-id="title-card"]` prefix
- **Timeline init**: `window.__timelines = window.__timelines || {}` before assigning
