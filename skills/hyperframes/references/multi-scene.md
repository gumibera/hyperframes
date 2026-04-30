# Multi-Scene Build Pipeline

For compositions with 2 or more scenes, build in phases instead of one pass. A single pass produces shallow results — detail drops as context fills with boilerplate, and the authoring agent tends to under-decorate later scenes. Giving each scene its own subagent keeps per-scene density and decoration consistent.

Single-pass is reserved for true one-scene compositions: title cards, standalone overlays, single-clip animations.

This reference overrides the generic entrance-animation guidance in `SKILL.md` for scene fragments: fragments use `tl.set()` at time 0 plus `tl.to()` at scene time, not `tl.from()` or `tl.fromTo()`. That keeps fragment state deterministic when the assembled composition is seeked non-linearly.

## Who runs this pipeline

The parallel dispatch in Phase 1 and Phase 2b requires whatever subagent/delegation tool your harness provides. Only the **top-level conversation agent** usually has that tool. Dispatched subagents typically do not.

- **If you're the top-level agent:** run the full pipeline. Fan out scene subagents and evaluator subagents in parallel.
- **If you're a nested subagent** (you were dispatched with a HyperFrames task): you probably cannot fan out further. Author all scene fragments sequentially yourself, strictly following the Scene Fragment Spec below, then evaluate each fragment with the Phase 2b checklist, run the assembler, and run the lint gates. Do not silently skip the pipeline — note in your final report that parallel dispatch was unavailable and you built serially.

The assembler, scaffold markers, fragment spec, and gates are the same either way; only the dispatch shape changes.

## Phase 0: Scene Manifest (blocking)

Before dispatching the scaffold or any scene author, create `.hyperframes/scene-manifest.json`. This manifest is the single source of truth for scene numbers, timing, transition handoffs, register, and persistent-subject reservations. Scaffold and scene agents must consume it; they must not recalculate timings independently.

Write this shape exactly:

```json
{
  "version": 1,
  "composition": {
    "duration": 15,
    "width": 1920,
    "height": 1080,
    "register": "high-clarity product launch — confident, kinetic, legible"
  },
  "scenes": [
    {
      "number": 1,
      "id": "scene1",
      "title": "Dramatic hook",
      "start": 0,
      "duration": 4.5,
      "end": 4.5,
      "expandedPromptSection": "Per-scene beats > Scene 1",
      "registerFit": "Uses bold scale and crisp proof points without drifting into comedy or documentary pacing.",
      "transitionOut": {
        "type": "css blur-through",
        "start": 3.9,
        "duration": 0.6,
        "end": 4.5,
        "hardCut": false,
        "reason": "Keeps the launch momentum continuous into the feature breakdown."
      },
      "r4": null
    },
    {
      "number": 2,
      "id": "scene2",
      "title": "Feature breakdown",
      "start": 4.5,
      "duration": 10.5,
      "end": 15,
      "expandedPromptSection": "Per-scene beats > Scene 2",
      "registerFit": "Keeps the same confident product-launch voice while slowing enough for comprehension.",
      "transitionOut": null,
      "r4": null
    }
  ]
}
```

Manifest rules:

- `start`, `duration`, `end`, and `transitionOut` timing are seconds.
- `composition.duration` must equal the final scene `end`.
- `composition.width` and `composition.height` must be positive integers.
- `end` must equal `start + duration`.
- For non-final scenes, `transitionOut.end` must equal the current scene `end` and the next scene `start`.
- Every `transitionOut` must include `type`, `start`, `duration`, `end`, `hardCut`, and `reason`.
- Every non-final scene must have `transitionOut`. The final scene uses `transitionOut: null`.
- A hard cut is allowed only when `transitionOut.hardCut` is `true`, `transitionOut.duration` is `0`, and `reason` explains the rhythm/content need. Undeclared jump cuts are failures.
- If R4 applies, each scene's `r4` object must contain `role`, `reservedRegion`, `center`, `scale`, `motionAcrossBoundary`, and `sceneRelationship`.
- The fragment scene start variable must match the manifest exactly: scene 3 with `"start": 14.3` writes `var S3 = 14.3;`.

## Scene Fragment Spec

Every scene file (`.hyperframes/scenes/sceneN.html`) must be a **fragment**, not a standalone document. The assembler splits on markers and injects verbatim — non-compliant files break assembly.

### Structure

Exactly three sections, in this order, each appearing exactly once:

```
<!-- HTML -->
<div class="s3-stage">
  <div class="s3-kicker">Momentum</div>
  <div class="s3-heading">Launch velocity</div>
  <div class="s3-rule"></div>
</div>

<!-- CSS -->
.s3-stage {
  position: relative;
  width: 100%;
  height: 100%;
  padding: 120px 150px;
  box-sizing: border-box;
}
.s3-heading {
  color: var(--fg);
  font-size: 104px;
}
.s3-rule {
  width: 420px;
  height: 4px;
  background: var(--accent);
}

<!-- GSAP -->
var S3 = 14.3;
tl.set('.s3-kicker', { opacity: 0, y: 24 }, 0);
tl.set('.s3-heading', { opacity: 0, y: 36 }, 0);
tl.set('.s3-rule', { opacity: 0, scaleX: 0, transformOrigin: '0% 50%' }, 0);
tl.to('.s3-kicker', { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' }, S3 + 0.2);
tl.to('.s3-heading', { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out' }, S3 + 0.35);
tl.to('.s3-rule', { opacity: 1, scaleX: 1, duration: 0.45, ease: 'power2.out' }, S3 + 0.7);
```

### Required

- **Three markers, one each:** `<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->` — no duplicates
- **ID prefix:** All IDs and classes use `s{N}-` prefix (e.g., `#s3-heading`, `.s7-chart`)
- **GSAP pattern:** `tl.set()` at time 0 for initial state, `tl.to()` at scene time for animation
- **Scene start var:** Define `var S{N} = {matching manifest scene start};` at top of GSAP section, reference it for all tweens
- **Finite repeats:** All `repeat` values must be explicit numbers, never `-1` or `Infinity`
- **Inner stage wrapper:** Put scene layout on an inner `.s{N}-stage` element. Do not style `#sceneN` or `.scene`.

### Prohibited

- `<!DOCTYPE`, `<html`, `<head`, `<body` — this is a fragment, not a document
- `<style>` or `</style>` tags — the CSS section is raw CSS, not wrapped in style tags. The scaffold's `<style>` block receives the content directly. Nested style tags break rendering.
- `<script>` or `</script>` tags — the GSAP section is raw JS, not wrapped in script tags. The scaffold's single `<script>` block receives the content directly. Nested script tags cause `Unexpected token '<'` parse errors.
- `<script src=` — no external script loading
- `gsap.timeline(` — the scaffold creates the timeline
- `window.__timelines` — the scaffold registers it
- `tl.from(` or `tl.fromTo(` — causes flash-of-default-state (use `tl.set` + `tl.to`)
- `body {` in CSS — the scaffold owns body styles
- `.scene {` in CSS — the scaffold owns scene base styles
- `position`, `top`, `left`, `width`, `height`, `opacity`, or `z-index` on `#sceneN` — the scaffold owns the scene container; only style elements INSIDE the scene
- Bare class names without `s{N}-` prefix (`.heading`, `.card`, `.tendril`, `.crack`) — causes cross-scene collisions when two scenes use the same name
- CSS `transform` for centering (`translate(-50%, -50%)`) on elements that GSAP animates — GSAP overwrites the entire `transform` property, destroying the CSS centering. Use GSAP `xPercent: -50, yPercent: -50` in the `tl.set()` at time 0 instead.

### Contrast

All text elements must achieve **4.5:1 contrast ratio** (WCAG AA) against their scene background. Check especially:

- HUD labels, stats, and values against dark backgrounds
- Light-colored text on tinted/colored backgrounds
- Small text (under 24px) has no large-text exemption

Use the design.md foreground color for text. If an element needs a different color for visual effect, verify contrast manually.

### Assembly contract

If a scene file follows this spec, the assembler can:

1. Split on `<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->` markers
2. Inject HTML between the scaffold's `<div id="sceneN" class="scene">` and `</div>`
3. Append CSS to the scaffold's `<style>` block
4. Append GSAP into the scaffold's `<script>` after transitions, before `window.__timelines` registration

No parsing, no stripping, no guessing.

## Phase 1: Scaffold + Scene subagents (parallel after manifest)

After Phase 0, the scaffold and scene subagents have no dependency on each other — dispatch them all at the same time. Scene subagents don't read the scaffold; they receive the fragment spec, design.md, the expanded prompt global rules, the manifest, and their scene's expanded-prompt section. If R4 applies, the scaffold author receives the full persistent-subject choreography plan and each scene subagent receives only its scene's block. Assembly waits for both to finish.

**Nested-subagent fallback:** If you don't have the dispatch tool (see "Who runs this pipeline" above), write the scaffold first, then write each scene fragment yourself one after another. After each fragment, run the Phase 2b checklist yourself and write `.hyperframes/scenes/sceneN.eval.md` with PASS or FAIL plus specific issues. Fix/retry before moving to assembly. The assembler's format validation (Phase 3) is still required, but it is not a substitute for content validation. Note the serial-build constraint in your final report.

### Scaffold

Build the HTML skeleton yourself (or in a subagent):

- All scene containers as plain scaffold-owned elements: `<div id="sceneN" class="scene"><!-- SCENE N CONTENT --></div>`
- Do **not** put `data-start`, `data-duration`, `data-track-index`, or `class="clip"` on scene containers in standalone compositions. The root composition owns the duration; GSAP transitions own scene visibility.
- The root composition container with `data-composition-id`, `data-width`, `data-height`
- The GSAP timeline backbone: `gsap.timeline({ paused: true })`, `window.__timelines` registration
- All transition code between scenes (read [transitions.md](transitions.md))
- All scene transition timings from `.hyperframes/scene-manifest.json`. Do not recalculate starts, durations, or hard-cut decisions.
- Global CSS: body reset, scene positioning, font declarations, the `design.md` palette as CSS
- Leave each scene's inner content empty: `<div id="scene1" class="scene"><!-- SCENE 1 CONTENT --></div>`
- **Initial scene visibility** — exactly one scene may be visible at time 0. Use scaffold-owned CSS:

```css
.scene {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  opacity: 0;
  visibility: hidden;
}
#scene1 {
  opacity: 1;
  visibility: visible;
}
```

Then mirror that state in the timeline so non-linear seeking is deterministic:

```js
tl.set("#scene1", { opacity: 1, visibility: "visible" }, 0);
tl.set("#scene2, #scene3", { opacity: 0, visibility: "hidden" }, 0);
```

Replace `#scene2, #scene3` with every scene after scene 1. Before each non-hard transition, set the incoming scene visible with `opacity: 0` at the manifest `transitionOut.start`; after the handoff, hide the outgoing scene. For a declared hard cut, swap outgoing hidden/incoming visible at the hard-cut time.

- If R4 applies: a shared overlay layer outside all `.scene` containers for the persistent subject. The scaffold author must receive the full R4 choreography plan before writing DOM, CSS, or GSAP; the scaffold owns the subject's DOM, CSS, and cross-scene timeline.
- **Visibility kills for every scene** including the last — after each scene's exit transition, add `tl.set("#sceneN", { visibility: "hidden" }, exitEndTime)`. The final scene needs this too (after its fade-out), or it remains partially visible when scrubbing.
- **Assembly markers** — the scaffold must include these exact comments so the assembler knows where to inject:
  - `/* SCENE STYLES */` inside the `<style>` block — scene CSS goes here
  - `// SCENE TWEENS` inside the `<script>` block, after transitions, before `window.__timelines` registration — scene GSAP goes here
  - `<!-- SCENE N CONTENT -->` inside each empty scene div — scene HTML goes here

### Scene subagents

Dispatch one subagent per scene, running in parallel (concurrently with the scaffold). Each subagent receives:

- The **Scene Fragment Spec** (above) — the subagent must follow this exactly
- `.hyperframes/scene-manifest.json`
- That scene's manifest row — the source of truth for `var S{N}`, duration, transition context, register fit, and R4 reservation
- The `design.md` (or its values summarized)
- The expanded prompt global rules from `.hyperframes/expanded-prompt.md`
- That scene's specific expanded-prompt section only
- The scene number `N` and manifest start time — used for the `s{N}-` prefix and `var S{N} = {start_time};`
- **The persistent-subject choreography block for this scene**, if any — see below

Each subagent focuses its entire context on making ONE scene visually rich: parallax layers, micro-animations, kinetic typography, ambient motion, background decoratives. No boilerplate, no other scenes. **Each subagent must write to a file** — text returned in conversation is not accessible to the assembly agent.

### Persistent-subject choreography contract

If the expansion identified a persistent subject (R4 applies), the expansion will have produced a choreography plan with one block per scene. Phase 0 copies those blocks into each manifest scene's `r4` object. See [`prompt-expansion.md` → R4: Pre-plan persistent-subject choreography](./prompt-expansion.md#r4-pre-plan-persistent-subject-choreography).

The scaffold author must receive the **full R4 choreography plan**, not just per-scene snippets. It is not enough to pass R4 blocks to scene subagents: the scaffold is the only place that can create the shared subject layer and animate it continuously across scene boundaries.

When dispatching scene subagents, **the orchestrator must pass each subagent its scene's choreography block** along with these instructions:

1. **The persistent subject lives in a shared overlay layer outside your scene container.** Do NOT author the subject inside your scene fragment. The scaffold owns the subject's DOM + timeline.
2. **Your scene's layout must respect the reserved region.** No typography, no decoratives, no scene chrome may be placed inside the reserved region specified for your scene. The subject will occupy it.
3. **Design your scene's content around the element's role in this scene.** If the role is _focal subject_, your scene chrome is thin margins and light labels around it. If _background anchor_, your chrome fills the frame and the subject is a small corner anchor. If _data-point in a row_, your scene includes the row structure and reserves a slot for the subject.
4. **Do NOT animate the persistent subject in your GSAP timeline.** The scaffold authors the subject's tweens across scene boundaries on the `tl` timeline. Your scene tweens animate the scene's own content only.
5. **Your scene may reference the subject's position as a fixed anchor** — e.g., "the label line points at the subject's center at {x, y}." Treat it like a pre-placed element the scaffold will render for you.

The scaffold's responsibility:

1. Create the subject's DOM in the shared overlay layer outside `.scene` containers.
2. Author tweens on the subject that move it between choreography positions across scene boundaries — the transitions' timing determines when the subject starts its move.
3. Use `xPercent: -50, yPercent: -50` on the subject so position coords are center coords.
4. Coordinate scene crossfades with subject moves so the subject's motion spans the crossfade midpoint (so the viewer tracks one element through the cut).

Without this contract: scene subagents place their content where they think looks good, then the scaffold animates the subject into a region that was already filled — producing the size-collision and semantic-mismatch failures observed in prior evals.

## Phase 2b: Streaming evaluation

As each scene file appears in `.hyperframes/scenes/`, dispatch an evaluator subagent immediately — don't wait for all scenes to finish. The evaluator receives:

- The scene file
- The **Scene Fragment Spec** (above)
- `.hyperframes/scene-manifest.json`
- That scene's manifest row
- The expanded prompt global rules from `.hyperframes/expanded-prompt.md`
- That scene's section from `.hyperframes/expanded-prompt.md`
- The `design.md`

### Evaluation order: format first, then content

**Step 1 — Format validation (instant FAIL if any check fails):**

- Exactly 3 markers (`<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->`), each appearing once
- No prohibited patterns (DOCTYPE, html/head/body tags, `<script>`/`</script>` tags, script src, gsap.timeline, window.\_\_timelines, tl.from, body/scene CSS rules, CSS `transform` on GSAP-animated elements)
- All IDs and classes use `s{N}-` prefix
- No position/top/left/width/height/opacity/z-index on `#sceneN` in CSS
- The GSAP section defines `var S{N} = {manifest start};` exactly
- Every `tl.to()` position uses `S{N}` and no scene fragment recalculates global time
- All `repeat` values are finite numbers

**Step 2 — Content validation (only if format passes):**

- **Expanded-prompt adherence**: Does the scene include the elements from its expanded-prompt section? List what's present and what's missing.
- **Register fit**: Does the scene stay inside the global register and its scene-level register fit? Flag clever-but-wrong enrichment.
- **Design compliance**: Are the design.md colors, fonts, corners, and spacing used? Any invented values?
- **Contrast**: All text elements meet 4.5:1 against the scene background color. Check HUD labels, stats, and small text especially.
- **Density**: 8-10 visual elements unless the expanded prompt intentionally calls for a sparse beat; at least 2 depth layers; every decorative listed in the prompt has ambient motion.

The evaluator writes a verdict to `.hyperframes/scenes/sceneN.eval.md`: PASS or FAIL with specific issues. If FAIL, re-dispatch the scene subagent with the evaluator's feedback appended to the original instructions. Maximum 2 retries per scene — if a scene fails 3 times, escalate to the user with the evaluator's feedback and ask how to proceed. If PASS, the scene is ready for assembly.

Use this exact verdict shape:

```markdown
# Scene N Evaluation

Verdict: PASS | FAIL
Manifest start: <number>

## Format

- Markers: PASS | FAIL - <notes>
- Prefixes: PASS | FAIL - <notes>
- GSAP timing: PASS | FAIL - <notes>

## Content

- Expanded-prompt adherence: PASS | FAIL - <notes>
- Register fit: PASS | FAIL - <notes>
- Design compliance: PASS | FAIL - <notes>
- Contrast: PASS | FAIL - <notes>
- Density and motion: PASS | FAIL - <notes>

## Required fixes

- <specific fix, or "None">
```

Only write `Verdict: PASS` when every line item passes.

Run evaluators concurrently with scene builds — a scene that finishes first gets evaluated first. The pipeline streams, not batches.

If you're using the nested-subagent fallback, perform this same evaluation yourself immediately after writing each fragment and still write the `.eval.md` verdict. The fallback skips parallelism, not the quality gate.

## Phase 3: Assembly

Once all scenes have PASS evaluations, whether from parallel evaluators or serial self-evaluation, run the deterministic assembler — do NOT hand-stitch scenes manually:

```bash
bun skills/hyperframes/scripts/assemble-scenes.mjs <project-dir>
```

The helper validates `.hyperframes/scene-manifest.json`, checks `composition.duration`/`width`/`height`, requires each `.hyperframes/scenes/sceneN.eval.md` to contain a standalone `Verdict: PASS` line, checks that each fragment's `var S{N}` matches the manifest start, runs the deterministic assembler, prints specific file/message errors, and exits nonzero on failure. The assembler validates every fragment against the spec, splits on markers, injects into the scaffold's marked slots, and verifies div balance. If any fragment fails validation, it aborts with specific errors — fix the fragment and re-run.

After assembly succeeds:

1. Run `npx hyperframes lint` and fix any structural issues
2. Run `npx hyperframes validate` if available
3. **Review the output** — read through the assembled file checking that scene HTML, CSS, and GSAP look correct before serving

## Persistent Elements Across Scenes

When an element persists across scenes (a photograph, logo, product shot), the scaffold owns its DOM and timeline — scene subagents must not animate it. Pre-plan where the element sits in each scene and record it in `.hyperframes/scene-manifest.json` so subagents know what region to avoid. Without this, scene subagents place content in regions the persistent element will later occupy during transitions.
