# Data in Motion

How to present data, stats, and infographics in video compositions. This is NOT a web dashboard — video data visualization has different rules because the viewer can't hover, scroll, or study at their own pace.

## Core Principle

**One idea per beat.** The viewer has 2-3 seconds per data point before the next arrives. Every stat gets its own moment, its own scene, its own visual treatment. Never show 6 stats simultaneously.

## Forget Charts

Video infographics don't have axes, legends, gridlines, or chart frames. The moment you draw an axis, you're making a dashboard screenshot, not a video. Instead:

### The Number IS the Visual

Don't put data in a chart. Make the number the hero element — 200-300px, filling 60-80% of the frame. The typography IS the design. A huge "2.5M" on a clean background communicates more in 2 seconds than any bar chart.

### The Frame IS the Scale

Instead of a Y-axis, use the full screen width or height as the reference. "47% market share" = a bar that fills 47% of the full frame width. The viewer sees the proportion instantly because the screen is the container. No axes needed.

### Time Replaces the X-Axis

Instead of a line chart showing months, reveal each month's value sequentially — same position, different size or number. The viewer feels the trend through rhythm. Growing numbers build momentum. Shrinking numbers create tension.

### Position Encodes Meaning

Put higher values physically higher on screen. Put growth on the right, decline on the left. The viewer reads spatial position without any legend.

## Techniques

### Count-Up

The number starts at 0 and counts to its final value. More dramatic than the number appearing instantly.

```js
// Count from 0 to 2,500,000 over 1.5 seconds
const counter = { val: 0 };
tl.to(
  counter,
  {
    val: 2500000,
    duration: 1.5,
    ease: "power2.out",
    snap: { val: 1 },
    onUpdate: () => {
      el.textContent = counter.val.toLocaleString();
    },
  },
  0.3,
);
```

### Proportional Fill

A bar or shape that fills to represent a value. The unfilled space communicates the remaining amount.

```js
// 99.9% uptime — bar fills almost the entire frame width
tl.from("#bar", { width: 0, duration: 1, ease: "power3.out" }, 0.3);
// The 0.1% gap at the end says more than the number
```

### Reduction

Start with the full amount and carve away. "Only 3% accepted" — show a full bar that shrinks to a sliver. The loss is more dramatic than showing a small value.

```js
// Start full, reduce to 3%
gsap.set("#bar", { width: "100%" });
tl.to("#bar", { width: "3%", duration: 1.2, ease: "power2.inOut" }, 0.5);
```

### Accumulation

Show quantity building up — dots appearing rapidly, a counter spinning, a container filling. The process of reaching the number is more engaging than the number itself.

### Sequential Comparison

Don't put two bars side by side. Show the first value, let it register (1-2 seconds), then show the second value in the same position. The viewer compares to their memory, which is more dramatic than simultaneous display.

### Scale Through Metaphor

Abstract numbers gain meaning through physical reference. "150ms latency" means nothing visually. But "faster than a blink" with a quick flash animation — that communicates instantly.

## What NOT To Do

- **No pie charts** — segments are hard to compare and look like PowerPoint. Use a single-value donut ring for one percentage, or sequential hero numbers for multiple values.
- **No multi-axis charts** — the viewer can't study intersections in a 3-second window.
- **No dashboards** — multiple charts side by side is a web pattern. One stat per scene.
- **No gridlines or tick marks** — visual noise that adds nothing in motion.
- **No legends** — if you need a legend to explain your visualization, the visualization isn't working. Use color + direct labels.
- **No chart library output** — D3, Chart.js, etc. produce static chart patterns. Build with GSAP + SVG/CSS for video-native animation.

## Structure for Multi-Stat Compositions

When showing multiple data points (e.g., 3 metrics):

1. **Scene per stat** — each metric gets its own 3-5 second scene with a full-frame reveal
2. **Build rhythm** — first stat enters at the composition's pace, each subsequent stat enters slightly faster (accelerating reveal creates momentum)
3. **Callback/summary** — after all stats are revealed individually, optionally show them together briefly as a final frame (this is the only time multiple stats share the screen)
4. **Consistent position** — keep the hero number in the same screen position across scenes so the viewer's eye doesn't hunt

See [house-style.md](./house-style.md) for motion defaults, palette selection, and scene pacing.
