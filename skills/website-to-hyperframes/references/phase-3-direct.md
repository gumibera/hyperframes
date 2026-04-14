# Phase 3: Creative Direction

You are a creative director with 20 years of experience making content for YouTube, Instagram, and TikTok. Your job is to design a video that stops the scroll, holds attention, and drives action.

Look at the screenshot, the text, the brand personality, every available asset. Before writing a single scene, ask yourself:

- What is the ONE thing that makes this product interesting?
- What hook would make someone stop scrolling in the first 2 seconds?
- What visual sequence tells the story without needing explanation?
- What assets — images, SVGs, videos, hosted URLs — do you want to use?
- What ending makes them want to click?

If you cannot answer all five, go back to Phase 2 and look harder. The video is only as good as these answers.

---

## 1. Choose Your Visual Style

Read `visual-styles.md` (from the `/hyperframes-compose` skill) for the 8 named presets. Each one is grounded in a real graphic design tradition. Pick ONE as your style anchor before planning any scene.

| Style | Mood | Best for |
|-------|------|----------|
| Swiss Pulse | Clinical, precise | SaaS, data, dev tools, metrics |
| Velvet Standard | Premium, timeless | Luxury, enterprise, keynotes |
| Deconstructed | Industrial, raw | Tech launches, security, punk |
| Maximalist Type | Loud, kinetic | Big announcements, launches |
| Data Drift | Futuristic, immersive | AI, ML, cutting-edge tech |
| Soft Signal | Intimate, warm | Wellness, personal stories, brand |
| Folk Frequency | Cultural, vivid | Consumer apps, food, communities |
| Shadow Cut | Dark, cinematic | Dramatic reveals, security, exposé |

State your choice explicitly: "I will use **[style name]** because [reason]."

The choice locks your palette, typeface, motion energy, and transition type. Everything downstream follows from it.

---

## 2. Choose Your Shader Transition

Shaders are the emotional punctuation between scenes. The wrong shader undermines the tone even if everything else is right.

| Energy | Primary shader | Why it works |
|--------|---------------|-------------|
| Calm / luxury / wellness | Cross-Warp Morph | Organic, flowing — scenes melt into each other |
| Corporate / SaaS / explainer | Cinematic Zoom or SDF Iris | Professional momentum |
| High energy / launch / promo | Ridged Burn or Glitch | Dramatic — stops the scroll |
| Cinematic / dramatic / story | Gravitational Lens or Domain Warp | Otherworldly |
| Playful / fun / social | Swirl Vortex or Ripple Waves | Hypnotic and delightful |

State your choice: "I will use **[shader name]** as the primary transition because [reason]."

The scaffold already has Cross-Warp Morph wired — if you choose a different shader, you will swap it in Phase 4.

---

## 3. Motion Vocabulary

Every element that appears on screen must DO something. Static entries are forgettable.

| Energy | Verbs | Example |
|--------|-------|---------|
| High impact | SLAMS, CRASHES, PUNCHES, STAMPS, SHATTERS | "$1.9T" SLAMS in from left at -5deg |
| Medium energy | CASCADE, SLIDES, DROPS, FILLS, DRAWS | Three cards CASCADE in staggered 0.3s |
| Low energy | types on, FLOATS, morphs, COUNTS UP, fades in | Counter COUNTS UP from 0 to 135K |

Every element must have at least one of these verbs assigned during its hold phase. If you can't name the verb, the element is not yet designed — it is just content sitting on a slide.

---

## 4. Write the Narration Script FIRST

The script is the backbone. Scene durations come from the narration, not from guessing. Write it before you plan a single frame.

**Pacing rules:**
- 2.5 words per second is natural speaking pace. 15s = ~37 words, 30s = ~75 words, 60s = ~150 words
- Write like a real human — use contractions: "it's", "you'll", "that's"
- Use filler words intentionally: "basically", "honestly", "pretty much"
- Vary sentence length — mix short punchy phrases with longer flowing ones
- Add pauses with punctuation — "And the uptime? Ninety nine point nine percent." The question mark creates a natural beat

**Number pronunciation — write what you want the voice to say:**

| On the website | Write in script as |
|---|---|
| 135+ | more than one hundred thirty five |
| $1.9T | nearly two trillion dollars |
| 99.999% | ninety nine point nine percent |
| 200M+ | over two hundred million |
| 10x | ten times |
| API | A P I |
| stripe.com | stripe dot com |

The TTS engine reads literally. "99.999%" becomes "ninety nine point nine nine nine percent." Simplify numbers — the visual can show the exact figure while the voice rounds it.

**The opening line is the most important sentence in the video.** It must create tension, curiosity, or surprise. See Section 7 for opening patterns.

Save as `narration-script.txt` in the project directory.

---

## 5. Generate TTS Audio

Audition 2-3 voices with the first sentence before committing to the full narration. Never use the first voice you find.

- **HeyGen TTS** (preferred) — use `mcp__claude_ai_HeyGen__text_to_speech`, returns audio + word timestamps automatically. Use `mcp__claude_ai_HeyGen__list_audio_voices` to browse. Look for "Chill", "Smooth", "Relaxed", "Charming" — avoid "Professional", "Dominant", "Firm".
- **ElevenLabs** (if available) — use `mcp__elevenlabs__search_voices` then `mcp__elevenlabs__text_to_speech`. Wider voice selection, more natural output. Does not return timestamps — transcribe separately.
- **Kokoro** (offline fallback) — `npx hyperframes tts narration-script.txt --voice af_nova --output narration.wav`

Read [tts-integration.md](tts-integration.md) for voice selection details, audition process, and what to listen for.

---

## 6. Transcribe for Word-Level Timestamps

```bash
npx hyperframes transcribe narration.wav
```

Produces `transcript.json` with `[{ text, start, end }]` for every word. These timestamps become the source of truth for scene durations — do not set `data-duration` to arbitrary numbers when you have real timestamps.

---

## 7. Plan Scenes Around the Narration

Map each sentence or phrase to a scene. The narration IS the timeline.

Print your scene plan in this format before writing any HTML:

| Scene | Duration | What viewer sees | What viewer feels | Assets to use | Transition OUT | Narration |
|-------|----------|-----------------|-------------------|---------------|---------------|-----------|

Each scene duration comes from the word timestamps: `scene_end = word[last].end`, `scene_start = word[first].start`. Leave 0.5s–1s overlap at boundaries for entrance animations to breathe.

---

## 8. The Opening 2 Seconds

The opening defines everything. The first frame must earn the next five seconds.

Start with one of these proven patterns:

- **A number that shocks** — "$1.9 TRILLION in transactions" — number SLAMS in at 120px, camera punches forward
- **A visual that moves immediately** — hero image already zooming at 1.05× scale when frame 1 renders, no wait
- **A question that provokes** — "What if your database could think?" — text types on word by word, cursor blinks
- **An asset doing something unexpected** — logo explodes into particles, hero image warps under gravitational lens, brand color fills the screen like liquid

Commit to your opening before writing Scene 1. Write it down: "Scene 1 opens with [specific action] at [specific energy level] using [specific asset]."

If the opening is generic — a logo fading in, a tagline appearing — start over. Generic openings lose the viewer before the product is even introduced.

---

## Checklist Before Phase 4

- [ ] Visual style chosen and stated explicitly
- [ ] Shader transition chosen and stated explicitly
- [ ] Every planned element has a motion verb
- [ ] Narration script written, saved as `narration-script.txt`
- [ ] TTS generated, at least 2 voices auditioned
- [ ] `transcript.json` produced from `npx hyperframes transcribe`
- [ ] Scene plan table filled out with real durations from timestamps
- [ ] Opening 2 seconds committed in writing
