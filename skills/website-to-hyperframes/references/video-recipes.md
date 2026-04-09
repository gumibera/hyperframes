# Video Recipes

Scene-by-scene composition patterns for each video type.

## Architecture Rules

**Every scene = a separate sub-composition file** in `compositions/`. Root `index.html` loads each scene on the same track with sequential `data-start` values.

```
project/
├── index.html                         ← root: loads scenes + captions + audio
└── compositions/
    ├── scene1-hook.html
    ├── scene2-features.html
    ├── scene3-trust.html
    ├── scene4-cta.html
    └── captions.html                  ← word-level captions overlay
```

## Transition Pattern (Every Scene Must Follow This)

Scenes on the same track hard-cut. To prevent jarring flashes, every scene's GSAP timeline MUST:

1. **Fade in from black** in the first 0.3s (background opacity 0→1, content slides in)
2. **Fade out to black** in the last 0.3s (content fades, background opacity 1→0)
3. Root `body { background: #000 }` ensures the gap between scenes is black, not white

```javascript
// EVERY scene timeline must start and end like this:
var dur = 5; // scene's data-duration
var tl = gsap.timeline({ paused: true });

// === ENTRANCE (first 0.3s) ===
tl.fromTo("#scene-bg", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power2.out" }, 0);
tl.fromTo(
  "#headline",
  { opacity: 0, y: 30 },
  { opacity: 1, y: 0, duration: 0.5, ease: "expo.out" },
  0.15,
);

// === MAIN CONTENT (middle) ===
// ... your animations here ...

// === EXIT (last 0.3s) ===
tl.to("#headline", { opacity: 0, duration: 0.2, ease: "power1.in" }, dur - 0.35);
tl.to("#scene-bg", { opacity: 0, duration: 0.3, ease: "power2.in" }, dur - 0.3);
```

## Caption Safe Zone

**Bottom 120px is reserved for captions.** No scene content below y=960px. The captions sub-composition sits on track 2 as a full-duration overlay occupying this space.

If your scene has a CTA button or logo, place it at y=700-800, not at the bottom.

## Background Variety

When arranging captured sections into a video, ensure visual variety between adjacent scenes. Captured sections already have their real background colors — use these.

**Guidelines:**

- Don't put two dark scenes next to each other
- Don't put two light scenes next to each other
- Alternate light/dark or use gradient scenes as transitions
- If the website has a consistent dark theme (like Linear), the variety comes from content differences, not background changes
- When building custom scenes (not from capture), follow the site's color palette from `DESIGN.md`

## Elements Must DO Something (Not Just Sit There)

**The #1 difference between a video and a slideshow is continuous motion.** Every visible element should have mid-scene activity — not just an entrance and exit.

### Mid-Scene Activity Table

Every CSS-built element MUST have at least one continuous animation during its hold phase:

| Element           | Entrance                           | Mid-scene activity (REQUIRED)                                                                                                                                              | Exit |
| ----------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Payment card      | Slide in from left with 3D rotateY | **Amount counter animates from $0 to $2,499.00** (1.5s, power2.out). Checkmark circle draws in (stroke-dashoffset). Subtle float (y ±4px, sine.inOut, yoyo, finite repeat) | Fade |
| Code terminal     | Slide in from right                | **Lines appear one by one** (stagger: 0.4 per line, opacity 0 to 1, y: 8 to 0). Cursor blinks at end (yoyo, finite repeat).                                                | Fade |
| Dashboard chart   | Scale up                           | **Bars grow to their target heights** (stagger: 0.15, elastic.out). Values tick up as bars grow.                                                                           | Fade |
| Stats counter     | Scale in with back.out             | **Number counts from 0 to target** using gsap.to with onUpdate callback that sets textContent to Math.round(obj.val). Label fades in after count completes.                | Fade |
| Progress bar      | Fade in empty                      | **Fill animates from 0% to target%** (1.2s, power2.out). Percentage text updates live.                                                                                     | Fade |
| Logo grid         | Stagger in                         | **Subtle shimmer sweep** (child div gradient slides across each logo, 2s) or **gentle pulse** (scale 1 to 1.02 to 1, sine.inOut, yoyo, finite repeat)                      | Fade |
| Subscription card | Scale in                           | **Icon rotates or pulses**. Progress indicator fills. Text highlights or underlines animate in.                                                                            | Fade |

### Counter Animation Pattern (For Stats)

```javascript
var obj = { val: 0 };
var statEl = document.querySelector("#stat-num");
tl.to(
  obj,
  {
    val: 135,
    duration: 1.5,
    ease: "power2.out",
    onUpdate: function () {
      statEl.textContent = Math.round(obj.val) + "+";
    },
  },
  0.5,
);
```

### Floating/Breathing Pattern (For Persistent Elements)

```javascript
// Subtle float — makes static elements feel alive
// Never use repeat: -1 — infinite loops break the capture engine.
// Calculate repeats from scene duration:
var sceneDur = 5; // match your data-duration
tl.to(
  "#card",
  { y: "-=6", duration: 2, ease: "sine.inOut", yoyo: true, repeat: Math.ceil(sceneDur / 2) - 1 },
  0,
);
// Pulse glow
tl.to(
  "#glow",
  {
    scale: 1.05,
    opacity: 0.8,
    duration: 1.5,
    ease: "sine.inOut",
    yoyo: true,
    repeat: Math.ceil(sceneDur / 1.5) - 1,
  },
  0,
);
```

### Line-by-Line Reveal Pattern (For Code Terminals)

```javascript
// Each line wrapped in a div with class 'code-line'
tl.fromTo(
  ".code-line",
  { opacity: 0, y: 8 },
  {
    opacity: 1,
    y: 0,
    duration: 0.3,
    stagger: 0.4,
    ease: "power2.out",
  },
  0.5,
);
// Blinking cursor — calculate repeats from remaining scene time
// Never use repeat: -1 — infinite loops break the capture engine.
var cursorStart = 2.5;
var cursorCycle = 1; // 0.5s on + 0.5s off
tl.fromTo(
  "#cursor",
  { opacity: 1 },
  {
    opacity: 0,
    duration: 0.5,
    repeat: Math.ceil((sceneDur - cursorStart) / cursorCycle) - 1,
    yoyo: true,
  },
  cursorStart,
);
```

## Optional Visual Enhancements

These add personality that separates "AI-generated video" from "actually good video." Use 1-2 per composition — don't overload.

### Rough.js — Hand-Drawn Elements

Load rough.js for hand-drawn SVG shapes. Great for trust scenes (circles around logos), stats (underlines), and playful/educational tones.

```html
<script src="https://cdn.jsdelivr.net/npm/roughjs@4.6.6/bundled/rough.min.js"></script>
<svg
  id="rough-canvas"
  width="1920"
  height="1080"
  style="position:absolute;top:0;left:0;pointer-events:none"
></svg>
```

```javascript
var rc = rough.svg(document.getElementById("rough-canvas"));

// Hand-drawn circle around a logo or word
var node = rc.circle(960, 400, 200, {
  stroke: "#635BFF",
  strokeWidth: 3,
  roughness: 1.2,
  bowing: 2,
  fill: "none",
});
document.getElementById("rough-canvas").appendChild(node);

// Rough.js returns a <g> element — find the actual <path> children to animate
var paths = node.querySelectorAll("path");
paths.forEach(function (p) {
  var len = p.getTotalLength();
  p.style.strokeDasharray = len;
  p.style.strokeDashoffset = len;
});

// Animate each path drawing in with GSAP
tl.to(paths, { strokeDashoffset: 0, duration: 0.8, ease: "power2.out", stagger: 0.1 }, 2.0);
```

**Best uses:**
| Effect | When to use |
|--------|------------|
| Circle around a logo/word | Trust scene — circles drawn around each company name as narrator mentions them |
| Underline under a stat | Stats scene — sketchy underline appears after number counts up |
| Arrow pointing at CTA | CTA scene — hand-drawn arrow guides attention to the button |
| Crossed-out text | Before/after comparisons — cross out the "old way" |
| Box around a feature | Feature scene — rough rectangle highlights a key element |

**Roughness guide:** 0.8 = almost clean, 1.2 = noticeably hand-drawn, 2.0 = very sketchy. Match to brand mood — corporate brands get 0.8-1.0, playful brands get 1.5-2.0.

### Marker-Highlight — Hand-Drawn Text Emphasis

For highlighting key words in captions or scene text. See the `/hyperframes` skill's marker-highlight reference for full API details. Quick reference:

```javascript
// After constructing MarkerHighlighter with animate: false
// Trigger at specific timeline points:
tl.call(
  function () {
    highlighter.clearMarks();
    highlighter.reanimateMark("stat-highlight");
  },
  null,
  3.0,
);
```

**Five modes:** `highlight` (marker sweep), `circle` (drawn around word), `burst` (radiating lines), `scribble` (chaotic cross-out), `sketchout` (rough rectangle)

**Energy mapping for captions:**

- Brand names, product names → `highlight` in brand accent color
- Impressive numbers/stats → `circle` or `burst`
- "Not just" / "never" / negation words → `scribble`
- CTA phrases → `highlight` with thicker stroke

### SVG Stroke Animation — Path Drawing

For logos, icons, or decorative elements that "draw themselves in":

```javascript
// Get the SVG path element
var path = document.querySelector("#logo-path");
var length = path.getTotalLength();
path.style.strokeDasharray = length;
path.style.strokeDashoffset = length;

// Animate: path draws in over 1.5 seconds
tl.to(path.style, { strokeDashoffset: 0, duration: 1.5, ease: "power2.out" }, 0.5);
```

Works with any SVG path — logos, icons, borders, decorative swirls. Combine with fill-opacity animation for a "draw then fill" effect.

## Use Captured Sections First

The capture command produces ready-made sub-compositions in `compositions/`. **Use these as your primary scene content** — they already have the real website HTML, correct styling, and proper background colors.

When building a video:

1. Pick the relevant captured sections for your video type
2. Arrange them in the timeline with appropriate durations
3. Add GSAP animations beyond the default entrance/exit (see animation patterns above)
4. Only build CSS elements from scratch for things NOT on the website (custom stats counters, custom CTAs)

**CSS-built elements** are still useful for:

- Stats counters (need counting animation)
- Progress bars (need filling animation)
- Custom CTAs or overlays not from the original page
- Code terminals (need typing effect)

## Using Captured Assets

The capture command downloads SVGs, images, fonts, and canvas screenshots to `assets/`. Use them:

- **SVG logos** → embed inline in scenes, animate with GSAP (fill, stroke, scale)
- **Canvas screenshots** (`assets/canvas-*.png`) → use as `<img>` where the original canvas was (Three.js/WebGL content)
- **Viewport screenshots** (`screenshots/section-*.png`) → faded backgrounds (10-20% opacity) or fallback for broken sections
- **Fonts** (`assets/fonts/`) → already referenced in the captured CSS, load correctly from local files

---

## Product Promo (30-60s, Landscape 16:9)

### Scene Structure

```
Scene 1 — Hook (0-5s)
  Background: WHITE or very light + DECORATIVE ASSET (use captured wave/pattern PNG
    as a background layer at opacity 0.2-0.3, drifting slowly with sine.inOut)
  Content: Brand logo (SVG or text) centered, tagline below
  Mid-scene activity: Wave/pattern drifts slowly. Logo has subtle pulse or glow.
    Tagline letters can have a shimmer sweep.
  Animation: logo scale-in with back.out, tagline slide-up
  Narration: "[Product] — [tagline]."

Scene 2 — Products (5-15s)
  Background: GRADIENT (brand primary to brand dark) + decorative elements if available
    Optional: use a bento grid / product UI screenshot as faded background (10-15% opacity, blur 2-4px) under the gradient
  Content: CSS-built UI mockups (payment card, terminal, dashboard)
    Build 2-3 elements and animate them in from different directions
  Mid-scene activity (CRITICAL): Each element MUST do something after entering:
    - Payment card: amount counter ticks up from $0, checkmark draws in
    - Code terminal: lines type in one by one with blinking cursor
    - Progress bar: fills from 0% to target
    - Chart: bars grow with elastic ease
    All elements should have subtle float (y +/-4px, sine.inOut, yoyo, finite repeat calculated from scene duration)
  Animation: card from left with 3D rotateY, terminal from right, staggered 0.3s
  Narration: "[what the product does in 2-3 sentences]"

Scene 3 — Trust (15-25s)
  Background: LIGHT (#F6F9FC or brand light palette) + accent line or wave decoration
  Content: "Trusted by millions" headline + grid of company logos
    Use inline SVGs or styled text with correct brand colors
    6-8 logos in a 3x2 or 4x2 grid, staggered entries
  Mid-scene activity: Logos have subtle shimmer or gentle scale pulse after entering.
    Headline accent underline draws in after text settles.
    Accent line or decorative element continues slow movement throughout.
  Animation: headline drops in, logos stagger with varied entrances
  Narration: "[social proof — who uses it, stats]"

Scene 4 — CTA (25-30s)
  Background: GRADIENT (brand accent to brand primary, different angle from scene 2)
    Optional: pricing or stats screenshot as faded background (10% opacity)
  Content: Key stats (large numbers in accent colors), CTA button, URL
    Stats in upper half (above y=500)
    CTA in middle (y=600-700)
    Brand logo small at y=800 max (above caption zone)
  Mid-scene activity: Numbers count up from 0 to target (use gsap.to with onUpdate).
    CTA button has a pulse or glow effect after appearing.
    Animated mouse cursor glides in and clicks the CTA button.
    Background glows drift continuously.
  Animation: stats scale-in timed to narration words, CTA slides up
  Narration: "[impressive numbers]. Check it out at [url]."

  Persistent elements across all scenes:
    - Brand favicon/icon badge in bottom-right corner (40x40px, 70% opacity, track 3)
```

### Content Sourcing

| Scene    | Source                                                                                       |
| -------- | -------------------------------------------------------------------------------------------- |
| Hook     | Use the captured hero section composition, or build from logo SVG + tagline from `DESIGN.md` |
| Products | Use captured feature/product section compositions — they already have the real UI            |
| Trust    | Use captured logos/testimonials section composition, or build from SVGs in `assets/`         |
| CTA      | Use captured CTA/footer section composition, or build from CTA text in `DESIGN.md`           |

**Prefer captured sections over building from scratch.** The real website HTML looks better than recreations.

---

## Social Clip (15-30s, Vertical 9:16)

### Scene Structure

```
Scene 1 — Hook (0-3s)
  Background: BRAND ACCENT COLOR (bold, attention-grabbing)
  Content: Bold hook question or statement (40-60px, 800 weight)
  Animation: text scale-pop entrance

Scene 2 — Feature Cards (3-12s)
  Background: GRADIENT
  Content: 2-3 CSS-built feature cards sliding up from bottom
  Animation: cards stagger 0.5s apart, each 2-3s visible

Scene 3 — Key Stat (12-20s)
  Background: LIGHT
  Content: One impressive number (80-120px), testimonial, or key claim
  Animation: number scales in with elastic ease

Scene 4 — CTA (20-25s)
  Background: BRAND PRIMARY
  Content: Brand name + "Try it free" / URL
  Animation: clean fade-in, snap to brand colors
```

Portrait layout: 1080x1920. Text minimum 40px body, 80px headlines. Center everything vertically.

---

## Explainer (30-90s, Landscape, Narrated)

Each scene's duration = duration of its narration segment (from transcript.json word timestamps).

```
Scene 1 — Intro (words 0-N)
  "What is [Product]?" + logo

Scene 2-N — Feature walkthrough
  One scene per feature, each with:
  - CSS-built visual representing the feature
  - Feature headline
  Duration synced to narration segment

Final — CTA
  Logo + URL + tagline
```

---

## Launch Announcement (15-30s)

```
Scene 1 — Build-up (0-10s)
  Animated shapes/gradient in brand colors
  Category text: "Video creation, reimagined"

Scene 2 — Reveal (10-20s)
  Logo scales in dramatically, product name + tagline

Scene 3 — CTA (20-25s)
  "Coming soon" / "Available now" + URL
```

---

## Adapting to Content

- **No testimonials?** Skip trust scene, extend features
- **Only one feature?** Make it the hero, skip carousel
- **No images?** Use bold typography + CSS-built elements
- **E-commerce?** CSS-built product card with price as hero visual
