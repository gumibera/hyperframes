Create a HyperFrames composition showing a 3-step process infographic. Steps: (1) "Record" at 1.0s, (2) "Edit" at 3.5s, (3) "Publish" at 6.0s. Each step has a short description. The narrator introduces each step at the given time. Landscape 1920x1080. Save to compositions/process-steps.html.

---

## Criteria

### Structure

- [ ] Valid `<template>` with `data-composition-id`
- [ ] Has `data-width="1920"` and `data-height="1080"`
- [ ] GSAP 3.14.2 included
- [ ] Timeline registered in `window.__timelines`
- [ ] IIFE-wrapped script

### Design (process layout)

- [ ] Three steps are visually distinct (numbered or labeled)
- [ ] Step numbers use large, muted typography (dim color or low opacity)
- [ ] Step titles are bold and prominent
- [ ] Step descriptions are smaller and muted
- [ ] Consistent vertical spacing between steps
- [ ] Left-aligned layout (not scattered across the frame)
- [ ] Margins 80px+ from edges
- [ ] No icons or clip art — typography only
- [ ] No gradients, shadows, or decorative elements

### Animation (sequential reveal)

- [ ] Steps reveal one at a time, not all at once
- [ ] Step 1 appears at ~1.0s, Step 2 at ~3.5s, Step 3 at ~6.0s
- [ ] Each step fades in with subtle y-offset (upward movement)
- [ ] Active step is visually highlighted (full opacity, accent color on number)
- [ ] Previous steps dim when next step appears (opacity reduction)
- [ ] Previous steps remain visible (dimmed, not hidden)
- [ ] Entrance stagger within each step (number → title → description)
- [ ] Exit animation for the whole group

### Anti-patterns

- [ ] No `Math.random()` or `Date.now()`
- [ ] Steps don't all appear simultaneously
- [ ] No horizontal entrance directions (steps enter vertically, not from sides)
- [ ] No `display: none` toggling
- [ ] No decorative animation on step numbers (no spin, bounce, etc.)
