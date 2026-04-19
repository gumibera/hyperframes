# Step 7: Validate & Deliver

## Lint + Validate

Run in sequence. Fix all errors before proceeding to the next command.

```bash
npx hyperframes lint
npx hyperframes validate
```

`lint` checks HTML structure statically — missing attributes, timeline registration, tween conflicts, CSS transform + GSAP conflicts (including inline styles).
`validate` loads the composition in headless Chrome and catches runtime JS errors, missing assets, and failed network requests.

## Visual Verification (snapshot)

After lint and validate pass, capture snapshot frames to SEE your own output. **Always use `hyperframes snapshot`** — do not roll your own ffmpeg/headless Chrome script; the default naming (`frame-XX-at-Ys.png`) is expected by later tooling.

```bash
npx hyperframes snapshot <project-dir> --at <beat-midpoints>
```

If the snapshot command isn't available, fall back to:

```bash
npx tsx packages/cli/src/cli.ts snapshot <project-dir> --at <beat-midpoints>
```

Calculate the midpoint of each beat from your STORYBOARD.md timings. For a 4-beat video with beats at 0-5.8s, 5.8-15.0s, 15.0-22.5s, 22.5-25.3s:

```bash
npx hyperframes snapshot <project-dir> --at 2.9,10.4,18.7,23.9
```

This renders one frame per beat at the moment when content is most visible. Use timestamps where the most content is on screen — usually 60-70% into each beat, after entrances finish but before exits start. Output lands in `<project-dir>/snapshots/` with filenames like `frame-00-at-2.9s.png`.

**View every snapshot image carefully.** Don't glance and move on. For each frame, check:

**Visibility:**

- Is there visible content? All-white or all-black frames mean compositions aren't rendering.
- Can you read ALL text? White text on white/light background is invisible. Dark text on dark background is invisible. Every text element needs contrast against what's directly behind it.
- Are images and assets showing? Empty space where an image should be means a path issue or missing file.

**Positioning and layout:**

- Do background images fill the entire frame? If an image only covers half the screen, the `object-fit`, `width`, `height`, or position values are wrong.
- Are elements where the storyboard says they should be? Compare the snapshot to the beat description.
- Is there too much empty/dead space? If more than 40% of the frame is a flat solid color with nothing on it, the composition is sparse.
- Are elements overlapping incorrectly? Text over text, or content bleeding off the edges?

**Visual quality:**

- Are overlays too heavy? If a background image is barely visible through a dark overlay, reduce the overlay opacity.
- Is the visual hierarchy clear? One dominant element per frame, supporting elements secondary.
- Do the colors match DESIGN.md? Check actual rendered colors against what was planned.

**Code vs. rendered verification:**

- For each beat, check: does the snapshot show the assets you referenced in the HTML? If a composition has `<img src="...wave.png">` but the snapshot shows no wave — the image isn't loading, the path is wrong, or it's hidden behind another element.
- If a snapshot shows nothing at a timestamp, try a slightly different time (1-2 seconds later). Compositions may still be in entrance animations.
- The snapshot command is fast — run it multiple times at different timestamps if needed.

If any frame has issues, go back to Step 6 and fix that composition before proceeding.

## Preview

```bash
npx hyperframes preview
```

Open the studio in a browser. Scrub through every beat.

## Render

Once preview looks correct, render to MP4. **Always pass `--output renders/<project-name>.mp4`** so the final file has a predictable name — do not rely on the timestamped default (`<project>_YYYY-MM-DD_HH-MM-SS.mp4`), which makes files hard to reference from docs/handoffs/CI.

```bash
npx hyperframes render --output renders/<project-name>.mp4
```

Example: `npx hyperframes render --output renders/stripe-launch.mp4`

For social-media vertical output, add `--format` or `--viewport 1080x1920` (depending on CLI flag support); check `npx hyperframes render --help`.

If the final MP4 exceeds ~15 MB for a 30-second video, consider `--quality medium` or `--crf 23` to compress — but verify the quality trade-off on a snapshot pass before accepting.
