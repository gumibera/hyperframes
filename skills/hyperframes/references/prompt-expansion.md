# Prompt Expansion

Run on every composition. Expansion is not about lengthening a short prompt — it's about grounding the user's intent against `design.md` and `house-style.md` and producing a consistent intermediate that every downstream agent reads the same way.

Runs AFTER design direction is established (Step 1). The expansion consumes design.md (if present) and produces output that cites its exact values.

## Prerequisites

Read before generating:

- `design.md` (if it exists) — extract brand colors, fonts, mood, and constraints. The expansion cites these exact values (hex codes, font names); it does not invent new ones.
- [beat-direction.md](beat-direction.md) — per-beat planning format (concept, mood, choreography verbs, transitions, depth layers, rhythm). The expansion outputs each scene using this format.
- [video-composition.md](video-composition.md) — video-medium rules for density, scale, and color presence. The expansion applies these automatically.
- [../house-style.md](../house-style.md) — its rules for Background Layer (2-5 decoratives), Color, Motion, Typography apply to every scene. The expansion writes output that conforms to them.

If `design.md` doesn't exist yet, run Step 1 (Design system) first. Expansion without a design context produces generic scene breakdowns that later agents ignore.

## Why always run it

**The expansion is never pass-through.** Every user prompt — no matter how detailed — is a _seed_. The expansion's job is to enrich it into a fully-realized per-scene production spec that the scene subagents can build from directly.

Even a detailed 7-scene brief lacks things only the expansion adds:

- **Atmosphere layers per scene** (required 2–5 from house-style: radial glows, ghost type, hairline rules, grain, thematic decoratives) — the user's prompt almost never lists these; expansion adds them.
- **Secondary motion for every decorative** — breath, drift, pulse, orbit. A decorative without ambient motion feels dead.
- **Micro-details that make a scene feel real** — registration marks, tick indicators, monospace coord labels, typographic accents, code snippets in the background, grid patterns. Things the user didn't think to request.
- **Transition choreography at the object level** — not "crossfade" but "X expands outward and becomes Y". Specific duration, ease, and morph source/target.
- **Pacing beats within each scene** — where tension builds, where a hold lets the viewer breathe, where the accent word lands.
- **Exact hex values, typography parameters, ease choices** from design.md — no vagueness left for the scene subagent to guess.

Expansion's job on a detailed prompt is not to summarize or pass through — it's to **take what the user wrote and make it richer**. The user's content stays; the atmosphere, ambient motion, and micro-details are added on top. That's what makes the difference between a scene that matches the brief and a scene that feels alive.

The quality gap between a single-pass composition and a multi-scene-pipeline composition comes from this step. Expansion front-loads the richness so every scene subagent builds from a rich brief, not a terse one.

**Do not skip. Do not pass through.** Single-scene compositions and trivial edits are the only exceptions.

## What to generate

Expand into a full production prompt with these sections:

1. **Title + style block** — cite design.md's exact hex values, font names, and mood. Do NOT invent a palette — quote what the design provides.

   Include a **Register** line that names the content's expected energy and tone, then constrains enrichment. Example: `Register: respectful archival documentary — enrich with provenance, grain, and measured camera moves; avoid tech-product HUD chrome.`

2. **Rhythm declaration** — name the scene rhythm before detailing any scene. Example: `hook-PUNCH-breathe-CTA` or `slow-build-BUILD-PEAK-breathe-CTA`. See [beat-direction.md](beat-direction.md) for rhythm templates by video type.

3. **Global rules** — parallax layers, micro-motion requirements, transition style, primary + accent transitions. Match energy to mood (calm → slow eases, high → snappy eases).

4. **Per-scene beats** — for each scene, use the beat-direction format:
   - **Concept** — the big idea in 2-3 sentences. What visual WORLD? What metaphor? What should the viewer FEEL?
   - **Register fit** — how this scene stays inside the global register. This is not optional; downstream evaluators check it.
   - **Mood direction** — cultural/design references, not hex codes. ("Bauhaus color studies", "cinematic title sequence", "editorial calm")
   - **Depth layers** — BG (2-5 decoratives with ambient motion), MG (content), FG (accents, structural elements, micro-details). 8-10 total elements per scene per video-composition.md.
   - **Animation choreography** — specific verbs per element. High: SLAMS, CRASHES. Medium: CASCADE, SLIDES. Low: floats, types on, counts up. Every element gets a verb. If you can't name the verb, the element is not yet designed.
   - **Transition out** — shader or CSS, with specific type and parameters. Not "crossfade" but "blur crossfade, 0.4s, power2.inOut."

5. **R4: Pre-plan persistent-subject choreography** — always evaluate this section. If the composition does not have a persistent subject across 2+ scenes, write exactly: `R4: Not applicable — no persistent subject`.

   If the composition has a persistent subject — a product shot, photograph, logo, artwork, UI screenshot, person, or other concrete object that should feel continuous through cuts — include a full choreography plan.

   For each scene, output one block with:
   - **Subject role** — focal subject, background anchor, data-point, transition bridge, or final hero.
   - **Reserved region** — x/y/width/height or named region (for example, "right 42% of frame, 240px margin"). Scene content must avoid this region.
   - **Subject center + scale** — center coordinates as percentages and approximate rendered size.
   - **Motion across boundary** — where the subject moves from the previous scene into this scene, including timing relative to the transition midpoint.
   - **Scene relationship** — what scene chrome points to, frames, labels, or avoids around the subject.

   These blocks map into `.hyperframes/scene-manifest.json` as `r4.role`, `r4.reservedRegion`, `r4.center`, `r4.scale`, `r4.motionAcrossBoundary`, and `r4.sceneRelationship`.

6. **Recurring motifs** — visual threads across scenes from the brand palette.

7. **Negative prompt** — what to avoid, informed by design.md's constraints if present.

## Output

Write the expanded prompt to `.hyperframes/expanded-prompt.md` in the project directory. Do NOT dump it into the chat — it will be hundreds of lines.

Tell the user:

> "I've expanded your prompt into a full production breakdown. Review it here: `.hyperframes/expanded-prompt.md`
>
> It has [N] scenes across [duration] seconds with specific visual elements, transitions, and pacing. Edit anything you want, then let me know when you're ready to proceed."

Only move to construction after the user approves or says to continue.
