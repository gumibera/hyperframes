# Research: Aura.build, DESIGN.md Systems, and HyperFrames Integration

> Compiled 2026-04-07. Source: 19 Aura.build pages, web-shader-extractor repo, HyperFrames codebase analysis.

---

## 1. Aura.build — What It Is and How It Works

**Category**: AI website/landing page builder (closed-source SaaS)
**Founder**: Meng To (Design+Code creator)
**Users**: 65,000+ | **Trustpilot**: 4.0/5
**Output**: HTML + Tailwind CSS + vanilla JS, Figma files, React components
**Models**: Gemini 3.1 Pro (best for animations), Claude 4 (precise instructions), GPT-5.1 (structured UI)

### Core Philosophy
"A prompt alone is not enough. You also need examples, templates, and assets." — Meng To

### The Prompt Builder (Flagship Feature)
Visual no-code prompt construction with 6 categories:
1. **Layout Types** — Hero, Features, Onboarding, Docs, Pricing, Dashboard, etc.
2. **Layout Patterns** — Card, List, Bento, Table, Sidebar, Carousel, etc.
3. **Framing** — Full Screen, Card, Browser, Mac App, Clay Web, iPhone, iPad
4. **Visual Styles** — Flat, Outline, Minimalist, Glass, iOS, Material
5. **Typography** — Family (Sans/Serif/Mono/Condensed/Handwritten), heading/body fonts, sizes, weights, spacing
6. **Animation** — Type (Fade/Slide/Scale/Rotate/Blur/3D/Pulse/Bounce/Morph/Skew/Color/Clip), Scene (all at once/sequence/word-by-word/letter-by-letter), Duration, Timing (Linear/Ease/Spring/Bounce), Iterations, Direction

Plus: Theme (Light/Dark), Accent Color (17 options), Background Color (17 options), Border Color, Shadow (None through XXL + Beautiful/Bevel/3D/Inner)

**Generated prompts** include pre-filled suggestions like:
- "Create a landing page for {your-app}, a {app-type} app that {feature} in the style of @hero"
- "Animate fade in, slide in, blur in, element by element"
- "Create 'Masked Staggered Word Reveal' animation on scroll using GSAP ScrollTrigger"
- "Add a subtle flashlight effect on hover/mouse position to background and border of cards"

### @ Context System
The `@` symbol feeds up to 100,000 characters (~2,000 lines of code) as context. Users can reference templates, components, code snippets, and previous iterations. This is what makes AI output consistent — "constrained AI produces more consistent output than unconstrained AI."

### Image-to-HTML
Upload any screenshot/mockup/wireframe → AI analyzes structure → generates responsive HTML + Tailwind → edit and refine → export. Works with Midjourney outputs, Figma mockups, and arbitrary screenshots.

### Key Insight: Screenshot + DESIGN.md = Best Results
When Aura has both a full-page screenshot AND design system data, output quality is dramatically better than either alone. The user demonstrated this with Notion — the version with screenshot was "SO FAST, and so exactly damn right."

### Aura Skills System
Hosts AI Agent Skills directory: Skill Creator, Web Interface Guidelines, GSAP Web Animation Skill, Anime.js v4 Skill. Follows SKILL.md format compatible with Claude Code, Cursor, Gemini CLI.

### Pricing
| Plan | Cost | Prompts/Month |
|------|------|---------------|
| Free | $0 | 10 |
| Pro | $20/mo | 120 |
| Max | $40/mo | 240 |
| Ultra | $100/mo | 560 |

---

## 2. DESIGN.md — The Format

### Origin
Popularized by Google Stitch. VoltAgent/awesome-design-md curates 58+ brand examples (Apple, Stripe, Figma, Linear, Notion, SpaceX).

### Standard Structure (9 sections)
1. **Overview** — Visual identity, tone, design philosophy
2. **Colors** — Semantic roles (surface, text, accent), hex values with usage context
3. **Typography** — Font families, hierarchy tables, weight/size/tracking rules
4. **Elevation & Depth** — Shadow systems, glassmorphism, border patterns
5. **Components** — Buttons, cards, navigation, inputs across states
6. **Layout** — Grid, spacing scale, whitespace philosophy
7. **Do's and Don'ts** — Design guardrails and anti-patterns
8. **Assets** — Images, fonts, icons with URLs and descriptions
9. **Responsive Behavior** — Breakpoints, touch targets, collapse strategies

### Why It Works
"Markdown is the format LLMs read best." The DESIGN.md acts as constraints, not suggestions. AI treats design rules as hard requirements, producing consistent output across multiple generations.

### Examples from User's Session
- **Notion DESIGN.md** (16.4 KB) — "Digital Paper" aesthetic, NotionInter/LyonText/iAWriterMonoS fonts, border-reliance elevation, bento card system, logo marquee, interactive calculator component
- **Soulscape DESIGN.md** (7.7 KB) — "Void" #020204 background, Cormorant Garamond serif + Geist Mono, glassmorphism, cinematic accordion, grain overlays, HUD explorer navigation

---

## 3. Web Shader Extractor (lixiaolin94/skills)

**Repository**: github.com/lixiaolin94/skills (MIT, 161 stars)
**What it does**: 7-phase pipeline that extracts WebGL/Canvas/Shader effects from websites, deobfuscates minified JS, and ports to standalone native JavaScript projects.

### Phases
0. Auto-installs Node.js + Playwright + Chromium
1. Parallel source fetching (rendered DOM, canvas metadata, network requests, screenshots)
2. Tech stack identification (Three.js, Babylon.js, PixiJS, Raw WebGL, 2D Canvas)
3. Configuration extraction (REST APIs, Nuxt payloads, `__NEXT_DATA__`, bundle defaults)
4. Shader code extraction from 1MB+ minified bundles
5. Porting to standalone project (raw WebGL2 or original framework via CDN)
6. Simplification proposal
7. Optional extraction report

### HyperFrames Integration Potential
- **Standalone JS output (zero deps)** embeds directly into HTML compositions
- Could add WebGL detection to `hyperframes capture`
- Extracted shaders become reusable backgrounds/transitions
- Challenge: adapting `requestAnimationFrame` loops to HyperFrames' deterministic frame adapter system

---

## 4. HyperFrames Current State — What We Have

### visual-style.md (minimal, auto-generated during capture)
```yaml
---
name: "Page Title"
source_url: "URL"
colors:
  - hex: "#..."
    role: "color-0"
typography:
  fonts: ["Font1"]
mood:
  keywords: ["extracted", "website-captured"]
---
```

### house-style.md (rich, in skills directory)
- 9 palette categories (Bold/Energetic, Warm/Editorial, Dark/Premium, Clean/Corporate, etc.)
- Easing vocabulary (power1-4, back.out, elastic.out, circ.out, expo.out)
- Timing rules (0.3-0.6s for most moves, exits 2x faster)
- Entrance patterns (position, scale, rotation, clip-path, blur, 3D transforms)
- 11 "anti-defaults" (no Inter/Roboto, no mid-gray, no blue accent, no uniform spacing)
- Typography rules (weight contrast, tracking, case)
- Scene pacing (Build 0-30%, Breathe 30-70%, Resolve 70-100%)

### data-in-motion.md
- Visual continuity rules for sequential stats
- "Numbers need visual weight" (pair every metric with visual element)
- Avoid web patterns (no pie charts, no multi-axis, no 6-panel dashboards)

### patterns.md
- Picture-in-Picture, Title Card, Slide Show templates with code

### Token Extraction (tokenExtractor.ts)
- Colors (12), fonts, headings (h1-h4 with size/weight/color), CTAs, sections (type/heading/bg), CSS variables, logos, images

### Animation Cataloging (animationCataloger.ts)
- Web Animations API keyframes, CSS transition/animation declarations, IntersectionObserver scroll targets, CDP animation events, Canvas elements

### Gap: What's Missing
1. No color role inference (just raw hex values)
2. No typography hierarchy table (just font family names)
3. No component documentation (nav, cards, buttons not described)
4. No motion language (animations cataloged but not summarized in human terms)
5. No do's/don'ts (house-style has them but they're not in capture output)
6. No full-page screenshot (only per-section viewport shots)
7. No prompt templates (brief suggests one generic prompt)
8. No HyperFrames-specific recommendations (transitions, composition templates)
9. No shader/WebGL detection

---

## 5. Mapping Aura Concepts to HyperFrames

| Aura Concept | HyperFrames Equivalent | Status |
|---|---|---|
| DESIGN.md | visual-style.md | Exists but minimal — needs enrichment |
| Prompt Builder UI | CLI + prompt-catalog.md | Doesn't exist — create prompt catalog |
| @ Context (100K chars) | Purged compositions (32-276KB, readable) | Built today! CSS purge + prettify |
| Template library | Captured section compositions | Built today! Website capture pipeline |
| Screenshot input | Full-page screenshot | Missing — add to capture |
| Image-to-HTML | website-to-hyperframes capture | Exists but different goal (video, not web) |
| Animation snippets | house-style.md + GSAP skills | Rich but not in capture output |
| Multi-model support | Claude Code (any model) | Inherited from agent |
| Code Mode editing | Edit purged compositions | Built today! AI-readable files |
| Component remix | Remix demo (scenes 1-4) | Demonstrated today |

---

## 6. Future Directions

### Chrome Extension
Aura has a web app. HyperFrames could have a Chrome extension that:
- One-click captures the current page
- Generates DESIGN.md + full-page screenshot
- Opens HyperFrames Studio with captured components
- Similar to Aura's "Adapt from HTML" but for video

### Visual Prompt Builder (Web UI)
A Prompt Builder for video compositions could live in HyperFrames Studio:
- Pick scene types (Hero, Features, Stats, Testimonial, CTA)
- Select transitions between scenes
- Choose animation style (Energetic, Calm, Corporate, Cinematic)
- Set duration and pacing
- Generate a composition from the selections

### Shader Integration
Combine web-shader-extractor with capture:
- Detect WebGL canvases during capture
- Extract shader code into standalone files
- Embed as animated backgrounds in compositions
- Challenge: deterministic rendering of shader time uniforms

### DESIGN.md Ecosystem Play
"Take your DESIGN.md and now all your videos are on-brand with HyperFrames":
- Accept any DESIGN.md (from Aura, Google Stitch, or hand-written)
- Extend with HyperFrames-specific sections (transitions, GSAP presets, composition templates)
- Use as context for AI-generated compositions
- Portable: same file works in Aura (web), Cursor (code), HyperFrames (video)

---

## 7. Aura Prompt Builder — Complete Category Reference

### Layout Types (Web)
Hero, Features, Onboarding, Docs, Updates, Portfolio, Pricing, Gallery, Dashboard, Login, Email, Testimonials, Payment, Footer, FAQ, Explore, Settings, About, Blog, Video, Landing Page

### Layout Types (Mobile)
Hero, Features, Onboarding, Dashboard, Login, Settings, Profile, Gallery, Explore, FAQ

### Layout Configuration
Card, List, 2-2 Square, Table, Sidebar Left, Sidebar Right, 1-1 Split, 1-1 Vertical, 1/3 2/3 Bento, 2/3 1/3 Bento, 1x4 Bento, Feature Bento, Featured Right, Featured Top, 1/4 2/4 1/4 Bento, 2/4 1/4 1/4 Bento, 2-1 Split, 1-2 Split, 1-1-1 Equal, Header Focus, 3-3 Grid, Carousel, Modal, Alert

### Framing
Full Screen, Card, Browser, Mac App, Clay Web (desktop)
iPhone, Android, iPad, Clay Mobile (mobile)

### Visual Styles
Flat, Outline, Minimalist, Glass, iOS, Material

### Animation Types
Fade, Slide, Scale, Rotate, Blur, 3D, Pulse, Shake, Bounce, Morph, Skew, Color, Hue, Perspective, Clip

### Animation Scene
All at once, Sequence, Word by word, Letter by letter

### Animation Timing
Linear, Ease, Ease In, Ease Out, Ease In Out, Spring, Bounce

### Shadow Options
None, Small, Medium, Large, Extra Large, XXL, Beautiful sm/md/lg, Light Blue sm/md/lg, Bevel, 3D, Inner Shadow

### Typeface Families
Sans, Serif, Monospace, Condensed, Expanded, Rounded, Handwritten

### Ready-Made Prompts (partial list)
- "Create a landing page for {your-app}, a {app-type} app that {feature} in the style of @hero"
- "Hero section @hero. Add sections @feature, @testimonial, @pricing and add @footer"
- "Use @border-gradient for buttons and cards"
- "Add a beam animation to the vertical lines"
- "Add noodles that connect elements and beam animation"
- "Add a subtle flashlight effect on hover/mouse position"
- "Create 'Masked Staggered Word Reveal' animation on scroll using GSAP ScrollTrigger"
- "Add parallax scrolling to the background"
- "Apply alpha masking using mask-image: linear-gradient"
- "Animate fade in, slide in, blur in, element by element"
- "Animate when in view observed, fade in, slide in, blur in, element by element"
