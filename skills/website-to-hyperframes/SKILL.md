---
name: website-to-hyperframes
description: |
  Capture a website and create a HyperFrames video from it. Use when: (1) a user provides a URL and wants a video, (2) someone says "capture this site", "turn this into a video", "make a promo from my site", (3) the user wants a social ad, product tour, or any video based on an existing website, (4) the user shares a link and asks for any kind of video content. Even if the user just pastes a URL — this is the skill to use.
---

# Website to HyperFrames

Capture a website's identity, then create an on-brand video from it.

Users say things like:
- "Capture stripe.com and make me a 20-second product demo video"
- "Turn this website into a 15-second social ad for Instagram"
- "Create a 30-second product tour from linear.app"

The workflow has 4 phases. Each phase produces an artifact that gates the next.

---

## Phase 1: Capture & Understand

**Read:** [references/phase-1-understand.md](references/phase-1-understand.md)

Run the capture, then read and summarize the extracted data using the write-down-and-forget method described in the reference.

**Gate:** Print your site summary before proceeding:
- Site name, top 3-5 colors (HEX), primary font family
- Number of assets, sections, and animations available
- One sentence: what is this site's visual vibe?

---

## Phase 2: Write DESIGN.md

**Read:** [references/phase-2-design.md](references/phase-2-design.md)

Write a complete DESIGN.md with all 10 sections. The Style Prompt section is the most important — an AI should be able to read only that paragraph and generate consistent on-brand visuals.

**Gate:** `DESIGN.md` exists in the project directory with all 10 sections populated.

---

## Phase 3: Creative Direction

**Read:** [references/phase-3-direct.md](references/phase-3-direct.md)

Think like a creative director. Choose a visual style, write the narration script, generate TTS audio, and plan every scene around the narration timestamps.

**Gate:** All three artifacts exist:
1. `narration-script.txt` — the voiceover script
2. `narration.wav` (or .mp3) — generated TTS audio
3. Scene plan printed (Scene | Duration | Visual | Emotion | Assets | Transition | Narration)

If the user explicitly says "no narration" or "no voiceover": skip script/TTS, plan scenes with visual-only timing.

---

## Phase 4: Build & Deliver

**Read:** The `/hyperframes-compose` skill (invoke it — every rule matters)
**Read:** [references/phase-4-build.md](references/phase-4-build.md)

Build the compositions. The `index.html` scaffold already has shader transitions pre-wired (Cross-Warp Morph by default). Modify the shader choice and wire the transition timeline to your scene plan.

**Gate:** Both commands pass with zero errors:
```bash
npx hyperframes lint
npx hyperframes validate
```

Then preview: `npx hyperframes preview`

---

## Quick Reference

### Video Types

| Type | Duration | Scenes | Narration |
|------|----------|--------|-----------|
| Social ad (IG/TikTok) | 10-15s | 3-4 | Optional hook sentence |
| Product demo | 30-60s | 5-8 | Full narration |
| Feature announcement | 15-30s | 3-5 | Full narration |
| Brand reel | 20-45s | 4-6 | Optional, music focus |
| Launch teaser | 10-20s | 2-4 | Minimal, high energy |

### Format

- **Landscape**: 1920x1080 (default)
- **Portrait**: 1080x1920 (Instagram Stories, TikTok)
- **Square**: 1080x1080 (Instagram feed)

### Reference Files

| File | When to read |
|------|-------------|
| [phase-1-understand.md](references/phase-1-understand.md) | Phase 1 — reading captured data |
| [phase-2-design.md](references/phase-2-design.md) | Phase 2 — writing DESIGN.md |
| [phase-3-direct.md](references/phase-3-direct.md) | Phase 3 — creative direction and narration |
| [phase-4-build.md](references/phase-4-build.md) | Phase 4 — building compositions |
| [asset-sourcing.md](references/asset-sourcing.md) | When you need logos, icons, or photos not in the capture |
| [video-recipes.md](references/video-recipes.md) | Scene patterns, 5-layer system, mid-scene activity |
| [tts-integration.md](references/tts-integration.md) | Voice selection, TTS generation options |
| [animation-recreation.md](references/animation-recreation.md) | Converting source animations to GSAP |
