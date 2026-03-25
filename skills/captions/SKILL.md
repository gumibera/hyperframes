---
name: captions
description: Build tone-adaptive captions from whisper transcripts. Detects script energy (hype, corporate, tutorial, storytelling, social) and applies matching typography, color, and animation. Supports per-word styling for brand names, ALL CAPS, numbers, and CTAs. Use when adding captions or subtitles to a HyperFrames composition.
---

# Captions

Analyze the spoken content to determine caption style. If the user specifies a style, use that. Otherwise, detect tone from the transcript.

## Transcript Source

The project's `transcript.json` contains word-level timestamps from whisper.cpp (`--output-json-full` with `--dtw`):

```json
{
  "transcription": [
    {
      "offsets": { "from": 0, "to": 5000 },
      "text": " Hello world.",
      "tokens": [
        { "text": " Hello", "offsets": { "from": 0, "to": 1000 }, "p": 0.98 },
        { "text": " world", "offsets": { "from": 1000, "to": 2000 }, "p": 0.95 }
      ]
    }
  ]
}
```

Normalize tokens into a word array before grouping:

```js
const words = [];
for (const segment of transcript.transcription) {
  for (const token of segment.tokens || []) {
    const text = token.text.trim();
    if (!text) continue;
    words.push({
      text,
      start: token.offsets.from / 1000,
      end: token.offsets.to / 1000,
    });
  }
}
```

If no `transcript.json` exists, check for `.srt` or `.vtt` files. If no transcript is available, ask the user to provide one or run `hyperframes transcribe` (when available).

## Style Detection (Default — When No Style Is Specified)

Read the full transcript before choosing a style. The style comes from the content, not a template.

### Four Dimensions

**1. Visual feel** — the overall aesthetic personality:

- Corporate/professional scripts → clean, minimal, restrained
- Energetic/marketing scripts → bold, punchy, high-impact
- Storytelling/narrative scripts → elegant, warm, cinematic
- Technical/educational scripts → precise, high-contrast, structured
- Social media/casual scripts → playful, dynamic, friendly

**2. Color palette** — driven by the content's mood:

- Dark backgrounds with bright accents for high energy
- Muted/neutral tones for professional or calm content
- High contrast (white on black, black on white) for clarity
- One accent color for emphasis — not multiple

**3. Font mood** — typography character, not specific font names:

- Heavy/condensed for impact and energy
- Clean sans-serif for modern and professional
- Rounded for friendly and approachable
- Serif for elegance and storytelling

**4. Animation character** — how words enter and exit:

- Scale-pop/slam for punchy energy
- Gentle fade/slide for calm or professional
- Word-by-word reveal for emphasis
- Typewriter for technical or narrative pacing

## Per-Word Styling

Scan the script for words that deserve distinct visual treatment. Not every word is equal — some carry the message.

### What to Detect

- **Brand names / product names** — larger size, unique color, distinct entrance
- **ALL CAPS words** — the author emphasized them intentionally. Scale boost, flash, or accent color.
- **Numbers / statistics** — bold weight, accent color. Numbers are the payload in data-driven content.
- **Emotional keywords** — "incredible", "insane", "amazing", "revolutionary" → exaggerated animation (overshoot, bounce)
- **Proper nouns** — names of people, places, events → distinct accent or italic
- **Call-to-action phrases** — "sign up", "get started", "try it now" → highlight, underline, or color pop

### How to Apply

For each detected word, specify:

- Font size multiplier (e.g., 1.3x for emphasis, 1.5x for hero moments)
- Color override (specific hex value)
- Weight/style change (bolder, italic)
- Animation variant (overshoot entrance, glow pulse, scale pop)

## Script-to-Style Mapping

| Script tone          | Font mood                             | Animation                               | Color                                        | Size                 |
| -------------------- | ------------------------------------- | --------------------------------------- | -------------------------------------------- | -------------------- |
| Hype/launch          | Heavy condensed, 800-900 weight       | Scale-pop, back.out(1.7), fast 0.1-0.2s | Bright accent on dark (cyan, yellow, lime)   | Large 72-96px        |
| Corporate/pitch      | Clean sans-serif, 600-700 weight      | Fade + slide-up, power3.out, 0.3s       | White/neutral on dark, single muted accent   | Medium 56-72px       |
| Tutorial/educational | Mono or clean sans, 500-600 weight    | Typewriter or gentle fade, 0.4-0.5s     | High contrast, minimal color                 | Medium 48-64px       |
| Storytelling/brand   | Serif or elegant sans, 400-500 weight | Slow fade, power2.out, 0.5-0.6s         | Warm muted tones, low opacity (0.85-0.9)     | Smaller 44-56px      |
| Social/casual        | Rounded sans, 700-800 weight          | Bounce, elastic.out, word-by-word       | Playful colors, colored backgrounds on pills | Medium-large 56-80px |

## Word Grouping by Tone

Group size affects pacing. Fast content needs fast caption turnover.

- **High energy:** 2-3 words per group. Quick turnover matches rapid delivery.
- **Conversational:** 3-5 words per group. Natural phrase length.
- **Measured/calm:** 4-6 words per group. Longer groups match slower pace.

Break groups on sentence boundaries (`.` `?` `!`), pauses (>150ms gap), or max word count — whichever comes first.

## Positioning

- **Landscape (1920x1080):** Bottom 80-120px, centered
- **Portrait (1080x1920):** Lower middle ~600-700px from bottom, centered
- Never cover the subject's face
- Use `position: absolute` — never relative (causes overflow)
- One caption group visible at a time

## Constraints

- **Deterministic.** No `Math.random()`, no `Date.now()`.
- **Sync to transcript timestamps.** Words appear when spoken.
- **One group visible at a time.** No overlapping caption groups.
- **Check project root** for font files before defaulting to Google Fonts.
