# Building from Brief + Screenshot

Tips for building HyperFrames compositions from the capture brief and screenshots.

## The Workflow

1. Read the section's entry in `capture-brief.md` for exact data
2. Read the section's screenshot for visual layout
3. Build clean HTML/CSS that recreates the design
4. Add GSAP animations using timing from the brief

## Matching the Screenshot

### Layout

- Count columns in the screenshot. If you see 3 cards side by side → use CSS grid or flexbox with 3 columns
- Check alignment: centered text, left-aligned content, split layouts
- Note spacing: are elements tightly packed or breathing with margins?

### Colors

- Use exact hex values from the brief, not visual approximations
- Check background: solid color, gradient, or image?
- Note color contrast: light text on dark, dark text on light

### Typography

- Use the font from the brief (check `visual-style.md`)
- Match heading sizes: hero headings are typically 48-72px, sub-headings 24-36px
- Match weight: bold headings (700-900), regular body (400)

### Images & Assets

- Use downloaded assets from `assets/` (images, SVGs, favicon)
- Reference by relative path: `../notion/assets/image-0.jpg`
- If an image wasn't captured, use a CSS gradient or shape placeholder

## Common Mistakes

### Building too literally

Don't try to recreate every pixel. Focus on the **essence**: headline, key visual, CTA, color scheme. A 5-second video scene only shows so much.

### Ignoring the brief's animation data

The brief lists what animations the original site used (entrance duration, easing). Use these values instead of inventing generic ones.

### Missing brand colors

Every section in the brief has a background color. Use it. Don't default to white or black unless the brief says so.

### Wrong font

Check if local font files exist in `assets/fonts/`. If yes, add `@font-face` declarations. If not, use Google Fonts or a system font that matches the style.

### Referencing remote URLs

Use local asset paths, not `https://notion.com/...`. The capture downloaded assets for offline use.

## When to Simplify

**Match exactly:**

- Heading text, font, color
- Background color/gradient
- CTA button text and colors
- Overall layout (grid vs stacked vs centered)

**OK to simplify:**

- Complex nested card layouts → capture the visual essence
- Decorative SVG illustrations → use a simpler CSS shape or skip
- Hover states, interactive elements → not relevant for video
- Cookie banners, popups, navigation → skip

## Screenshot Fallback

If a section is too complex to rebuild (e.g., 3D WebGL visualization), use the screenshot as a background:

```html
<div style="position: absolute; inset: 0;">
  <img
    src="../capture-project/screenshots/section-03.png"
    style="width: 100%; height: 100%; object-fit: cover;"
  />
</div>
```

Then animate on top of it (text overlays, motion graphics).

## Quality Checklist

Before considering a section done:

- [ ] Visually matches the screenshot (layout, colors, spacing)
- [ ] Uses exact brand colors from the brief
- [ ] Uses exact heading/CTA text from the brief
- [ ] References local assets (not remote URLs)
- [ ] Has meaningful GSAP animations (not just fade in/out)
- [ ] Passes `npx hyperframes lint`
