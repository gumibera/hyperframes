# Data in Motion

How to present data, stats, and infographics in video compositions. This is NOT a web dashboard — video data visualization has different rules because the viewer can't hover, scroll, or study at their own pace.

## Core Principle

**One idea per beat.** The viewer has 2-3 seconds per data point before the next arrives. Every stat gets its own moment, its own scene, its own visual treatment. Never show 6 stats simultaneously.

## The Frame IS the Visualization

Don't reach for charts. The screen itself is your canvas — use its full area to make data feel visceral. Every number needs a visual companion that makes the viewer FEEL the data, not just read it.

### Match Technique to Data Meaning

Choose the visual treatment based on what the data emotionally represents:

| Data type               | Visual treatment                                                                                         | Why it works                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Growth / increase       | A fill that GROWS across the frame — bar expanding, container filling, element scaling up                | The motion itself tells the story of increase                                   |
| Comparison              | Two fills in the same space, one larger. The GAP between them is the story                               | The difference is visible and visceral                                          |
| Percentage / proportion | Fill the frame to the percentage. The empty space matters as much as the filled space                    | "99.9% uptime" with a nearly-full frame makes the 0.1% gap tiny and visceral    |
| Decline / loss          | Start full, shrink. Background drains from warm to cold as the value drops                               | Loss feels like loss — the viewer watches something disappear                   |
| Threshold / target      | Show a marker at the target, animate the actual value toward it — overshoot, undershoot, or exact hit    | The relationship between actual and target IS the story                         |
| Accumulation            | Visual density increasing — marks appearing, a space filling, the frame getting denser                   | The process of reaching the number is more engaging than the number itself      |
| Speed / performance     | Brief flash animation, quick horizontal sweep — the SPEED of the animation conveys the speed of the data | "150ms latency" shown as a near-instant flash communicates faster than a number |

### Every Stat Needs Visual Context — But Vary the Layout

A number alone on screen is sterile. A chart alone is confusing. Every data scene pairs a number with a visual treatment — but vary HOW you compose them. Don't use the same layout per scene.

Ways to present a single data point (use different ones per scene, not the same one every time):

- Hero number centered with a full-width fill behind it
- Number tucked in a corner while the fill dominates the frame
- Number counting up inside a growing shape
- Number as a label attached to the top of a rising bar
- Split frame — number on one side, visual metaphor on the other
- Number revealed AFTER the visual completes (fill finishes, then number snaps in)
- Number embedded in a sentence ("We reached **2.5M** users" with the number scaled up and highlighted)
- Number as a physical element (the digits themselves grow/shrink/move to represent the data)

### The Frame IS the Scale

Use the full screen width or height as the 100% reference. "47% market share" = a fill that covers 47% of the frame width. The viewer sees the proportion instantly because the screen is the container. No axes needed. The unfilled space communicates the remaining amount just as powerfully.

### Time Replaces the X-Axis

Instead of a line chart showing months, reveal each month's value sequentially — same position on screen, the fill or number changes. The viewer feels the trend through rhythm. Growing fills build momentum. Shrinking fills create tension.

### Position Encodes Meaning

Higher values physically higher on screen. Growth on the right, decline on the left. The viewer reads spatial position without any legend.

### Color Reinforces Emotion

Animate background color or accent element colors during data reveals — this is one of the most powerful techniques and should be used in most data scenes. The color shift happens WITH the data reveal, not separately:

- Growth → background warms (shift toward accent color) as the fill expands
- Decline → background desaturates or cools as the value shrinks
- Achievement → brief flash of accent color when a target is hit
- Danger/warning → background shifts toward deep red
- Comparison → the winning side's color intensifies while the losing side dims

## Techniques

These are descriptions, not templates. Implement them differently each time — the LLM knows GSAP well enough to build any of these from the description alone.

- **Count-up** — animate a number from 0 to its final value using GSAP's `onUpdate` callback with `snap`. Pair it with a visual that grows simultaneously.
- **Proportional fill** — a shape fills to represent the value. The unfilled space is just as meaningful. Use width, height, or clip-path — don't default to scale for everything.
- **Reduction** — start full, shrink to the actual value. Powerful for small percentages or losses. The viewer watches something disappear.
- **Threshold hit** — show where the target is, then animate the actual value toward it. The moment of reaching (or missing) the target is the drama.
- **Sequential comparison** — show value A with a fill, hold, then show value B in the same space. The viewer compares to their memory. More dramatic than side-by-side.
- **Color temperature shift** — background or accent elements shift color as data is revealed. Growth warms. Loss cools. Achievement flashes.
- **Spatial stacking** — represent quantity by stacking visual marks (blocks, dots, lines) that accumulate to fill a space.
- **Reveal through motion** — the animation speed itself conveys data. Fast sweep = fast performance. Slow fill = slow growth. The timing IS information.

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
