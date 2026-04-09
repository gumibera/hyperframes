# Animation Recreation

How to use `extracted/animations.json` to recreate website animations in GSAP.

## Reading the Animation Catalog

The catalog has four data sources. Use them together:

### 1. Web Animations (`webAnimations`)

Full keyframe data from `document.getAnimations()`. Each entry has:

```json
{
  "type": "Animation",
  "targetSelector": "div.payments-graphic__terminal-pay-label-values",
  "keyframes": [
    { "offset": 0, "transform": "translateY(0%)" },
    { "offset": 0.7, "transform": "translateY(-100%)" },
    { "offset": 1, "transform": "translateY(-100%)" }
  ],
  "timing": {
    "duration": 1420,
    "delay": 4000,
    "iterations": 1,
    "easing": "linear",
    "direction": "normal"
  }
}
```

**Convert to GSAP:**

```javascript
tl.fromTo(
  "#target",
  { y: "0%" },
  { y: "-100%", duration: 1.42, delay: 4, ease: "none" },
  startTime,
);
```

### 2. Scroll Targets (`scrollTargets`)

Elements that had `IntersectionObserver` watching them — these are scroll-triggered animations:

```json
{
  "selector": "div.lazy-animation.lazy-bento-graphic",
  "rect": { "top": 1149, "height": 0, "width": 1392 }
}
```

**How to use:** These elements should have entrance animations that trigger when the scene plays. Use the `rect.top` value to determine which scene contains this element, then add a staggered entrance:

```javascript
tl.fromTo(
  "#bento-graphic",
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.6, ease: "back.out(1.3)" },
  0.5,
);
```

### 3. CSS Declarations (`cssDeclarations`)

Elements with `animation` or `transition` CSS properties:

```json
{
  "selector": "button.hds-button",
  "transition": { "property": "background-color, color, border", "duration": "0.3s" }
}
```

These are mostly hover effects — less useful for video. Focus on elements with `animation` (not just `transition`).

### 4. CDP Events (`cdpAnimations`)

Real-time animation events captured during page scroll. Useful for understanding the overall animation density and timing:

```json
{
  "type": "WebAnimation",
  "name": "",
  "duration": 325,
  "delay": 50
}
```

## Common Patterns

### Logo carousel (horizontal scroll)

If scroll targets include a `.logo-carousel` element, add a horizontal scroll animation:

```javascript
// Never use repeat: -1 — infinite loops break the capture engine.
// Calculate exact repeats from scene duration:
var sceneDuration = 8; // match your data-duration
tl.fromTo(
  "#logo-row",
  { x: 0 },
  { x: -200, duration: 8, ease: "none", repeat: Math.ceil(sceneDuration / 8) - 1 },
  0,
);
```

### Staggered card entrance

For bento grids or feature cards:

```javascript
tl.fromTo(
  ".feature-card",
  { opacity: 0, y: 40 },
  { opacity: 1, y: 0, duration: 0.5, stagger: 0.15, ease: "power2.out" },
  0.3,
);
```

### Counter animation

For stat numbers:

```javascript
var obj = { val: 0 };
tl.to(
  obj,
  {
    val: 135,
    duration: 1.5,
    ease: "power2.out",
    onUpdate: function () {
      document.querySelector("#stat").textContent = Math.round(obj.val) + "+";
    },
  },
  0.5,
);
```

### Typing effect

For code blocks or terminal mockups:

```javascript
tl.fromTo(
  ".code-line",
  { opacity: 0, y: 8 },
  { opacity: 1, y: 0, duration: 0.25, stagger: 0.3, ease: "power2.out" },
  0.5,
);
```
