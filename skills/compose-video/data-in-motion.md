# Data in Motion

How to present data, stats, and infographics in video compositions. This is NOT a web dashboard — video data visualization has different rules because the viewer can't hover, scroll, or study at their own pace.

## Core Principle

**Visual continuity for related data.** When successive stats belong to the same concept (Q1 → Q2 → Q3 → Q4, or three metrics for the same product), keep them in the same visual space with the same aesthetic. The number stays in the same position. The fill uses the same bar or shape. Only the VALUE changes — the viewer watches progression, not chaos. An aesthetic change (new layout, new position, new color scheme) should signal a NEW concept, not just a new number.

## What NOT To Do

- **No pie charts** — segments are hard to compare and look like PowerPoint. Use a single-value donut ring for one percentage, or sequential hero numbers for multiple values.
- **No multi-axis charts** — the viewer can't study intersections in a 3-second window.
- **No 6-panel dashboards** — showing 6+ charts simultaneously is a web pattern. 2-3 related metrics side-by-side is fine when they're peers.
- **No gridlines or tick marks** — visual noise that adds nothing in motion.
- **No legends** — if you need a legend to explain your visualization, the visualization isn't working. Use color + direct labels.
- **No chart library output** — D3, Chart.js, etc. produce static chart patterns. Build with GSAP + SVG/CSS for video-native animation.

See [house-style.md](./house-style.md) for motion defaults, palette selection, and scene pacing.
