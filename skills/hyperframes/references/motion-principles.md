# Motion Principles

## Guardrails

You know these rules but you violate them. Stop.

- **Don't use the same ease on every tween.** You default to `power2.out` on everything. Vary eases like you vary font weights — no more than 2 independent tweens with the same ease in a scene.
- **Don't use the same speed on everything.** You default to 0.4-0.5s for everything. The slowest scene should be 3× slower than the fastest. Vary duration deliberately.
- **Don't enter everything from the same direction.** You default to `y: 30, opacity: 0` on every element. Vary: from left, from right, from scale, opacity-only, letter-spacing.
- **Don't use the same stagger on every scene.** Each scene needs its own rhythm.
- **Don't use ambient zoom on every scene.** Pick different ambient motion per scene: slow pan, subtle rotation, scale push, color shift, or nothing. Stillness after motion is powerful.
- **Don't start at t=0.** Offset the first animation 0.1-0.3s. Zero-delay feels like a jump cut.

## What You Don't Do Without Being Told

### Easing is emotion, not technique

The transition is the verb. The easing is the adverb. A slide-in with `expo.out` = confident. With `sine.inOut` = dreamy. With `elastic.out` = playful. Same motion, different meaning. Choose the adverb deliberately.

**Direction rules — these are not optional:**

- `.out` for elements entering. Starts fast, decelerates. Feels responsive. This is your default.
- `.in` for elements leaving. Starts slow, accelerates away. Throws them off.
- `.inOut` for elements moving between positions.

You get this backwards constantly. Ease-in for entrances feels sluggish. Ease-out for exits feels reluctant.

### Speed communicates weight

- Fast (0.15-0.3s) — energy, urgency, confidence
- Medium (0.3-0.5s) — professional, most content
- Slow (0.5-0.8s) — gravity, luxury, contemplation
- Very slow (0.8-2.0s) — cinematic, emotional, atmospheric

### Scene structure: build / breathe / resolve

Every scene has three phases. You dump everything in the build and leave nothing for breathe or resolve.

- **Build (0-30%)** — elements enter, staggered. Don't dump everything at once.
- **Breathe (30-70%)** — content visible, alive with ONE ambient motion.
- **Resolve (70-100%)** — exit or decisive end. Exits are faster than entrances.

### Transitions are meaning

- **Crossfade** = "this continues"
- **Hard cut** = "wake up" / disruption
- **Slow dissolve** = "drift with me"

You crossfade everything. Use hard cuts for disruption and register shifts.

### Choreography is hierarchy

The element that moves first is perceived as most important. Stagger in order of importance, not DOM order. Don't wait for completion — overlap entries. Total stagger sequence under 500ms regardless of item count.

### Asymmetry

Entrances need longer than exits. A card takes 0.4s to appear but 0.25s to disappear.

## Motion Must Demonstrate the Content

Most scenes fail at this. They depict a state — "here is a dashboard," "here is a scanner," "here is a workflow" — instead of showing the _thing happening_. The result is a series of screenshots with entrance animations, not a video. Two rules close this gap.

### Process scenes animate the process

When a scene's purpose is a process (scanning, loading, detecting, syncing, rendering, measuring, transmitting), the scene must include:

1. **A value that changes deterministically across the scene's duration** — a counter ticking, a percentage rising, a frame index advancing, a byte count.
2. **An ambient "system is alive" signal** — an LED blinking on finite repeat, a status dot pulse, a heartbeat, a scanner bar sweeping.
3. **A progress indicator if the process has a clear start/end** — a filling bar, advancing ticks, a `strokeDashoffset` reveal.
4. **No fully-formed result at scene start.** The viewer must see intermediate state. A scan scene that jumps from empty → complete is banned.

A scene that depicts a scanner showing `03 → 04 → 05` in ticking text but no progress bar and no LED still violates this — the value changes, but there's no ambient life and no progress context. All four elements should be present.

### Capability scenes enact the capability

When a scene's headline implies an action — "Every account. One ledger.", "Convert in one step.", "From noise to signal.", "Three PVCs detected." — the scene must stage that action as motion _within the scene_, not as a labeled before/after diagram.

- The "before" element(s) must physically transform into the "after" state visibly during the scene's duration.
- The transformation is not delegated to the transition to the next scene. That's too late — the headline's claim is made in this scene, so the action must happen in this scene.

Example of the right pattern: a scene describing "unify your accounts" shows five account chips → SVG hairlines draw from each chip → all lines converge at a central balance number that counts up. The viewer sees unification happen.

Example of the wrong pattern: a scene showing five bank tiles in a grid, then cutting to a scene showing a unified balance. The unification is implied, not shown. The headline is unearned.

If the scene's headline is a descriptive state ("Your balance"), not an action, this rule doesn't apply. It triggers specifically on action verbs in the scene's own text: _sync, connect, unify, convert, detect, build, transform, reveal, extract_.

## Visual Composition

You build for the web. Video frames are not pages.

- **Two focal points minimum per scene.** The eye needs somewhere to travel. Never a single text block floating in empty space.
- **Fill the frame.** Hero text: 60-80% of width. You will try to use web-sized elements. Don't.
- **Three layers minimum per scene.** Background treatment (glow, oversized faded type, color panel). Foreground content. Accent elements (dividers, labels, data bars).
- **Background is not empty.** Radial glows, oversized faded type bleeding off-frame, subtle border panels, hairline rules. Pure solid #000 reads as "nothing loaded."
- **Anchor to edges.** Pin content to left/top or right/bottom. Centered-and-floating is a web pattern.
- **Split frames.** Data panel on the left, content on the right. Top bar with metadata, full-width below. Zone-based layouts, not centered stacks.
- **Use structural elements.** Rules, dividers, border panels. They create paths for the eye and animate well (scaleX from 0).
