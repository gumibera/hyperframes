---
name: website-to-hyperframes
description: |
  Capture a website and build a HyperFrames video project from it. Use this skill whenever: (1) a user provides a URL and wants to create a video from it, (2) someone says "website to hyperframes", "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants video components from an existing website, (4) the user shares a link and asks for any kind of video. Even if the user just pastes a URL — this is the skill to use.
---

# Website to HyperFrames

Capture a website's design (screenshots, colors, fonts, text, animations, assets), then build a clean HyperFrames video project from scratch using that design data.

## How It Works

**Phase 1: Capture** — CLI extracts everything from the website into a data folder  
**Phase 2: Build** — You read the design brief + screenshots and build compositions from scratch using the `/hyperframes` compose skill

The capture produces a `capture-brief.md` file formatted exactly like a detailed video prompt — with hex colors, font names, exact text, animation timing. You read this brief, look at the screenshots, and build compositions the same way you'd build from a test prompt.

## Execution Rules

Every step has an **OUTPUT GATE**. Print the required output before proceeding.

## Step 1: Capture the website

```bash
npx hyperframes capture --help 2>/dev/null && npx hyperframes capture <URL> -o <project-name> || npx tsx packages/cli/src/cli.ts capture <URL> -o <project-name>
```

**OUTPUT GATE**: Print the capture output (sections, screenshots, assets, fonts).

✅ Step 1 complete

## Step 2: Read the design brief

Read these files:

1. `<project>/capture-brief.md` — **THE MAIN DESIGN SPEC.** This is your blueprint.
2. `<project>/visual-style.md` — brand colors, fonts, mood

**OUTPUT GATE**: Print a summary:

```
| Info | Value |
|------|-------|
| Sections | [N content sections from the brief] |
| Colors | [primary hex colors] |
| Fonts | [font names + local files if any] |
| Assets | [N images, N SVGs] |
| Suggested duration | [Ns] |
```

✅ Step 2 complete

## Step 3: Study each section screenshot

For each section in the brief, **READ its screenshot image**. Describe:

- Layout (columns, grid, centered, sidebar)
- Key visual elements (hero image, cards, logo bar, chart)
- Color usage (dark bg with light text, gradient, etc.)
- Overall feel (minimal, busy, corporate, playful)

**OUTPUT GATE**: Print a description table:

```
| Section | Screenshot | Layout | Key Elements | Mood |
|---------|-----------|--------|-------------|------|
| Meet the night shift | section-00.png | Centered hero, dark navy bg | h1, 2 CTAs, agent icons, logo bar | Bold, techy |
| Keep work moving | section-03.png | ... | ... | ... |
| ... | ... | ... | ... | ... |
```

Decide which sections to include/skip (navbar-only and footer-only sections → skip).

✅ Step 3 complete

## Step 4: Build the HyperFrames project

**Invoke `/hyperframes` BEFORE writing any composition code.**

1. Create a new project: `npx hyperframes init <new-project-name>`
2. For each section you're keeping, build a scene in the composition
3. Use **exact values from the brief**: hex colors, font names, heading text, CTA text
4. Use **screenshots as visual reference**: match the layout, spacing, element arrangement
5. Reference **`<capture-project>/assets/`** for downloaded images and SVGs
6. Apply GSAP animations using timing from the brief's "Animations" data

**Key rules for building:**

- **Clean HTML/CSS from scratch** — do NOT copy the 800KB extracted HTML
- **Match the screenshot** — your composition should look like the screenshot
- **Use exact brand values** — hex colors from the brief, not approximations
- **Reference local assets** — `<capture-project>/assets/image-0.jpg`, not remote URLs
- **Font loading** — use `@font-face` with local font files if listed in the brief, or Google Fonts CDN
- **Composition size** — each section should be ~5-20KB, not 800KB

**Animation guidance** — read [animation-recreation.md](./references/animation-recreation.md) for converting the source site's animation data to GSAP. The brief lists what animations the original site used per section.

**OUTPUT GATE**: Print what was built:

```
| Scene | Duration | Elements | Animations |
|-------|----------|----------|-----------|
| Hero | 5s | h1, 2 CTAs, logo bar | heading slide-up, CTAs stagger, logos marquee |
| Features | 5s | h2, 3 bento cards | cards stagger entrance, images scale-in |
| ... | ... | ... | ... |
```

✅ Step 4 complete

## Step 5: Lint, validate, preview

```bash
npx hyperframes lint <new-project-name>
npx hyperframes validate <new-project-name>
```

Fix ALL errors before previewing.

```bash
npx hyperframes preview <new-project-name>
```

**Note:** Use `npx hyperframes preview` (built CLI), not `npx tsx ... preview`.

**OUTPUT GATE**: Print final summary:

```
## Ready
- Preview: http://localhost:XXXX
- Scenes: N built from website capture
- Duration: Ns total
- Source: <URL>
- Next steps: customize, add narration, render to MP4
```

✅ Step 5 complete

## Key Rules

1. **Brief is your design spec, screenshots are your visual spec.** Read both.
2. **Build from scratch, don't edit extracted HTML.** Clean 5-20KB compositions, not 800KB HTML files.
3. **Use exact values.** Hex colors, font names, text content — all from the brief.
4. **Reference local assets.** Use `assets/image-0.jpg`, not remote CDN URLs.
5. **Invoke `/hyperframes`** before writing any composition code — it has the guardrails.
6. **Match the screenshot layout.** Columns, spacing, element positions should feel like the original.

## Reference Files

| File                                                            | When to read                                       |
| --------------------------------------------------------------- | -------------------------------------------------- |
| [animation-recreation.md](./references/animation-recreation.md) | Step 4 — converting source animations to GSAP      |
| [section-refinement.md](./references/section-refinement.md)     | Step 4 — tips for building from brief + screenshot |
| [video-recipes.md](./references/video-recipes.md)               | Building videos — scene patterns                   |
| [tts-integration.md](./references/tts-integration.md)           | Adding narration                                   |
