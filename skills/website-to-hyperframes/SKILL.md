---
name: website-to-hyperframes
description: |
  Capture a website and create a HyperFrames video from it. Use when: (1) a user provides a URL and wants a video, (2) someone says "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants a social ad, product tour, or any video based on an existing website, (4) the user shares a link and asks for any kind of video content. Even if the user just pastes a URL — this is the skill to use.
---

# Website to HyperFrames

Capture a website's identity and design system (colors, fonts, components, assets, text, animations), then create on-brand HyperFrames video from it.

## Quick Start

Users can say things like:

- "Capture stripe.com and make me a 20-second product demo video"
- "Turn this website into a 15-second social ad for Instagram"
- "Create a 30-second product tour from linear.app"
- "Make a launch video from my site — portrait format for TikTok"

The workflow: **Capture → Understand!!!! → Create**. That's it.

## Execution

### Step 1: Capture the website

```bash
npx hyperframes capture <URL> -o <project-name>
```

If the built CLI isn't available, fall back to:

```bash
npx tsx packages/cli/src/cli.ts capture <URL> -o <project-name>
```

Optional flags:

- `--split` — also generate per-section compositions (for using real website HTML as video scenes)
- No API keys needed — all extraction is local

**Confirm:** Capture succeeded. Print how many screenshots, assets, sections, and fonts were extracted.

### Step 2: Read ALL (every single, no miss) captured data

You MUST read every single file before writing any code. Do not skip any.

1. **Read and VIEW (actually view and see what is this website's mood, vibe?)** `screenshots/full-page.png` — study every section, component, color, font, layout
2. **Read and ANALYZE** `extracted/tokens.json` — exact hex colors, font families, font weights, headings, CTAs, sections, CSS variables
3. **Read and START BUILDING A WEBSITE OVERVIEW in your mind** `extracted/visible-text.txt` — exact text content from every section of the page
4. **Read and VIEW (actually view and see how and what is it)** `extracted/assets-catalog.json` — every image, video, font, icon URL with HTML context
5. **Browse and VIEW (actually view and see how and what is it)** `assets/svgs/` — open each SVG to identify what it is (company logos, icons, illustrations)
6. **Browse and VIEW (actually view and see how and what is it)** `assets/` — check downloaded images and font files
7. **Read and ANALYZE** `extracted/animations.json` — what animations the site uses (for recreation guidance)

**Confirm:** Print the site title, top colors, fonts, number of sections, number of assets.

### Step 3: Create DESIGN.md

Write a `DESIGN.md` file with these sections:

- **## Overview** — 3-4 sentences: visual identity of the website, design philosophy, vibe, overall feel
- **## Colors** — Brand & neutral colors with exact HEX values from tokens.json. Semantic palette.
- **## Typography** — Every font family with weights and design roles. Sizing hierarchy.
- **## Elevation** — Depth strategy (borders vs shadows vs glassmorphism).
- **## Components** — Name every UI component you see in the screenshot with styling details.
- **## Do's and Don'ts** — Design rules from what the site does and doesn't do.
- **## Assets** — Map every file in assets/ and URL in assets-catalog.json to WHERE it appears and WHAT it shows.

Rules (IMPORTANT):

- Use exact HEX values and font names from tokens.json
- Name components by what you see in the screenshot (Bento Grid, Logo Wall, Pricing Calculator) as much accurate as possible
- You are not REQUIRED to use exact strings from visible-text.txt, but you of course can.
- Be specific and factual

Example of DESIGN.md:

```
# Design System

## Overview
Notion's visual identity is characterized by a "Digital Paper" aesthetic—clean, predominantly monochrome with deliberate pops of functional color. The interface balances high information density with significant whitespace. The tone is sophisticated yet approachable, using hand-drawn style illustrations and "Nosey" character animations to add a human touch to a robust productivity tool. Layouts rely on a rigid bento-box grid system, providing a sense of modularity and organized structure.

## Colors
### Brand & Neutral
- **Base White**: `#FFFFFF` (Surface background, card fills)
- **Text Normal**: `#000000` (Primary headings and body text)
- **Gray 900**: `#1A1A1A` (Dark mode backgrounds and hero contrast)
- **Gray 600**: `#666666` (Subtle captions and secondary text)
- **Gray 200**: `#E9E9E9` (Section backgrounds and dividers)

### Semantic Palette
- **Blue 500**: `#006ADC` (Primary buttons and AI accents)
- **Red Palette**: Used for Enterprise Search and specific use-case icons.
- **Yellow Palette**: Used for Flexible Workflow bento backgrounds.
- **Teal/Green Palette**: Used for Custom Agents and automation features.
- **Purple Palette**: Used for Meeting Notes and specific product UI links.

## Typography
- **Primary Sans**: `NotionInter` (Custom variant of Inter). Weights: 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold). Used for UI, buttons, and primary navigation.
- **Display Serif**: `LyonText`. Used for high-impact quotes and storytelling headers to evoke a traditional publishing feel.
- **Monospace**: `iAWriterMonoS`. Used for technical contexts, code-like accents, or specific metadata.
- **Handwritten**: `Permanent Marker`. Used for illustrative annotations and personality-driven callouts.

## Elevation
- **Border Reliance**: Notion avoids heavy shadows, instead using 1px borders in `var(--color-border-base)` to define surfaces.
- **Bento Elevation**: Cards use a background color shift or subtle border rather than lifting off the page with drop shadows.
- **Layering**: Sticky navigation bars and dropdown menus use high z-index with flat background fills or subtle glass effects in specific sub-themes.

## Components
- **Global Navigation**: A sophisticated sticky header with nested dropdown grids, logo stickerized paths, and clear CTA buttons.
- **Bento Cards**: Rounded-corner rectangles (`--border-radius-600`) containing an eyebrow title, heading, and a descriptive image or video. Variations include "Standard" and "Wide."
- **Interactive Calculator**: A form-based component with checkbox tool selection and numeric inputs for team size, featuring dynamic currency output fields.
- **Logo Marquee**: A continuous horizontal scroll of grayscale brand logos (OpenAI, Toyota, Figma) with specific speed-per-item settings.
- **Download Blocks**: Split-layout cards featuring high-fidelity app previews (Calendar, Mail) and tertiary download buttons.

## Do's and Don'ts
### Do's
- Use generous padding (spacing variables 32, 64, 80) between sections to maintain the "Digital Paper" feel.
- Align illustrations and media within bento cards to the right or center as defined by the grid.
- Use the monochromatic palette for the core interface and reserve colors for specific feature categorization.

### Don'ts
- Do not use heavy drop shadows; favor borders and background contrast for separation.
- Do not mix the serif (LyonText) and sans (Inter) fonts within the same functional button or input.
- Avoid overly saturated gradients; use flat fills or noise textures like `grain.svg` for depth.

## Assets
- **Image**: https://images.ctfassets.net/.../forbes.png — forbes logo in quote section
- **Video**: https://videos.ctfassets.net/.../Desktop_HomepageHero_compressed.mp4 — Homepage Hero Animation
- **Image**: https://www.notion.com/_next/image?url=...calendar...png — Notion calendar app preview
- **Font**: https://www.notion.com/front-static/fonts/NotionInter-Bold.woff2 — Notion Inter Bold
- **Font**: https://www.notion.com/_next/static/media/LyonText-Regular-Web.woff2 — Lyon Text Regular
- **Icon**: https://www.notion.com/front-static/favicon.ico — Notion favicon
- **Video**: https://www.notion.com/front-static/nosey/fall/clip_customAgents.mp4 — Custom Agents clip
- And etc... (the list is shorten version for example purposes)
```

**Confirm:** DESIGN.md written. Print the section headings and 2-3 key values from each.

### Step 4: Plan the video (think like a Creative Director)

You are now a creative director with 20 years of experience making content for YouTube, Instagram, and TikTok. You have unlimited creative freedom. Your job is to design a video that stops the scroll, holds attention, and drives action.

Look at the screenshot, the text, the brand personality. Ask yourself:

- What's the ONE thing that makes this product interesting?
- What hook would make someone stop scrolling in the first 2 seconds?
- What visual sequence tells the story without needing explanation?
- What ending makes them want to click?

Don't think about code yet. Think about storytelling, pacing, and emotion.

#### Write the narration script FIRST

Every good video has a voice. Write the voiceover script BEFORE finalizing scene durations — the narration drives the pacing, not the other way around.

**Rules for the script:**

- 2.5 words per second is natural speaking pace (15s = ~37 words, 30s = ~75 words)
- Write like you're showing someone a product — NOT reading a press release
- Start with energy: "So this is..." / "Check this out..." / "Meet [product]... and similar"
- Use contractions (it's, you'll, that's) and try to write like a real human because robotic speech kills the vibe
- Numbers become words: "135+" → "more than a hundred thirty five", "$1.9T" → "nearly two trillion dollars" and etc.
- End with a casual CTA: "Check it out at stripe dot com" not "Get started at stripe.com"

Save the script as `narration-script.txt`.

#### Then plan the scenes around it

Map each sentence or phrase of the narration to a scene. The narration IS the timeline.

| Type         | Duration | Rhythm                                                   |
| ------------ | -------- | -------------------------------------------------------- |
| Social Ad    | 15s      | Hook (2-3s) → Value (5-7s) → Proof (3-4s) → CTA (2-3s)   |
| Product Tour | 30s      | Hero (5s) → Features (12s) → Trust (6s) → CTA (4s)       |
| Launch Video | 60s      | Problem (10s) → Solution (20s) → Proof (15s) → CTA (10s) |

Keep it short — 15-20 seconds for ads, 20-30 for demos unless USER request specific duration. Shorter videos are easier to nail and perform better.

**Confirm:** Print your scene plan:

| Scene    | Duration | What viewer sees        | What viewer feels | Narration              |
| -------- | -------- | ----------------------- | ----------------- | ---------------------- |
| Hook     | 0-3s     | Hero heading on dark bg | Curiosity         | "So this is Linear..." |
| Features | 3-10s    | Product UI screenshots  | "I need this"     | "Purpose-built for..." |
| ...      | ...      | ...                     | ...               | ...                    |

If the user explicitly says "no narration" or "no voiceover", skip the script and plan scenes with visual-only timing.

### Step 5: Build the video (think like a Senior HyperFrames Engineer)

Switch roles. You are now a senior engineer who specializes in video creation with HyperFrames. A client (the creative director from Step 4) just handed you a video plan with a narration script and you need to execute it at 200% quality.

#### First: generate the audio

Before writing a single line of HTML, produce the voiceover and get word-level timestamps. This gives you EXACT durations for every scene.

1. **Generate TTS** from `narration-script.txt`. Read [tts-integration.md](./references/tts-integration.md) for voice selection and options:
   - **HeyGen TTS** (preferred) — use `mcp__claude_ai_HeyGen__text_to_speech`, returns audio + word timestamps
   - **ElevenLabs** (if available) — use `mcp__elevenlabs__text_to_speech`, wider voice selection
   - **Kokoro** (offline fallback) — `npx hyperframes tts narration-script.txt --voice af_nova --output narration.wav`

2. **Audition 2-3 voices** with the first sentence before committing. Pick the most natural, conversational one — not the most "professional."

3. **Transcribe** for word-level timestamps:

   ```bash
   npx hyperframes transcribe narration.wav
   ```

   This produces `transcript.json` with `[{ text, start, end }]` for every word.

4. **Map timestamps to scenes** — each scene's `data-duration` now comes from the narration, not from guessing.

#### Then: build the compositions

Now invoke `/hyperframes-compose`. Read the entire skill — every rule, every pattern, every anti-pattern. This is your technical bible. Also read:

- [animation-recreation.md](./references/animation-recreation.md) — converting source animations to GSAP
- [video-recipes.md](./references/video-recipes.md) — scene patterns, mid-scene activity, how to keep things alive

Build each scene as a separate sub-composition in `compositions/`. Follow these non-negotiable rules:

**Use real assets — never placeholders:**

- EXACT colors from DESIGN.md (hex values)
- EXACT fonts via @font-face with URLs from assets catalog
- Real product screenshots, SVG logos from assets/svgs/ (IDEALLY AS MANY AS APPROPRIATE)
- If the capture has an asset for something, USE IT!!!

**Make it move:**

- Every element must DO something — not just appear and sit there
- Entrances, mid-scene activity, exits. Read the mid-scene activity table in video-recipes.md.
- Never use `repeat: -1` — calculate exact repeats from scene duration

**Wire up the audio:**

- Add `narration.wav` as an `<audio>` element in root `index.html` on its own track
- Add a captions sub-composition (`compositions/captions.html`) on a parallel track
- Scene durations MUST match the narration timestamps from Step 5.1

**Confirm:** Print what was built (Scene | File | Duration | Elements | Animations).

### Step 6 (IMPORTANT ALWAYS): Lint, validate, preview

```bash
npx hyperframes lint
npx hyperframes validate
npx hyperframes preview
```

Fix ALL errors before previewing. Give specific feedback on what you see in the preview — "scene 3 is too slow", "make the logo bigger", "the transition is jarring" — and iterate.

**Confirm:** Preview URL, number of scenes, total duration, source URL, format.

## Quick Reference

### Video Types

| Type                  | Duration | Scenes                                           | Best For                    |
| --------------------- | -------- | ------------------------------------------------ | --------------------------- |
| Social Ad             | 15s      | 4 (hook, feature, proof, CTA)                    | Instagram, TikTok, LinkedIn |
| Product Tour          | 30s      | 5-6 (hero, features, proof, stats, pricing, CTA) | Website, YouTube            |
| Feature Announcement  | 15s      | 3 (feature name, demo, CTA)                      | Product Hunt, Twitter       |
| Testimonial Spotlight | 15s      | 3 (logo, quote, attribution)                     | LinkedIn, case study        |
| Launch Video          | 60s      | 4 acts (hook, solution, proof, CTA)              | Product Hunt, landing page  |

### Energy Modifiers

- **Energetic**: fast cuts (2-3s), back.out easing, 0.08s stagger
- **Corporate**: smooth 0.6s transitions, gentle fades, generous holds
- **Cinematic**: slow power4.out reveals, dramatic scale, long holds
- **Playful**: bounce easing, colorful accents, rotation pops

### Format

- **Landscape**: 1920×1080 (default)
- **Portrait**: 1080×1920 (Instagram Stories, TikTok)
- **Square**: 1080×1080 (Instagram feed)

## Reference Files

| File                                                            | When to read                                               |
| --------------------------------------------------------------- | ---------------------------------------------------------- |
| [animation-recreation.md](./references/animation-recreation.md) | Step 5 — converting source animations to GSAP              |
| [video-recipes.md](./references/video-recipes.md)               | Step 5 — scene patterns, mid-scene activity, templates     |
| [tts-integration.md](./references/tts-integration.md)           | Step 5 — voice selection, TTS generation, audition process |
