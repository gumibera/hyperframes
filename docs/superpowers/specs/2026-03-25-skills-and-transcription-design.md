# Skills & Transcription Design

## Overview

Three new HyperFrames skills (captions, transitions, media) and a CLI enhancement to add local transcription to `hyperframes init`.

---

## Part 1: CLI — Transcription in `hyperframes init`

### User Flow

```
npx hyperframes init
  → "Project name" → my-video
  → "Got a video?" → Yes → /path/to/video.mp4
  → (probe video: 1920x1080, 45.2s, has audio)
  → "Generate captions from audio?" → Yes
  → (extract audio → run whisper → save transcript)
  → "Pick a template" → warm-grain
  → (scaffold project with transcript.json + captions composition)
  → "Open in studio" / "Render" / "Done"
```

### Whisper Binary Management

Follow the same pattern as the Chrome browser manager (`packages/cli/src/browser/manager.ts`):

- **Cache location:** `~/.cache/hyperframes/whisper/`
- **Binary:** whisper.cpp pre-built binary (download from GitHub releases)
- **Model:** `ggml-base.en.bin` by default (~148MB), downloaded from Hugging Face on first use
- **Resolution priority:** `--whisper-path` flag → `HYPERFRAMES_WHISPER_PATH` env var → cached binary → download

Structure:
```
~/.cache/hyperframes/whisper/
├── bin/
│   └── whisper           # whisper.cpp binary
└── models/
    └── ggml-base.en.bin  # default model
```

### Transcription Pipeline

1. **Extract audio:** `ffmpeg -i video.mp4 -vn -ar 16000 -ac 1 -f wav /tmp/audio.wav`
2. **Run whisper:** `whisper --model ~/.cache/hyperframes/whisper/models/ggml-base.en.bin --output-json --dtw base.en /tmp/audio.wav`
3. **Parse output:** whisper.cpp JSON output → normalize to `transcript.json`
4. **Save:** `transcript.json` in project root

### transcript.json Format

Use whisper.cpp's native JSON output format directly. The captions skill documents whatever format whisper.cpp outputs — no normalization layer.

### Files to Change

- `packages/cli/src/whisper/manager.ts` — new module: download, cache, resolve whisper binary + model (mirrors browser/manager.ts)
- `packages/cli/src/whisper/transcribe.ts` — new module: extract audio, run whisper, return parsed result
- `packages/cli/src/commands/init.ts` — add "Generate captions?" prompt after video probe, call transcribe, save transcript.json, pass to scaffolding
- `packages/cli/src/commands/doctor.ts` — add whisper check

---

## Part 2: Skills

### Skill: `captions`

**File:** `.claude/skills/captions/SKILL.md`

**Purpose:** Given a whisper transcript file in the project, build or modify HyperFrames caption compositions.

**Assumes:** `transcript.json` exists (output from `hyperframes init` or whisper.cpp directly).

**Content covers:**
- Whisper.cpp JSON structure reference (segments, tokens, timestamps)
- Word grouping strategies: by sentence breaks, pause gaps (>150ms), max word count (3-5)
- Composition structure: `<template>` wrapper, `data-composition-id="captions"`, scoped CSS
- GSAP patterns for caption entrance/exit (opacity, y offset, scale)
- Positioning: bottom third centered, safe margins
- Constraints: deterministic, no `Math.random()`, register in `window.__timelines`
- Anti-patterns: don't animate `display`, don't overlap caption groups on same track

### Skill: `transitions`

**File:** `.claude/skills/transitions/SKILL.md`

**Purpose:** Constraints and patterns for scene-to-scene transitions in HyperFrames.

**Content covers:**
- Track overlap rules: same track clips cannot overlap, use different tracks for crossfades
- Crossfade pattern: two clips on separate tracks, opacity tween on outgoing clip
- Wipe/reveal patterns: overlay div with GSAP-animated position
- Timing: transition composition overlaps scene boundaries via `data-start` offset
- Constraints: transitions are compositions (need `data-composition-id`), not bare divs
- Anti-patterns: don't animate video element dimensions, don't use CSS transitions (use GSAP)

### Skill: `media`

**File:** `.claude/skills/media/SKILL.md`

**Purpose:** Constraints for working with video, audio, and images in HyperFrames.

**Content covers:**
- Video: must be `muted` + `playsinline`, audio separate, `crossorigin="anonymous"` for CORS
- Audio: separate `<audio>` element, `data-volume` for level control
- Trimming: `data-media-start` for in-point offset
- Codec requirements: H.264/VP8/VP9/AV1 for video, AAC/MP3/Opus for audio
- Transparent video: WebM VP9 with alpha channel
- Image: `<img>` with `data-start`/`data-duration`/`data-track-index`
- Framework owns playback: never call `play()`, `pause()`, set `currentTime`
- PiP pattern: animate wrapper div, not the video element
- Anti-patterns: don't nest video in timed div, don't animate video dimensions

---

## Prioritization

1. **Skills first** — captions, transitions, media (can ship immediately, no code changes)
2. **CLI transcription** — whisper binary manager + init flow (requires engineering)
