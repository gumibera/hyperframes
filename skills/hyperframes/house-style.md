# House Style

Creative direction for compositions when no `visual-style.md` is provided. These are starting points — override anything that doesn't serve the content.

## Before Writing HTML

1. **Interpret the prompt.** Generate real content. A recipe lists real ingredients. A HUD has real readouts.
2. **Pick a palette.** Light or dark? Declare bg, fg, accent before writing code.
3. **Pick typefaces.** Run the font discovery script in [references/typography.md](references/typography.md) — or pick a font you already know that fits the theme. The script broadens your options; it's not the only source.

## Lazy Defaults to Question

These patterns are AI design tells — the first thing every LLM reaches for. If you're about to use one, pause and ask: is this a deliberate choice for THIS content, or am I defaulting?

- Gradient text (`background-clip: text` + gradient)
- Left-edge accent stripes on cards/callouts
- Cyan-on-dark / purple-to-blue gradients / neon accents
- Pure `#000` or `#fff` (tint toward your accent hue instead)
- Identical card grids (same-size cards repeated)
- Everything centered with equal weight (lead the eye somewhere)
- Banned fonts (see [references/typography.md](references/typography.md) for full list)

If the content genuinely calls for one of these — centered layout for a solemn closing, cards for a real product UI mockup, a banned font because it's the perfect thematic match — use it. The goal is intentionality, not avoidance.

## Color

- Match light/dark to content: food, wellness, kids → light. Tech, cinema, finance → dark.
- One accent hue. Same background across all scenes.
- Tint neutrals toward your accent (even subtle warmth/coolness beats dead gray).
- **Contrast:** enforced by `hyperframes validate` (WCAG AA). Text must be readable with decoratives removed.
- Declare palette up front. Don't invent colors per-element.

## Background Layer

Every scene needs visual depth — persistent decorative elements that stay visible while content animates in. Without these, scenes feel empty during entrance staggering.

**Rule: domain-native chrome before editorial chrome.** Before reaching for generic editorial decoratives, ask: _"what chrome would the actual thing in this scene have?"_ If the composition depicts a real system — an instrument, a tool, a piece of hardware, a type of document — its own native chrome belongs in the scene first. Generic editorial decoratives are a fallback for abstract/brand content that has no domain vocabulary to draw from.

### Domain-native chrome (prefer these when content has a domain)

| Domain                | Native chrome to use                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Medical / instrument  | Bracket annotations on anomalies, lead labels (`LEAD I`), sampling rate (`256Hz`), rhythm labels (`SINUS / PVC`) |
| Scanner / loader      | Progress bar, status LED, frame ID, resolution readout, value flicker during operation                           |
| Financial / dashboard | Account chips with institution names, balance deltas with sign, per-transaction timestamps, tabular-num columns  |
| Vector editor / CAD   | Anchor dots, bezier handles with hairline + filled grip, per-anchor coord readouts, angle arcs at vertices       |
| Map / geographic      | DMS coordinates (`N 43°39′ W 70°15′`), scale bar, elevation, timestamp with LOCAL/UTC                            |
| Film / photo          | Perforation rails, frame numbers (`F-12`), film stock / roll code (`KODAK · JUL 1973 · ROLL 012`)                |
| Code / terminal       | Prompt character, line numbers, syntax color, cursor blink, scrollback indicator                                 |
| Audio / DAW           | Waveform envelope, dB meter, timecode (`01:23:45`), track labels, solo/mute indicators                           |

If the composition's domain isn't in this table, build the equivalent — _what would exist on the actual thing?_ The chrome you add becomes part of the scene's world, not pasted on top of it.

### Editorial fallbacks (use when content is abstract/brand with no domain)

Mix and match, still 2–5 per scene:

- Radial glows (accent-tinted, low opacity, breathing scale)
- Ghost text (theme words at 3–8% opacity, very large, slow drift)
- Accent lines (hairline rules, subtle pulse)
- Grain/noise overlay, geometric shapes, grid patterns

### How to tell which you need

- Pure brand/tagline/mood content → editorial fallbacks are correct
- Product demo, instrument readout, tool UI, data system → domain-native chrome required; editorial fallbacks only as secondary layer
- Mixed (brand + product) → domain-native on the product scenes, editorial on the pure-brand scenes

All decoratives should have slow ambient GSAP animation — breathing, drift, pulse. Static decoratives feel dead.

## Motion

See [references/motion-principles.md](references/motion-principles.md) for full rules. Quick: 0.3–0.6s, vary eases, combine transforms on entrances, overlap entries.

## Typography

See [references/typography.md](references/typography.md) for full rules. Quick: 700-900 headlines / 300-400 body, serif + sans (not two sans), 60px+ headlines / 20px+ body.

## Palettes

Declare one background, one foreground, one accent before writing HTML.

| Category          | Use for                                       | File                                                       |
| ----------------- | --------------------------------------------- | ---------------------------------------------------------- |
| Bold / Energetic  | Product launches, social media, announcements | [palettes/bold-energetic.md](palettes/bold-energetic.md)   |
| Warm / Editorial  | Storytelling, documentaries, case studies     | [palettes/warm-editorial.md](palettes/warm-editorial.md)   |
| Dark / Premium    | Tech, finance, luxury, cinematic              | [palettes/dark-premium.md](palettes/dark-premium.md)       |
| Clean / Corporate | Explainers, tutorials, presentations          | [palettes/clean-corporate.md](palettes/clean-corporate.md) |
| Nature / Earth    | Sustainability, outdoor, organic              | [palettes/nature-earth.md](palettes/nature-earth.md)       |
| Neon / Electric   | Gaming, tech, nightlife                       | [palettes/neon-electric.md](palettes/neon-electric.md)     |
| Pastel / Soft     | Fashion, beauty, lifestyle, wellness          | [palettes/pastel-soft.md](palettes/pastel-soft.md)         |
| Jewel / Rich      | Luxury, events, sophisticated                 | [palettes/jewel-rich.md](palettes/jewel-rich.md)           |
| Monochrome        | Dramatic, typography-focused                  | [palettes/monochrome.md](palettes/monochrome.md)           |

Or derive from OKLCH — pick a hue, build bg/fg/accent at different lightnesses, tint everything toward that hue.
