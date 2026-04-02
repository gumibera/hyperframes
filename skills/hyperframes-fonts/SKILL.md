---
name: hyperframes-fonts
description: Font management for HyperFrames compositions. Use when selecting fonts, troubleshooting missing/broken fonts in renders, or when a composition needs fonts that work reliably in Docker and offline environments.
trigger: Font selection, font loading issues, broken text in renders, tofu boxes, "Unresolved font families" warnings, Docker font failures, adding custom fonts, @font-face setup, Google Fonts integration.
---

# Fonts

Fonts are the most common cause of render differences between preview and production. Preview runs in your local browser (which has system fonts), but render and Docker mode use headless Chrome with no system fonts. If a font isn't explicitly loaded, text falls back to a generic serif/sans-serif and looks wrong.

**Rule: every font used in a composition must be explicitly loaded.** Never rely on system fonts.

## How Font Resolution Works

When you run `npx hyperframes render`, the compiler:

1. Scans all HTML for `font-family` declarations (CSS and inline styles)
2. Checks each family against the **embedded font database** (woff2 files bundled in the CLI)
3. For matched fonts, injects `@font-face` rules with base64 data URIs into `<head>`
4. For unmatched fonts, logs a warning: `[Compiler] Unresolved font families left dynamic: ...`

Dynamic (unresolved) fonts fall back to Google Fonts `@import` or `<link>` tags in the HTML. This works locally but **fails in Docker** and offline renders where the container can't reach `fonts.googleapis.com`.

## Embedded Font Database

These fonts are bundled in the CLI and always work, even offline and in Docker:

| Font           | Weights       | Alias for                          |
| -------------- | ------------- | ---------------------------------- |
| Inter          | 400, 700, 900 | Helvetica Neue, Helvetica, Arial   |
| Montserrat     | 400, 700, 900 | Futura, DIN Alternate, Arial Black |
| Outfit         | 400, 700, 900 |                                    |
| Nunito         | 400, 700, 900 |                                    |
| Oswald         | 400, 700      |                                    |
| League Gothic  | 400           | Bebas Neue                         |
| Archivo Black  | 400           |                                    |
| Space Mono     | 400, 700      |                                    |
| IBM Plex Mono  | 400, 700      |                                    |
| JetBrains Mono | 400, 700      | Courier New, Courier               |
| EB Garamond    | 400, 700      | Garamond                           |

**If a font is in this list or has an alias, it just works.** No extra setup needed.

## Adding Fonts Not in the Database

For fonts outside the embedded database, you must download the font file and include it in the project. This is the only approach that guarantees the font works everywhere.

### Step 1: Download the woff2 file

Get the font from Google Fonts, fontsource, or the font's official site:

```bash
# From Google Fonts (use the CSS API to find the woff2 URL)
curl -s "https://fonts.googleapis.com/css2?family=Poppins:wght@400;700;900&display=block" \
  -H "User-Agent: Mozilla/5.0" | grep -o 'https://[^)]*\.woff2' | head -3

# Download each weight
curl -o poppins-400.woff2 "https://fonts.gstatic.com/s/poppins/v22/..."
curl -o poppins-700.woff2 "https://fonts.gstatic.com/s/poppins/v22/..."
```

Or use fontsource npm packages:

```bash
npm install @fontsource/poppins
cp node_modules/@fontsource/poppins/files/poppins-latin-400-normal.woff2 ./poppins-400.woff2
cp node_modules/@fontsource/poppins/files/poppins-latin-700-normal.woff2 ./poppins-700.woff2
```

### Step 2: Add @font-face rules in the composition

Place the woff2 files in the project root (next to `index.html`) and reference them:

```html
<style>
  @font-face {
    font-family: "Poppins";
    src: url("poppins-400.woff2") format("woff2");
    font-weight: 400;
    font-style: normal;
    font-display: block;
  }
  @font-face {
    font-family: "Poppins";
    src: url("poppins-700.woff2") format("woff2");
    font-weight: 700;
    font-style: normal;
    font-display: block;
  }
</style>
```

**Use `font-display: block`** so the browser waits for the font to load before rendering. Without it, the first few frames may capture fallback text.

### Step 3: Verify in render

```bash
npx hyperframes render --quality draft
```

If the font loads correctly, no "Unresolved font families" warning will appear (the compiler skips families that already have `@font-face` rules).

## Google Fonts via @import (Not Recommended for Production)

This works in preview and local render but **fails in Docker**:

```html
<style>
  @import url("https://fonts.googleapis.com/css2?family=Poppins:wght@400;700&display=block");
</style>
```

The compiler inlines the CSS from the `@import`, but the woff2 files are still fetched from `fonts.gstatic.com` at render time. In Docker containers without network access, these requests fail silently and text falls back to a generic font.

**Use `@import` only for iteration.** Before final render, download the woff2 files and switch to local `@font-face`.

## Choosing Fonts for Compositions

### Safe defaults (embedded, zero setup)

| Use case         | Recommended             | Why                                                |
| ---------------- | ----------------------- | -------------------------------------------------- |
| Clean sans-serif | Inter                   | Most versatile, 3 weights, aliases Helvetica/Arial |
| Bold headings    | Montserrat 900          | High impact, aliases Futura                        |
| Condensed titles | Oswald or League Gothic | Tall, narrow letterforms                           |
| Code/monospace   | JetBrains Mono          | Clear at small sizes, aliases Courier              |
| Elegant serif    | EB Garamond             | Classic editorial feel                             |

### When you need a specific font

1. Check if it has an alias in the embedded database (e.g., "Helvetica" maps to Inter)
2. If not, download the woff2 and add `@font-face` rules
3. Only include the weights you actually use (each weight adds 20-50KB to the project)

### CJK fonts (Chinese, Japanese, Korean)

CJK fonts are large (2-8MB per weight). They are NOT in the embedded database.

```bash
# Download Noto Sans JP (Japanese) - just the weights you need
npm install @fontsource/noto-sans-jp
cp node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff2 ./noto-sans-jp-400.woff2
```

Then add the `@font-face` rule as shown above. For CJK, consider using only one weight (400) to keep project size manageable.

### Emoji

Emoji rendering depends on the platform:

- **macOS/local render**: Apple Color Emoji (works automatically)
- **Docker/Linux**: No emoji font installed by default. Add `noto-color-emoji` to the Docker image or avoid emoji in compositions meant for Docker rendering.

## Troubleshooting

### "Unresolved font families left dynamic: ..."

The font isn't in the embedded database and has no local `@font-face` rule. Fix: download the woff2 and add `@font-face` (see above).

### Text looks wrong in render but fine in preview

Preview uses your system fonts; render uses headless Chrome with only embedded fonts. Download the font and add it to the project.

### Text looks wrong in Docker but fine in local render

Local render can still reach Google Fonts CDN; Docker can't. Download the woff2 files and use local `@font-face` rules.

### Tofu boxes (small rectangles instead of characters)

The font doesn't support the characters you're using. Common with CJK text when using a Latin-only font. Use Noto Sans JP/SC/KR for CJK, Noto Sans Arabic for Arabic, etc.

### First frame has wrong font, rest are fine

Missing `font-display: block`. The browser renders with a fallback font before the custom font loads. Add `font-display: block` to all `@font-face` rules.

## Sub-Composition Fonts

Each sub-composition that uses a font must either:

- Have its own `@font-face` rules, OR
- Use a font from the embedded database (auto-injected by the compiler)

The compiler injects `@font-face` rules per-file, not globally. If a sub-composition uses "Poppins" but only the root has the `@font-face`, the sub-composition will fall back.

For local font files, reference them with `../` from sub-compositions:

```html
<!-- compositions/intro.html -->
<style>
  @font-face {
    font-family: "Poppins";
    src: url("../poppins-400.woff2") format("woff2");
    font-weight: 400;
    font-display: block;
  }
</style>
```
