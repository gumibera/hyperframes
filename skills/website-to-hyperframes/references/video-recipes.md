# Video Reference Patterns

Technical patterns and creative tools for building compositions. These are building blocks — not templates. The video's structure should come from the creative director step (Step 4), driven by the brand and content.

## Architecture

**Every scene = a separate sub-composition file** in `compositions/`. Root `index.html` loads each scene on the same track with sequential `data-start` values.

```
project/
├── index.html                         ← root: loads scenes + transitions + audio
└── compositions/
    ├── scene1.html
    ├── scene2.html
    ├── scene3.html
    └── captions.html                  ← word-level captions overlay
```

## Scene Transitions

### With Shader Transitions (recommended for 15s+ videos)

When using shader transitions, scenes DON'T fade to/from black. The shader handles the visual blend between scenes. This means:

- Each scene starts at **full opacity** (no fade-in from black)
- Each scene ends at **full opacity** (no fade-out to black)
- Scene GSAP timelines only handle entrances for internal elements + mid-scene activity
- No exit animations needed — the shader dissolves this scene into the next

```javascript
// Scene with shader transitions — NO fade in/out of the background
var dur = 5;
var tl = gsap.timeline({ paused: true });

// Background is immediately visible (scene texture needs content to capture)
gsap.set("#scene-bg", { opacity: 1 });

// === ELEMENTS ENTER ===
tl.fromTo(
  "#headline",
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" },
  0.1,
);
tl.fromTo(
  "#hero-img",
  { opacity: 0, scale: 1.1 },
  { opacity: 1, scale: 1, duration: 0.6, ease: "power3.out" },
  0.2,
);

// === MID-SCENE ACTIVITY (keep it alive — required) ===
tl.to("#hero-img", { scale: 1.03, duration: dur, ease: "sine.inOut" }, 0);

// === NO EXIT — shader transition handles the handoff to next scene ===
```

The root `index.html` orchestrates transitions between scenes:

1. Show scene 1 (via passthrough shader rendering scene texture)
2. At transition point: `beginTrans(shaderProg, "scene1", "scene2")`
3. GSAP tweens `trans.progress` from 0→1 over transition duration (0.3-0.8s)
4. `endTrans("scene2")` — now showing scene 2

Read `references/transitions/shader-setup.md` for the complete WebGL boilerplate and `references/transitions/shader-transitions.md` for the 14 available fragment shaders.

### Without Shader Transitions (simple fade cuts)

For very short videos (<10s) or when minimal simplicity is the creative intent, use the fade-to-black pattern:

```javascript
var dur = 5;
var tl = gsap.timeline({ paused: true });

// === ENTRANCE (first 0.3s) ===
tl.fromTo("#scene-bg", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0);
tl.fromTo(
  "#headline",
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" },
  0.15,
);

// === MAIN CONTENT (middle) ===
// ... your animations here ...

// === EXIT (last 0.3s) ===
tl.to("#headline", { opacity: 0, duration: 0.2, ease: "power1.in" }, dur - 0.35);
tl.to("#scene-bg", { opacity: 0, duration: 0.3, ease: "power2.in" }, dur - 0.3);
```

Root `body { background: #000 }` ensures the gap between scenes is black.

## Caption Safe Zone

**Bottom 120px is reserved for captions.** No scene content below y=960px. The captions sub-composition sits on track 2 as a full-duration overlay occupying this space.

## Elements Must DO Something (Not Just Sit There)

**The #1 difference between a video and a slideshow is continuous motion.** Every visible element should have mid-scene activity — not just an entrance and exit.

### Mid-Scene Activity Ideas

Every element MUST have at least one continuous animation during its hold phase:

| Element type           | Mid-scene activity                                                                |
| ---------------------- | --------------------------------------------------------------------------------- |
| Image / screenshot     | Slow zoom (scale 1→1.03 over scene duration), or slow pan (x drift), or Ken Burns |
| Stat / number          | Counter animates from 0 to target with `onUpdate` callback                        |
| Code block             | Lines reveal one by one with stagger, cursor blinks                               |
| Chart / bars           | Bars grow to target heights with elastic ease, values tick up alongside           |
| Logo grid              | Subtle shimmer sweep across each, or gentle scale pulse (1→1.02→1)                |
| Progress / fill        | Fills from 0% to target, percentage text updates live                             |
| Any persistent element | Subtle float (y ±4-6px, sine.inOut, yoyo) or glow pulse                           |

### Counter Animation Pattern

```javascript
var obj = { val: 0 };
var statEl = document.querySelector("#stat-num");
tl.to(
  obj,
  {
    val: 135,
    duration: 1.5,
    ease: "power2.out",
    onUpdate: function () {
      statEl.textContent = Math.round(obj.val) + "+";
    },
  },
  0.5,
);
```

### Floating/Breathing Pattern

```javascript
// Subtle float — makes static elements feel alive
// Never use repeat: -1 — infinite loops break the capture engine.
// Calculate repeats from scene duration:
var sceneDur = 5; // match your data-duration
tl.to(
  "#card",
  { y: "-=6", duration: 2, ease: "sine.inOut", yoyo: true, repeat: Math.ceil(sceneDur / 2) - 1 },
  0,
);
```

### Line-by-Line Reveal Pattern

```javascript
tl.fromTo(
  ".code-line",
  { opacity: 0, y: 8 },
  { opacity: 1, y: 0, duration: 0.3, stagger: 0.4, ease: "power2.out" },
  0.5,
);
// Blinking cursor — never use repeat: -1
var cursorStart = 2.5;
var cursorCycle = 1;
tl.fromTo(
  "#cursor",
  { opacity: 1 },
  {
    opacity: 0,
    duration: 0.5,
    repeat: Math.ceil((sceneDur - cursorStart) / cursorCycle) - 1,
    yoyo: true,
  },
  cursorStart,
);
```

## Visual Enhancement Tools

These separate "AI-generated video" from "actually good video." Use 1-2 per composition.

### Rough.js — Hand-Drawn Elements

```html
<script src="https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.min.js"></script>
<svg
  id="rough-canvas"
  width="1920"
  height="1080"
  style="position:absolute;top:0;left:0;pointer-events:none"
></svg>
```

```javascript
var rc = rough.svg(document.getElementById("rough-canvas"));
var node = rc.circle(960, 400, 200, {
  stroke: "#635BFF",
  strokeWidth: 3,
  roughness: 1.2,
  bowing: 2,
  fill: "none",
});
document.getElementById("rough-canvas").appendChild(node);

var paths = node.querySelectorAll("path");
paths.forEach(function (p) {
  var len = p.getTotalLength();
  p.style.strokeDasharray = len;
  p.style.strokeDashoffset = len;
});
tl.to(paths, { strokeDashoffset: 0, duration: 0.8, ease: "power2.out", stagger: 0.1 }, 2.0);
```

Shapes: `rc.circle()`, `rc.rectangle()`, `rc.line()`, `rc.arc()`. Roughness: 0.8 = clean, 1.2 = hand-drawn, 2.0 = sketchy.

### Marker-Highlight — Text Emphasis

Five modes: `highlight` (marker sweep), `circle` (drawn around word), `burst` (radiating lines), `scribble` (cross-out), `sketchout` (rough rectangle). See `/hyperframes` skill's marker-highlight reference.

```javascript
tl.call(
  function () {
    highlighter.clearMarks();
    highlighter.reanimateMark("stat-highlight");
  },
  null,
  3.0,
);
```

### SVG Stroke Animation — Path Drawing

```javascript
var path = document.querySelector("#logo-path");
var length = path.getTotalLength();
path.style.strokeDasharray = length;
path.style.strokeDashoffset = length;
tl.to(path.style, { strokeDashoffset: 0, duration: 1.5, ease: "power2.out" }, 0.5);
```

## Using Captured Assets

- **SVG logos** → embed inline, animate with GSAP (fill, stroke, scale, path drawing)
- **Images** → use as hero visuals, backgrounds (with slow zoom), or layered elements
- **Fonts** (`assets/fonts/`) → load via @font-face, match exact weights from DESIGN.md
- **Lottie** (`assets/lottie/`) → embed via lottie.loadAnimation, seekable
- **Remote URLs** from assets-catalog.json → product screenshots, hero images load directly in compositions
