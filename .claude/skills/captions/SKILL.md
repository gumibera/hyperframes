---
name: captions
description: Build timed caption compositions from whisper.cpp transcripts in HyperFrames. Use when adding captions, subtitles, or timed text to a composition that has a transcript.json file.
---

# Captions

Build HyperFrames caption compositions from whisper.cpp transcript data.

## When to Use

- Project has a `transcript.json` (output from whisper.cpp `--output-json`)
- User asks to "add captions", "add subtitles", or "show the words"
- Editing an existing captions composition

## Whisper.cpp Transcript Format

The transcript file is whisper.cpp's native JSON output. Word-level timestamps are in the `tokens` array within each segment:

```json
{
  "transcription": [
    {
      "timestamps": { "from": "00:00:00,000", "to": "00:00:05,000" },
      "offsets": { "from": 0, "to": 5000 },
      "text": " Hello world.",
      "tokens": [
        {
          "text": " Hello",
          "offsets": { "from": 0, "to": 1000 },
          "p": 0.98
        },
        {
          "text": " world",
          "offsets": { "from": 1000, "to": 2000 },
          "p": 0.95
        }
      ]
    }
  ]
}
```

Key fields per token:

- `text` — word text (often has leading space for word-initial tokens)
- `offsets.from` / `offsets.to` — milliseconds
- `p` — confidence (0-1)

### Normalizing to a Word Array

Flatten the transcript into a simple word array for grouping:

```js
const words = [];
for (const segment of transcript.transcription) {
  for (const token of segment.tokens || []) {
    const text = token.text.trim();
    if (!text) continue;
    words.push({
      text: text,
      start: token.offsets.from / 1000,
      end: token.offsets.to / 1000,
    });
  }
}
```

## Word Grouping

Group words into caption lines. Never show more than 5 words at once. Break on:

1. **Sentence boundaries** — `.` `?` `!`
2. **Pauses** — gap > 150ms between consecutive words
3. **Max word count** — 3-5 words per group (3 for portrait, 5 for landscape)

```js
function groupTranscript(words, maxWords) {
  const groups = [];
  let current = [];

  words.forEach((word, i) => {
    current.push(word);

    const next = words[i + 1];
    const isPause = next && next.start - word.end > 0.15;
    const isSentenceEnd = /[.?!]/.test(word.text);

    if (current.length >= maxWords || isPause || isSentenceEnd || !next) {
      groups.push({
        text: current.map((w) => w.text).join(" "),
        start: current[0].start,
        end: current[current.length - 1].end,
      });
      current = [];
    }
  });
  return groups;
}
```

## Composition Structure

Caption compositions follow the standard HyperFrames composition format:

```html
<template id="captions-template">
  <div data-composition-id="captions" data-width="1920" data-height="1080" data-duration="30">
    <div id="captions-container"></div>

    <style>
      [data-composition-id="captions"] {
        width: 1920px;
        height: 1080px;
        pointer-events: none;
      }
      [data-composition-id="captions"] #captions-container {
        position: absolute;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        justify-content: center;
        align-items: center;
        width: 100%;
        height: 150px;
      }
      .caption-group {
        position: absolute;
        opacity: 0;
      }
    </style>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      (function () {
        // Word array from transcript — replace with actual data
        const WORDS = [
          /* ... */
        ];

        const container = document.getElementById("captions-container");
        const tl = gsap.timeline({ paused: true });
        const groups = groupTranscript(WORDS, 5);

        groups.forEach((group, i) => {
          const el = document.createElement("div");
          el.className = "caption-group";
          el.textContent = group.text;
          container.appendChild(el);

          // Entrance
          tl.fromTo(
            el,
            { opacity: 0, y: 20 },
            { opacity: 1, y: 0, duration: 0.3, ease: "expo.out" },
            group.start,
          );

          // Exit
          tl.to(el, { opacity: 0, y: -10, duration: 0.25, ease: "expo.out" }, group.end - 0.25);
        });

        window.__timelines["captions"] = tl;
      })();
    </script>
  </div>
</template>
```

## Positioning

- **Landscape (1920x1080):** Bottom third — `bottom: 80-120px`, centered horizontally
- **Portrait (1080x1920):** Lower middle — `bottom: 600-700px`, centered horizontally
- Use `position: absolute` on caption groups, stacked in the same container
- Set `pointer-events: none` on the composition so captions don't block clicks

## Animation Patterns

### Fade + slide (clean, modern)

```js
tl.fromTo(el, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4, ease: "expo.out" }, start);
tl.to(el, { opacity: 0, y: -10, duration: 0.3, ease: "expo.out" }, end - 0.3);
```

### Pop-in bounce (playful)

```js
tl.to(el, { autoAlpha: 1, scale: 1.1, duration: 0.2, ease: "power2.out" }, start);
tl.to(el, { scale: 1, duration: 0.1, ease: "power2.inOut" }, start + 0.2);
tl.to(el, { autoAlpha: 0, scale: 0, duration: 0.15, ease: "power2.in" }, end);
```

### Hard cut (no animation)

```js
tl.set(el, { display: "flex" }, start);
tl.set(el, { display: "none" }, end);
```

## Timing Rules

- **Entrance animation must complete before exit starts.** If a group is shorter than entrance + exit duration, reduce animation durations.
- **Exit before next group enters.** Use `Math.min(group.end, nextGroup.start)` as the hide time.
- **Minimum display time:** 0.3s — skip groups shorter than this.
- **No overlapping caption groups.** Only one group visible at a time.

## Constraints

- **Deterministic.** No `Math.random()`, no `Date.now()`.
- **Register timeline.** `window.__timelines["captions"] = tl;`
- **IIFE scope.** Wrap script in `(function() { ... })()` to avoid globals.
- **Scoped CSS.** Prefix all selectors with `[data-composition-id="captions"]`.
- **Set `data-duration`.** Must match or exceed the last caption's end time.
- **Do not animate `visibility` or `display` on timed clips.** Use `opacity` or `autoAlpha`.
- **Do not use `tl.set()` for property changes that need to survive timeline seeking.** Use `tl.to()` with a short duration instead.

## Loading in the Root Composition

```html
<div
  id="el-captions"
  data-composition-id="captions"
  data-composition-src="compositions/captions.html"
  data-start="0"
  data-duration="30"
  data-track-index="5"
  data-width="1920"
  data-height="1080"
></div>
```
