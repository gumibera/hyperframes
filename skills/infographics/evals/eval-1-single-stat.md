Create a HyperFrames composition for a single stat infographic. The narrator says "our conversion rate jumped to forty-seven percent" starting at 2.1 seconds and ending at 3.8 seconds. The stat should appear as an overlay on a dark background at 1920x1080. Save to compositions/stat-conversion.html.

---

## Criteria

### Structure (composition format)

- [ ] File is a valid `<template>` wrapping a `<div>` with `data-composition-id`
- [ ] Has `data-width="1920"` and `data-height="1080"`
- [ ] Includes GSAP script tag (`gsap@3.14.2`)
- [ ] Registers timeline: `window.__timelines["..."] = tl`
- [ ] Timeline created with `{ paused: true }`
- [ ] Script wrapped in IIFE

### Design (typography and layout)

- [ ] Hero stat font size is 120px or larger
- [ ] Label font size is 24-48px
- [ ] No more than 2 colors used (accent + neutral)
- [ ] Left-aligned or centered — not right-aligned
- [ ] Margins are 80px+ from frame edges
- [ ] No gradients, shadows, or glows in styles
- [ ] No border around the stat
- [ ] Uses a professional font (Inter, Montserrat, or similar sans-serif)

### Animation (count-up and choreography)

- [ ] Stat counts up from 0 to 47 (not instant appear)
- [ ] Count-up uses `onUpdate` callback with `Math.round()`
- [ ] Count-up starts at ~2.1s (when narrator says the number)
- [ ] Count-up duration roughly matches narration (2.1s to 3.8s = ~1.7s)
- [ ] Ease is NOT linear (uses power2.out or similar)
- [ ] Label appears AFTER stat lands (not simultaneously)
- [ ] Has an exit animation (opacity fade)
- [ ] Exit is faster than entrance (0.2-0.4s)

### Anti-patterns (should NOT be present)

- [ ] No `Math.random()` or `Date.now()`
- [ ] No decorative animation (no bounce, no spin, no wiggle on the stat)
- [ ] No `display: none` toggling
- [ ] No inline `<style>` without `[data-composition-id]` scoping
