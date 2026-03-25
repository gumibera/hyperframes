---
name: social-media
description: Create engaging TikTok/Instagram/YouTube Shorts vertical videos with hooks, captions, emojis, and effects in HyperFrames. Use when building social media video content or optimizing compositions for short-form vertical platforms.
---

# Social Media Video

Guidelines for creating engaging short-form vertical videos (TikTok, Instagram Reels, YouTube Shorts) in HyperFrames.

## When to Use

- Building a vertical (9:16) video for social platforms
- User asks for "TikTok style", "Reels", "Shorts", or "social media video"
- Adding hooks, emojis, or zoom cuts to a composition

## Viewport

Portrait format: `data-width="1080" data-height="1920"`

Account for platform UI safe areas:

- **Top:** 120px (status bar, platform header)
- **Bottom:** 200px (platform controls, description)
- **Right edge:** 80px (like/comment/share buttons on TikTok)

## Hook Section (First 3 Seconds)

The hook grabs attention immediately. It's a separate composition that plays before captions start.

### Text Strategy

- **3-5 words** — short and punchy
- **Highlight 1-2 key words** with accent color or different size
- Extract the key question or provocative phrase from the opening script

### Layout

- Split text across multiple lines with slight rotation and horizontal offset
- Mix small and large text for size contrast and visual hierarchy
- Center the hook as a unit on screen

### Typography

- Bold, heavy fonts (Inter Bold, Montserrat ExtraBold)
- Lowercase for casual, approachable feel
- High contrast colors (white with heavy black stroke, or black on colored background)
- Bright accent colors for emphasis (lime green, yellow, bright pink)

### Styles

**Bubble style:** Rounded background behind each word/phrase

```css
.hook-word {
  background: #ffffff;
  color: #000000;
  padding: 12px 24px;
  border-radius: 12px;
  font-weight: 800;
}
.hook-word.accent {
  background: #c8ff00; /* lime accent */
}
```

**Outlined style:** Heavy stroke, no background

```css
.hook-word {
  color: #ffffff;
  -webkit-text-stroke: 4px #000000;
  paint-order: stroke fill;
  font-weight: 900;
}
```

### Animation

- **Display:** Static and fully visible during hook period (no entrance animation)
- **Exit:** Quick exit in the last 250-350ms — slide off, zoom + fade, or scale up

```js
// Hook exit at 2.7s (hook lasts 3s)
tl.to(
  ".hook-text",
  {
    x: -1080,
    duration: 0.3,
    ease: "power3.in",
  },
  2.7,
);
```

## Captions

See the `captions` skill for full details. Social media specific additions:

- **Start after hook exits** — don't overlap hook and captions
- **Style consistency** — use the same font family and style (bubble or outlined) as the hook
- **2-4 words per group** for mobile readability (smaller than landscape)
- **Active word highlight** — change the current word's color to the accent color
- **Dynamic sizing** — scale font down if caption group is too wide for 1080px minus padding

## Emojis

Triggered by keywords in the transcript. Appear near (but not overlapping) the subject's face.

### Rules

- **One emoji visible at a time**
- **~1 second gap** between emoji appearances
- **3-4 emojis per video** — moderate use
- **Large enough to notice**, consistent size across all emojis
- **Thematically relevant** to the spoken word that triggers them

### Timing

```js
// Trigger emoji when keyword is spoken
const emojiTriggers = [
  { emoji: "🔥", keyword: "amazing", time: 5.2 },
  { emoji: "💡", keyword: "idea", time: 8.7 },
  { emoji: "🚀", keyword: "launch", time: 12.1 },
];

emojiTriggers.forEach(({ emoji, time }, i) => {
  const el = document.createElement("div");
  el.className = "emoji-overlay";
  el.textContent = emoji;
  el.style.cssText = `position:absolute;font-size:80px;opacity:0;`;
  // Vary positions: upper-right, left-mid, lower-right, upper-left
  const positions = [
    { top: "15%", right: "10%" },
    { top: "40%", left: "8%" },
    { top: "65%", right: "12%" },
    { top: "20%", left: "10%" },
  ];
  const pos = positions[i % positions.length];
  Object.assign(el.style, pos);
  container.appendChild(el);

  // Bounce in
  tl.fromTo(
    el,
    { opacity: 0, scale: 0 },
    { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(1.7)" },
    time,
  );
  // Hold for 2-3s then fade out
  tl.to(el, { opacity: 0, duration: 0.3 }, time + 2.5);
});
```

## Zoom Cuts

Add visual emphasis during key moments by cutting to a zoomed-in framing.

### Pattern

```js
// Zoom in: instant cut (no gradual zoom)
tl.to(
  "#pip-frame",
  {
    scale: 1.5,
    duration: 0.01, // instant
  },
  keyMomentStart,
);

// Hold zoomed for duration of emphasized phrase

// Zoom out: smooth animated return
tl.to(
  "#pip-frame",
  {
    scale: 1,
    duration: 0.5,
    ease: "power2.out",
  },
  keyMomentEnd,
);
```

- **Trigger** at important sentences or phrases
- **Zoom in** is an instant cut, not a gradual zoom
- **Frame** the subject's face with comfortable padding
- **Zoom out** is a smooth animated return

## Z-Index Layering

```
z-index: 1   — base video
z-index: 10  — effects / overlays
z-index: 20  — captions
z-index: 30  — emojis
z-index: 40  — hook text
```

## Workflow

1. Transcribe audio with word-level timestamps
2. Design hook text from opening script (3-5 key words)
3. Group transcript words into caption groups (2-4 words)
4. Choose consistent font family and style (bubble vs outlined)
5. Select background music matching video mood
6. Position captions to avoid covering subject
7. Add zoom cuts at key moments
8. Place emojis triggered by keywords
9. Add transition effects between sections
10. Add sound effects at key transitions
11. Validate all timing syncs with actual audio

## Common Mistakes

- Captions not synced to actual audio
- Multiple caption groups or text elements visible simultaneously
- Text too small to read on mobile
- Insufficient contrast between text and background
- Captions covering subject's face
- Emojis overlapping or too close to face
- No size variation in hook text (all same size lacks impact)
- Background music too loud relative to voice
- Overusing effects and transitions
- Inconsistent styling between hook and captions
