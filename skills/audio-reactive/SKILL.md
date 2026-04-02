---
name: audio-reactive
description: Audio-reactive animation — drive visuals from music, voice, or sound in HyperFrames. Maps frequency bands and amplitude to any GSAP-animatable property.
trigger: Use when a composition involves music, beat-synced animation, audio visualization, or any visual reacting to sound.
---

# Audio-Reactive Animation

When audio data is available (extracted via `extract-audio-data.py` or loaded from `audio-data.json`), any visual element in the composition can be driven by the music — captions, backgrounds, shapes, overlays, anything GSAP can animate.

## Audio Data Format

```js
var AUDIO_DATA = {
  fps: 30,           // frame rate of the analysis
  totalFrames: 900,  // total analyzed frames
  frames: [
    { bands: [0.82, 0.45, 0.31, ...] },  // per-frame frequency band amplitudes
    // ...
  ]
};
```

- `frames[i].bands[]` — frequency band amplitudes, normalized 0–1. Index 0 = bass, higher indices = mids and treble.
- `fps` — frame rate of the analysis (matches composition frame rate)
- `totalFrames` — total number of analyzed frames

## Mapping Audio to Visuals

Map frequency bands and amplitude to any GSAP-animatable property. The creative choice is yours — these are common mappings:

| Audio signal           | Visual property                   | Effect                     |
| ---------------------- | --------------------------------- | -------------------------- |
| Bass (bands[0])        | `scale`                           | Pulse on beat              |
| Treble (bands[12–14])  | `textShadow`, `boxShadow`         | Glow intensity             |
| Overall amplitude      | `opacity`, `y`, `backgroundColor` | Breathe, lift, color shift |
| Beat onset             | `scale`, `color`, `rotation`      | Flash or pop on hits       |
| Mid-range (bands[4–8]) | `borderRadius`, `width`, `height` | Shape morphing             |

These are starting points. Any property GSAP can tween is fair game — `clipPath`, `filter`, `backgroundPosition`, SVG attributes, custom CSS properties.

## Content, Not Medium

Audio data provides **timing and intensity** for visuals grounded in the content. It tells the animation _when_ and _how much_ — not _what to show_. The visual vocabulary comes from the narrative, theme, and emotion of the piece. A funeral dirge and a party anthem should produce completely different visuals even though their audio data has the same shape.

**Never add these — they represent the medium, not the content:**

- Frequency equalizer bars, spectrum analyzers, radial spectrum rings — technical readouts that just say "audio exists"
- Waveform displays, oscilloscope lines, VU meters — diagnostic tools, not creative choices
- Musical notes, vinyl records, turntable imagery — clip art signaling "music is playing"
- Generic particle systems driven by amplitude — interchangeable across any song or mood
- Background color cycling through rainbow hues on frequency — rave aesthetic regardless of content
- Strobing/flashing white on beat hits — lazy beat sync (also an accessibility problem)
- Abstract pulsing orbs, breathing geometric wireframes, concentric rings — would look identical on a lullaby or a metal track

**Instead, let the content guide the visual and the audio drive its behavior:**

- If the scene is warm, bass makes the warmth _swell_ (slight scale, deeper color saturation)
- If the mood is tense, treble sharpens _contrast_ or tightens _letterSpacing_
- If text is the focus, bass gives it subtle _weight_ (shadow depth, y offset) while treble adds _shimmer_ (glow, lightness)
- The visual choice comes from asking "what does this piece feel like?" — audio data just animates the answer

## Guidelines

- **Subtlety for text.** Captions and readable text should stay in the 3–6% scale variation range with soft glow. Heavy pulsing makes text unreadable.
- **Go bigger on non-text elements.** Backgrounds, shapes, and decorative elements can handle 10–30% scale swings, full color shifts, and dramatic transforms.
- **Match the energy.** A corporate explainer needs subtle reactivity. A music video can go hard.
- **Deterministic.** Audio data is pre-extracted — no Web Audio API, no `AnalyserNode`, no runtime mic input. The data is static JSON, the animation is repeatable.

## Constraints

- All audio data must be pre-extracted — no runtime audio analysis
- No `Math.random()` or `Date.now()` — deterministic rendering applies
- Audio reactivity runs on the same GSAP timeline as everything else
