# Phase 1: Understand Reference

How to run the capture and read the output before writing any code.

Phase 1 is complete when you can fill in the site summary at the bottom of this document from memory — without re-reading the files.

---

## Step 1: Run the Capture

```bash
npx hyperframes capture <URL> -o captures/<project-name>
```

If the built CLI is not available, fall back to:

```bash
npx tsx packages/cli/src/cli.ts capture <URL> -o captures/<project-name>
```

Optional flags:

- `--split` — also extract per-section HTML sub-compositions. Use when you want to embed real website markup as video scenes, not just screenshots.
- No API keys required — all extraction runs locally.

After the command finishes, print a one-line confirmation: how many screenshots, assets, sections, and fonts were extracted.

---

## Step 2: Read and Summarize

The pattern: read each file, write a 1-2 sentence summary to working memory, then move on. Do not go back. The goal is a compact mental model of the site — not a detailed audit.

Work through three tiers.

### Tier 1 — Must Read (do not skip)

These four files are the minimum viable understanding of the site. Skipping any of them will produce off-brand output.

**`screenshots/full-page.png`** — View the image. Describe the mood in one sentence: color temperature, density, energy level. Note which section takes up the most visual real estate.

**`extracted/tokens.json`** — Read and extract: top 3-5 colors in HEX with their apparent roles (background, primary text, accent, CTA), font families with weights, total section count.

**`extracted/visible-text.txt`** — Read for context: note the main headline, tagline, and 2-3 key selling points or value propositions. These are your copywriting inputs for narration.

**`extracted/asset-descriptions.md`** — Read and note the most visually striking 3-5 assets. These are your candidates for hero scenes and b-roll.

### Tier 2 — Read If Exists

These files are conditional — check for existence first, then read only if present.

**`extracted/animations.json`** — Does the site use scroll triggers, marquees, canvas-based effects? Note the dominant animation pattern (fade-in-on-scroll vs. heavy JS vs. static). This informs motion vocabulary choices in Steps 4 and 5.

**`extracted/lottie-manifest.json`** — If present, view the preview images at `assets/lottie/previews/`. The JSON filenames are often meaningless — the previews tell you what each animation actually looks like. Note which previews are worth embedding.

**`extracted/video-manifest.json`** — If present, view the preview screenshots at `assets/videos/previews/`. Note which videos show the actual product UI or branded motion — those are high-value scene assets.

**`extracted/shaders.json`** — If present, read the GLSL source. Note whether the site uses noise functions, distortion, or particle systems. These can inspire matching WebGL effects in the composition.

### Tier 3 — On Demand

Do not read these proactively. Use them only when a specific scene plan requires an asset you haven't seen.

**Individual images in `assets/`** — Use `extracted/asset-descriptions.md` as the index. Open specific images when a scene plan references them by name or position.

**`extracted/assets-catalog.json`** — Use when you need remote URLs for assets that were not downloaded locally. Prefer local files from `assets/` whenever they exist.

### Rich Captures (30 or More Images)

If the `assets/` directory contains 30 or more image files, do not read them sequentially — that wastes context. Instead, launch a sub-agent with the following instruction:

> "View every image file in `assets/` and return a compact catalog: one line per image with filename, subject, and a suggested use (hero, logo, product UI, background, icon, decoration, skip)."

Use the sub-agent's catalog as your Tier 3 index for the rest of Phase 1.

---

## Gate: Print the Site Summary

Before proceeding to DESIGN.md, print this block in full. If you cannot fill in a field, go back and read the relevant file.

```
Site:     [site name and one-phrase description]
Colors:   [top 3-5 HEX values] — [role for each: background / primary text / accent / CTA / border]
Fonts:    [font families and weights, e.g. "Inter 400/600/700, Lato 300"]
Sections: [count] sections, [count] headings, [count] CTAs
Assets:   [3-5 most useful assets for video, with filenames or URLs]
Vibe:     [one sentence describing the visual identity — tone, energy, aesthetic direction]
```

Example:

```
Site:     Linear — project management tool for software teams
Colors:   #0F0F10 (background), #FFFFFF (primary text), #5E6AD2 (accent), #F2C94C (highlight), #2D2D2D (surface)
Fonts:    Inter 400/500/600, SF Mono 400
Sections: 8 sections, 14 headings, 3 CTAs
Assets:   assets/image-0.png (hero product screenshot), assets/svgs/logo-0.svg (wordmark), assets/image-3.png (team view UI), assets/image-7.png (dark command palette), https://linear.app/og.png (social card)
Vibe:     Dark, precise, and minimal — engineered restraint with a single violet accent that reads as calm authority.
```

Once the summary block is printed, Phase 1 is complete. Proceed to creating DESIGN.md.
