---
name: decomposing-ae
description: Decomposes After Effects projects (.aepx files) into HyperFrames HTML compositions. Parses the AE project structure, maps layers/effects/keyframes to HTML/CSS/GSAP equivalents, and generates a complete ready-to-preview project. Use when converting AE templates, recreating motion graphics from After Effects, or porting AE animations to HyperFrames.
---

# Decomposing After Effects

This skill converts After Effects `.aepx` project files into HyperFrames HTML compositions. It parses the AE XML structure, maps layers/effects/keyframes to HTML/CSS/GSAP equivalents, and generates a complete, ready-to-preview project.

## When to Use

Use this skill when any of these trigger phrases appear:

- "convert AE template"
- "decompose After Effects"
- "port AE to HyperFrames"
- "recreate motion graphics"
- ".aepx file"

## Prerequisites

- `.aepx` file — After Effects XML project (exported via File > Save As > Save a Copy As XML in AE)
- Python 3 installed (ships with macOS, near-universal on dev machines)
- Asset files (video, audio, images) referenced by the project (if available)

## Workflow Checklist

Print this checklist at the start and check off each step as it completes:

```
Decomposition Progress:
- [ ] Step 1: Preprocess .aepx (run parse-aepx.py)
- [ ] Step 2: Analyze project structure
- [ ] Step 3: Plan the mapping
- [ ] Step 4: Generate compositions (leaves to root)
- [ ] Step 5: Assemble root composition
- [ ] Step 6: Verify and summarize
```

## Step Details

### Step 1: Preprocess

Run the parser script to extract structured JSON from the `.aepx` XML:

```bash
python3 .claude/skills/decomposing-ae/scripts/parse-aepx.py <path-to-aepx> > /tmp/ae-project.json
```

Read the output JSON. Check the `warnings` array for any unrecognized features before proceeding.

### Step 2: Analyze

- Identify the main render composition — usually in a "Final Comp" folder or the comp with the most layer/pre-comp references
- Build the composition dependency tree (which comps reference which)
- Count layers per comp and identify layer types (text, shape, footage, pre-comp, solid, null)
- List all footage items (video, image, audio) and font names used

### Step 3: Plan

- Consult [ae-mapping.md](ae-mapping.md) for all mapping tables
- Map AE effects to CSS filter, SVG filter, or GSAP equivalents
- Plan GSAP tweens for every keyframed property
- Convert AE easing to GSAP: Easy Ease → `"power2.inOut"`, Linear → `"none"`, Easy Ease In → `"power2.in"`, Easy Ease Out → `"power2.out"`
- Resolve layer parenting: children must be nested inside a parent wrapper `<div>`
- Convert coordinate system per ae-mapping.md (AE origin is top-left; anchor offsets apply)
- Convert `random()`/`wiggle()` expressions to deterministic equivalents (see Rules below)
- Output a brief plan summary before generating any files

### Step 4: Generate Compositions (leaves to root)

Process compositions in dependency order — leaf comps first, root comp last. For each composition, create `compositions/<comp-name>.html`.

Each composition file has four parts:

**1. Structure — HTML elements with data attributes**

- Assign IDs: `ae-<comp-id>-<layer-index>`
- Video layers → `<video muted playsinline>` with a separate `<audio>` element for the audio track
- Pre-comp layers → `<div>` with `data-composition-id`, `data-composition-src`, `data-duration`, `data-width`, `data-height`
- All layer elements must carry `data-start`, `data-duration`, `data-track-index`

**2. Styling — CSS scoped to composition**

- Scope all rules with `[data-composition-id="<id>"]` prefix
- Position: `left: posX - anchorX; top: posY - anchorY; transform-origin: anchorX anchorY`
- Blend modes → `mix-blend-mode`
- Effects → CSS `filter` or inline SVG `<filter>` elements

**3. Animation — GSAP timeline**

- Convert keyframes to GSAP tweens
- Use plugins as needed: `MotionPathPlugin`, `SplitText`, `MorphSVGPlugin`, `CustomEase`, `DrawSVGPlugin`
- Always initialize: `window.__timelines = window.__timelines || {};`
- Register timeline: `window.__timelines["<comp-id>"] = tl;`

**4. File format — template wrapper**

Wrap the entire composition in:

```html
<template id="<comp-id>-template">
  <!-- structure, style, script -->
</template>
```

### Step 5: Assemble Root Composition

Generate `index.html` at the project root:

- Root composition element with `data-composition-id`, `data-start="0"`, `data-duration`, `data-width`, `data-height`
- Sub-composition host elements must carry ALL of: `data-composition-id`, `data-composition-src`, `data-start`, `data-duration`, `data-track-index`, `data-width`, `data-height`
- `@font-face` declarations for all fonts used
- Root GSAP timeline

Final project structure:

```
<project-name>/
├── index.html
├── compositions/
├── fonts/
└── assets/
```

### Step 6: Verify and Summarize

Present a summary covering:

- Compositions generated (list with layer counts)
- Approximations made (effects, expressions, easing)
- Unsupported features encountered
- Asset and font requirements for playback

## Rules

These rules are mandatory and must be followed for every generated file:

- **Deterministic output** — never emit `Math.random()`, `Date.now()`, or any non-deterministic call. AE `random()` and `wiggle()` expressions must be converted to deterministic GSAP tweens or fixed CSS values.
- **No GSAP animation conflicts** — never animate the same CSS property on the same element from more than one timeline.
- **`data-duration` required** on all composition elements — both the host `<div>` and the composition root inside the template.
- **`data-width` and `data-height` required** on all composition elements.
- **`window.__timelines` guard** — always write `window.__timelines = window.__timelines || {}` before assigning to it.
- **Videos must be `muted playsinline`** — audio tracks go in a separate `<audio>` element.
- **Every top-level container must have `data-composition-id`** — no anonymous root elements.
- **CSS must be scoped** — all selectors prefixed with `[data-composition-id="<id>"]`.
- **Template wrapper required** — composition files use `<template id="<comp-id>-template">` as the outermost element.
- **No `!` non-null assertions** — use guards or fallbacks instead.

## Known Limitations (v1)

- **Time remapping** — not converted; pre-comps play at normal speed. Logged as a warning in the summary.
- **Complex expressions** — logged but not auto-converted. Manually interpret `wiggle`, `loopOut`, `linear`, `ease` where feasible and note approximations.
- **3D camera** — approximated with CSS `perspective` and `transform-style: preserve-3d`. Depth-of-field and camera blur are not supported.
- **Motion blur** — not supported. Fast-moving elements can be approximated with directional `filter: blur()` if desired.

## References

- [ae-mapping.md](ae-mapping.md) — AE to HyperFrames mapping tables and coordinate system conversion
- [aepx-structure.md](aepx-structure.md) — `.aepx` XML format reference
- [examples/simple-title.md](examples/simple-title.md) — Worked input/output example

$ARGUMENTS
