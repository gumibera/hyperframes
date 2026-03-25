Create a HyperFrames composition showing a before/after comparison infographic. Before: "12% engagement rate". After: "47% engagement rate". The narrator says "we went from twelve percent to forty-seven percent" starting at 5.0s and ending at 7.2s. Landscape 1920x1080, overlay on dark background. Save to compositions/stat-comparison.html.

---

## Criteria

### Structure

- [ ] Valid `<template>` with `data-composition-id`
- [ ] Has `data-width="1920"` and `data-height="1080"`
- [ ] GSAP 3.14.2 included
- [ ] Timeline registered in `window.__timelines`
- [ ] IIFE-wrapped script

### Design (comparison layout)

- [ ] Two distinct stat areas (left/right or before/after labeling)
- [ ] "Before" stat is visually muted (lower opacity, smaller, or dimmer color)
- [ ] "After" stat is visually prominent (full opacity, accent color, or larger)
- [ ] Clear visual hierarchy — the "after" draws the eye first
- [ ] Divider or spatial separation between the two stats
- [ ] No more than 2 colors
- [ ] Margins 80px+ from edges
- [ ] No gradients, shadows, or decorative elements

### Animation (comparison reveal)

- [ ] "Before" appears first (muted entrance)
- [ ] Pause between "before" and "after" reveals (0.3-0.8s gap)
- [ ] "After" enters with more energy than "before" (scale, ease, or speed difference)
- [ ] "After" uses `back.out` or similar overshoot ease (emphasis)
- [ ] "Before" does NOT use overshoot ease (subdued entrance)
- [ ] Timing syncs to narration (~5.0s start)
- [ ] Exit animation present
- [ ] All elements exit together (not reverse choreography)

### Anti-patterns

- [ ] No `Math.random()` or `Date.now()`
- [ ] No simultaneous entrance of both stats (must be staggered)
- [ ] No identical animation for both stats (they should feel different)
- [ ] No `display: none` toggling
