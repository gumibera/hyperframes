# Multi-Scene Build Pipeline

For compositions with 4 or more scenes, build in phases instead of one pass. A single pass produces shallow results — detail drops as context fills with boilerplate.

## Scene Fragment Spec

Every scene file (`.hyperframes/scenes/sceneN.html`) must be a **fragment**, not a standalone document. The assembler splits on markers and injects verbatim — non-compliant files break assembly.

### Structure

Exactly three sections, in this order, each appearing exactly once:

```
<!-- HTML -->
<div class="s3-heading">...</div>
...

<!-- CSS -->
.s3-heading { color: var(--fg); ... }
...

<!-- GSAP -->
var S3 = 14.3;
tl.set('#s3-heading', { opacity: 0, y: 30 }, 0);
tl.to('#s3-heading', { opacity: 1, y: 0, duration: 0.4 }, S3 + 0.5);
...
```

### Required

- **Three markers, one each:** `<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->` — no duplicates
- **ID prefix:** All IDs and classes use `s{N}-` prefix (e.g., `#s3-heading`, `.s7-chart`)
- **GSAP pattern:** `tl.set()` at time 0 for initial state, `tl.to()` at scene time for animation
- **Scene start var:** Define `var SN = {start_time};` at top of GSAP section, reference it for all tweens
- **Finite repeats:** All `repeat` values must be explicit numbers, never `-1` or `Infinity`

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

## Phase 1: Scaffold

Build the HTML skeleton yourself:

- All scene `<div>` elements with `data-start`, `data-duration`, `data-track-index`
- The root composition container with `data-composition-id`, `data-width`, `data-height`
- The GSAP timeline backbone: `gsap.timeline({ paused: true })`, `window.__timelines` registration
- All transition code between scenes (read [transitions.md](transitions.md))
- Global CSS: body reset, scene positioning, font declarations, the `design.md` palette as CSS
- Leave each scene's inner content empty: `<div id="scene1" class="scene"><!-- SCENE 1 CONTENT --></div>`
- **Visibility kills for every scene** including the last — after each scene's exit transition, add `tl.set("#sceneN", { visibility: "hidden" }, exitEndTime)`. The final scene needs this too (after its fade-out), or it remains partially visible when scrubbing.
- **Assembly markers** — the scaffold must include these exact comments so the assembler knows where to inject:
  - `/* SCENE STYLES */` inside the `<style>` block — scene CSS goes here
  - `// SCENE TWEENS` inside the `<script>` block, after transitions, before `window.__timelines` registration — scene GSAP goes here
  - `<!-- SCENE N CONTENT -->` inside each empty scene div — scene HTML goes here

## Phase 2: Scene subagents

Dispatch one subagent per scene, running in parallel. Each subagent receives:

- The **Scene Fragment Spec** (above) — the subagent must follow this exactly
- The `design.md` (or its values summarized)
- The global animation rules from the prompt
- That scene's specific prompt section only
- The scene number `N` and start time — used for the `s{N}-` prefix and `var SN = {start_time};`

Each subagent focuses its entire context on making ONE scene visually rich: parallax layers, micro-animations, kinetic typography, ambient motion, background decoratives. No boilerplate, no other scenes. **Each subagent must write to a file** — text returned in conversation is not accessible to the assembly agent.

## Phase 2b: Streaming evaluation

As each scene file appears in `.hyperframes/scenes/`, dispatch an evaluator subagent immediately — don't wait for all scenes to finish. The evaluator receives:

- The scene file
- The **Scene Fragment Spec** (above)
- That scene's section from the original prompt
- The `design.md`

### Evaluation order: format first, then content

**Step 1 — Format validation (instant FAIL if any check fails):**

- Exactly 3 markers (`<!-- HTML -->`, `<!-- CSS -->`, `<!-- GSAP -->`), each appearing once
- No prohibited patterns (DOCTYPE, html/head/body tags, `<script>`/`</script>` tags, script src, gsap.timeline, window.\_\_timelines, tl.from, body/scene CSS rules, CSS `transform` on GSAP-animated elements)
- All IDs and classes use `s{N}-` prefix
- No position/top/left/width/height/opacity/z-index on `#sceneN` in CSS
- All `repeat` values are finite numbers

**Step 2 — Content validation (only if format passes):**

- **Prompt adherence**: Does the scene include the elements the prompt described? List what's present and what's missing.
- **Design compliance**: Are the design.md colors, fonts, corners, and spacing used? Any invented values?
- **Contrast**: All text elements meet 4.5:1 against the scene background color. Check HUD labels, stats, and small text especially.
- **Density**: 15+ animated elements? 3 parallax layers?

The evaluator writes a verdict to `.hyperframes/scenes/sceneN.eval.md`: PASS or FAIL with specific issues. If FAIL, re-dispatch the scene subagent with the evaluator's feedback appended to the original instructions. Maximum 2 retries per scene — if a scene fails 3 times, escalate to the user with the evaluator's feedback and ask how to proceed. If PASS, the scene is ready for assembly.

Run evaluators concurrently with scene builds — a scene that finishes first gets evaluated first. The pipeline streams, not batches.

## Phase 3: Assembly

Once all scenes have PASS evaluations, run the deterministic assembler — do NOT hand-stitch scenes manually:

```ts
const { assembleScenes } = await import("@hyperframes/core/assemble");
const result = assembleScenes("./project-dir");
if (!result.ok) {
  // result.errors has file + message for each issue
}
```

The assembler validates every fragment against the spec, splits on markers, injects into the scaffold's marked slots, and verifies div balance. If any fragment fails validation, it aborts with specific errors — fix the fragment and re-run.

After assembly succeeds:

1. Run `npx hyperframes lint` and fix any structural issues
2. Run `npx hyperframes validate` if available
3. **Review the output** — read through the assembled file checking that scene HTML, CSS, and GSAP look correct before serving
