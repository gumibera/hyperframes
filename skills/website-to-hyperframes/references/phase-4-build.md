# Phase 4: Build Reference

You are a senior HyperFrames engineer. A client — the creative director from Phase 3 — has handed you a video plan: scene-by-scene descriptions, a narration script, and a timing breakdown. Your job is to execute it at 200% quality. The bar is not "working video." The bar is: a viewer watches it and asks "how did they make this from just a URL?"

---

## The Scaffold Is Pre-Wired

The root `index.html` already contains:

- **Cross-Warp Morph shader transition** (default — the most versatile shader in the kit)
- **WebGL canvas** with scene texture capture and a transition state machine
- **GSAP timeline setup** (`window.__timelines`)
- **Scene slots** with sequential `data-start` / `data-duration` attributes
- **Narration audio element** wired to the root track
- **Captions slot** on a parallel overlay track

Do not rebuild any of this. Start by reading `index.html` from top to bottom to understand the scene count, durations, and existing wiring — then fill in the scene compositions.

**To use a different shader:** find the `FRAG_SHADER` variable in `index.html` and replace it with the GLSL source from `skills/hyperframes/references/transitions/shader-transitions.md`. If the new shader uses `ND` noise instead of `NQ`, also swap the noise library variable declared just above it.

---

## How to Wire Transitions

Transitions between scenes are orchestrated in the root `index.html` `<script>` block — not inside individual scene compositions. Each transition starts 0.6s before the outgoing scene ends, so the two scenes overlap briefly during the blend.

```javascript
// Wire transitions between scenes (in the root index.html <script>)
// Transition starts 0.6s before scene ends, so scenes overlap during the blend

tl.call(function() { beginTrans("scene-1", "scene-2"); }, null, 6.4);
tl.to(trans, { progress: 1, duration: 0.6, ease: "power2.inOut",
  onComplete: function() { endTrans("scene-2"); } }, 6.4);

tl.call(function() { beginTrans("scene-2", "scene-3"); }, null, 13.4);
tl.to(trans, { progress: 1, duration: 0.6, ease: "power2.inOut",
  onComplete: function() { endTrans("scene-3"); } }, 13.4);
```

Adjust the timestamps to match your actual scene durations from the narration plan. If scene 1 runs 0–7s, the transition call goes at `6.4`. If scene 2 runs 7–14s, the next call goes at `13.4`.

---

## Asset Plan Per Scene

Before writing a single line of HTML, create a written asset plan. Do this for every scene.

For each scene, list:

- Every local file from `assets/` you will embed (images, SVGs, fonts, Lottie files)
- Every remote URL from `assets-catalog.json` you will reference
- Which DESIGN.md tokens (colors, fonts, spacing) govern the scene

If a scene uses zero captured assets, write one sentence explaining why — it is a deliberate creative choice, not an oversight. Scenes that don't use any captured assets are the exception, not the norm. If the capture has an asset for something, use it.

---

## Scene Composition Rules

These are constraints, not suggestions:

- **EXACT colors from DESIGN.md** — paste the HEX values directly. Do not approximate.
- **EXACT fonts via @font-face** — use URLs from the assets catalog or local font files from `assets/fonts/`. Match the weights declared in DESIGN.md.
- **Real SVG logos from `assets/svgs/`** — use as many as are appropriate. Do not substitute text placeholders.
- **Reference assets with `../assets/` paths** — compositions live one level deep inside `compositions/`, so paths go up one level.
- **Remote URLs from `assets-catalog.json` work directly** in compositions with `crossorigin="anonymous"`. No download needed.

---

## How to Reference Assets

```html
<!-- Local image -->
<img src="../assets/image-0.png" crossorigin="anonymous" />

<!-- Local SVG -->
<img src="../assets/svgs/logo-0.svg" />

<!-- Local font -->
<style>
@font-face {
  font-family: "BrandFont";
  src: url("../assets/fonts/FontName.woff2") format("woff2");
  font-weight: 400;
  font-display: block;
}
</style>

<!-- Remote image from assets-catalog.json -->
<img src="https://example.com/product-screenshot.jpg" crossorigin="anonymous" />

<!-- Lottie animation -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
<div id="anim" style="width:400px;height:400px;"></div>
<script>
lottie.loadAnimation({
  container: document.getElementById("anim"),
  renderer: "svg", loop: false, autoplay: false,
  path: "../assets/lottie/animation-0.json"
});
</script>
```

---

## Wire the Audio

- **Narration:** `narration.wav` is already loaded as an `<audio>` element on the root track in the scaffold. Do not move it.
- **Captions:** Create `compositions/captions.html` as a sub-composition on a parallel overlay track. It should span the full video duration and use word-level timestamps from the transcript.
- **Scene durations must match the narration.** If the narrator says "three tools" between 4.2s and 6.8s, your scene 2 must cover that window exactly. Off-by-one timing makes captions drift and transitions fire on the wrong words.

---

## Every Element Must Move

A still image on a still background is not a video — it is a JPEG with a progress bar. Every visible element must have continuous mid-scene activity. Entrances are not enough.

| Element type | Mid-scene activity |
|---|---|
| Image / screenshot | Slow zoom (scale 1→1.03 over scene duration), or slow pan, or Ken Burns |
| Stat / number | Counter animates from 0 to target with `onUpdate` callback |
| Code block | Lines reveal one by one with stagger, cursor blinks |
| Logo grid | Subtle shimmer sweep across logos, or gentle scale pulse (1→1.02→1) |
| Any persistent element | Subtle float (y ±4-6px, sine.inOut, yoyo) or glow pulse |

**Calculate repeats from scene duration — never use `repeat: -1`.** Example: a 5s scene with a 2s float cycle needs `repeat: Math.ceil(5 / 2) - 1`.

---

## Critical Rules (Non-Negotiable)

These rules exist because the capture engine is deterministic. Violations produce broken or non-renderable output.

**`repeat: -1` is forbidden.** The capture engine seeks to specific timestamps. An infinite loop makes a timeline unseekable. Calculate the exact repeat count from your scene duration.

**`Math.random()` is forbidden.** Two seeks to the same frame must produce identical output. Use a seeded PRNG when you need pseudo-randomness:

```javascript
// mulberry32 — seeded, deterministic
function mulberry32(seed) {
  return function() {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
var rand = mulberry32(42);
```

**Register every timeline.** Every composition must do this exactly:

```javascript
window.__timelines = window.__timelines || {};
window.__timelines["comp-id"] = tl; // match the id= attribute on the root element
```

**Timeline construction must be synchronous.** Do not wrap timeline setup in `async` functions, `Promise.then`, `fetch.then`, or `setTimeout`. Build the timeline inline, at script execution time.

**Minimum font sizes:** 20px for body text, 16px for data labels. Sub-14px text becomes unreadable after H.264 encoding, especially at dark edge transitions.

**No full-screen dark linear gradients.** H.264 creates visible color banding in large flat-gradient regions. Use a solid background color and layer localized radial glows on top instead.

**Scenes with shader transitions do not fade to/from black.** The shader handles the visual blend. Do not add fade-in or fade-out animations to scene backgrounds — they will fight the shader and produce a double-dissolve artifact.

---

## Verify and Deliver

Run these three commands in sequence. Fix all errors before proceeding to the next step.

```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes preview
```

`lint` checks HTML structure statically. `validate` loads the composition in headless Chrome and catches runtime JS errors, missing assets, and failed network requests. `preview` opens the studio — only run this after both checks pass.

**Sanity check before previewing:** Open `index.html` and confirm that `gl.createShader` and `beginTrans` are both present. If either is missing, the scaffold was overwritten or the file was created from scratch instead of edited. Recover the scaffold.

---

