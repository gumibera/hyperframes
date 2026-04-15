# Asset Sourcing Guide

How to find and download free assets when the capture doesn't have what you need, or when there's no capture at all.

**Rule:** Only source assets when the video plan references something that doesn't exist in `assets/`. Don't speculatively download 30 images "just in case."

## Brand Logos (SVG)

**Simple Icons** — 3000+ brand logos, SVG, CC0 license, no rate limit.

```bash
# Download by brand name (lowercase, no spaces)
curl -o assets/svgs/stripe.svg "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/stripe.svg"
curl -o assets/svgs/vercel.svg "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/vercel.svg"
curl -o assets/svgs/github.svg "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/github.svg"
```

Brand names: use the slug from [simpleicons.org](https://simpleicons.org). Common ones: `stripe`, `vercel`, `notion`, `figma`, `slack`, `discord`, `github`, `linear`, `openai`, `anthropic`, `google`, `apple`, `microsoft`, `amazon`, `netflix`, `spotify`, `airbnb`, `uber`, `coinbase`, `shopify`.

These SVGs are monochrome (single path). To use with brand colors, set `fill` in CSS or inline:

```html
<img src="../assets/svgs/stripe.svg" style="height:32px;filter:brightness(0) invert(1);" />
<!-- Or inline and set fill -->
```

## Company Logos (PNG)

**Clearbit Logo API** — Any company's logo by domain. No API key. PNG format.

```bash
curl -o assets/logo-stripe.png "https://logo.clearbit.com/stripe.com"
curl -o assets/logo-linear.png "https://logo.clearbit.com/linear.app"
curl -o assets/logo-notion.png "https://logo.clearbit.com/notion.so"
```

Returns the company's actual logo (usually with transparency). Size varies. Use when you need a full-color logo, not just the icon.

## Icons (SVG)

**Lucide** — 5000+ open-source icons, SVG, ISC license. Consistent 24x24 viewBox, 2px stroke.

```bash
# Download by icon name (kebab-case)
curl -o assets/svgs/icon-chart.svg "https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/bar-chart-3.svg"
curl -o assets/svgs/icon-shield.svg "https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/shield-check.svg"
curl -o assets/svgs/icon-zap.svg "https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/zap.svg"
curl -o assets/svgs/icon-globe.svg "https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/globe.svg"
```

Common categories:

- **Business:** `briefcase`, `building-2`, `users`, `trending-up`, `dollar-sign`, `credit-card`
- **Tech:** `code-2`, `terminal`, `database`, `server`, `cpu`, `wifi`, `smartphone`
- **UI:** `check-circle`, `x-circle`, `alert-triangle`, `info`, `search`, `settings`, `menu`
- **Media:** `play`, `pause`, `volume-2`, `camera`, `image`, `film`, `music`
- **Communication:** `mail`, `message-circle`, `phone`, `send`, `at-sign`
- **Data:** `bar-chart-3`, `pie-chart`, `activity`, `line-chart`, `table`
- **Security:** `shield-check`, `lock`, `key`, `fingerprint`, `eye`, `eye-off`
- **Arrows:** `arrow-right`, `arrow-up-right`, `chevron-right`, `move`, `maximize-2`

Browse all at [lucide.dev/icons](https://lucide.dev/icons).

Lucide SVGs use `stroke="currentColor"`. Style with CSS:

```html
<img
  src="../assets/svgs/icon-zap.svg"
  style="width:48px;height:48px;filter:brightness(0) invert(1);"
/>
```

Or for inline SVGs, set `stroke` directly.

## Photos (Unsplash)

**Unsplash** — Free high-quality photos. Direct image URLs work without an API key.

For direct downloads (no API key needed), use the image CDN URL:

```bash
# Download by photo ID (find IDs by browsing unsplash.com)
curl -L -o assets/photo-hero.jpg "https://images.unsplash.com/photo-{photo-id}?w=1920&q=80"

# Example with a real photo ID
curl -L -o assets/photo-office.jpg "https://images.unsplash.com/photo-1497366216548-37526070297c?w=1920&q=80"
```

For search (needs UNSPLASH_ACCESS_KEY env var):

```bash
# Search and get URLs
curl -s "https://api.unsplash.com/search/photos?query=fintech+dashboard&per_page=5" \
  -H "Authorization: Client-ID ${UNSPLASH_ACCESS_KEY}" | jq '.results[].urls.regular'
```

**If no API key is available**, browse unsplash.com manually for a photo ID, or use a CSS gradient / solid color background. Don't block the video on missing photos — a well-designed composition with no photo beats a bad photo.

**Attribution:** Unsplash photos are free but appreciate attribution. Add a comment in the HTML: `<!-- Photo: unsplash.com/photos/{id} by {photographer} -->`.

## When to Source

| Situation                                           | Action                                 |
| --------------------------------------------------- | -------------------------------------- |
| Video plan mentions "logo wall" or "customer logos" | Source brand SVGs from Simple Icons    |
| Scene needs a specific company's logo               | Source from Clearbit by domain         |
| Scene references icons (features, benefits, stats)  | Source from Lucide by keyword          |
| Hero scene needs a photo and none exists            | Source from Unsplash or use CSS art    |
| Capture already has the asset in `assets/`          | Use the local file — don't re-download |
| Asset is decorative and optional                    | Skip it — ship without and iterate     |

## Naming Convention

```
assets/
├── svgs/
│   ├── stripe.svg          ← brand logos (name = brand slug)
│   ├── icon-chart.svg      ← icons (prefix with icon-)
│   └── logo-company.svg    ← company logos
├── photo-hero.jpg           ← photos (prefix with photo-)
├── logo-stripe.png          ← Clearbit logos (prefix with logo-)
└── ...
```

## In Compositions

```html
<!-- Local brand SVG -->
<img src="../assets/svgs/stripe.svg" crossorigin="anonymous" style="height:28px;" />

<!-- Clearbit logo -->
<img src="../assets/logo-stripe.png" crossorigin="anonymous" style="height:40px;" />

<!-- Lucide icon -->
<img src="../assets/svgs/icon-zap.svg" crossorigin="anonymous" style="width:32px;height:32px;" />

<!-- Remote Clearbit (works without download, but prefer local) -->
<img src="https://logo.clearbit.com/stripe.com" crossorigin="anonymous" style="height:40px;" />
```

Always add `crossorigin="anonymous"` to external or downloaded assets.
