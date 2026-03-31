# Audio Visualizer

Reactive audio visualizations for HyperFrames compositions. Pre-extracts amplitude and frequency data from an audio file, then drives Canvas 2D rendering from the GSAP timeline.

## Why Pre-Extraction

HyperFrames renders frame-by-frame in headless Chrome — there's no audio playing during rendering, so the Web Audio API's real-time `AnalyserNode` won't work. Instead, extract all audio data before the composition runs and bake it as a static JSON array. The composition reads the array by frame index. This is fully deterministic and seekable.

## Step 1: Extract Audio Data

```bash
python skills/gsap-effects/scripts/extract-audio-data.py audio.mp3 -o audio-data.json
python skills/gsap-effects/scripts/extract-audio-data.py video.mp4 --fps 30 --bands 16 -o audio-data.json
```

Requires ffmpeg. Optional: numpy (faster FFT, falls back to pure Python).

| Flag      | Default         | Description                                              |
| --------- | --------------- | -------------------------------------------------------- |
| `--fps`   | 30              | Must match the composition/render FPS                    |
| `--bands` | 16              | Number of frequency bands (more = finer spectrum detail) |
| `-o`      | audio-data.json | Output path                                              |

The script uses a 4096-sample FFT window (not the per-frame sample count) to ensure each frequency band maps to distinct FFT bins. Bands are logarithmically spaced from 30Hz to 16kHz — the useful range for music. Each band is normalized independently across the full track so treble activity is visible even when bass is louder in absolute terms.

Output structure:

```json
{
  "duration": 180.5,
  "fps": 30,
  "bands": 16,
  "totalFrames": 5415,
  "frames": [
    { "time": 0.0, "rms": 0.0, "bands": [0.0, 0.0, 0.0, ...] },
    { "time": 0.0333, "rms": 0.42, "bands": [0.8, 0.6, 0.3, ...] }
  ]
}
```

- `rms` — overall amplitude, normalized 0-1 across the track. Drives pulsing, bouncing, glow.
- `bands` — frequency magnitudes per band, each normalized 0-1 independently across the track. Index 0 = lowest bass (30Hz), last index = highest treble (16kHz). Drives spectrum bars, EQ displays.

## Band Ordering

Bands are always ordered low-to-high frequency: index 0 is bass, last index is treble. When drawing visualizations:

- **Horizontal layouts** (spectrum bars, EQ): low frequencies on the left, high frequencies on the right. Iterate bands left-to-right as index 0, 1, 2, ...
- **Vertical layouts**: low frequencies at the bottom, high frequencies at the top. Iterate bands bottom-to-top.
- **Circular layouts**: bass starts at the top (12 o'clock) and wraps clockwise.

## Step 2: Embed Data in the Composition

Inline the JSON as a script variable. For large files, load via fetch from the project root.

```html
<script>
  const AUDIO_DATA = /* paste audio-data.json contents here */;
</script>
```

Or load at runtime (works in both studio and renderer):

```html
<script>
  let AUDIO_DATA = null;
  fetch("audio-data.json")
    .then((r) => r.json())
    .then((d) => {
      AUDIO_DATA = d;
    });
</script>
```

## Step 3: Drive Canvas from the Timeline

The core pattern: register a `tl.call()` at every frame interval. Each call reads the pre-computed data for that frame and draws to Canvas.

```js
const canvas = document.querySelector("#viz-canvas");
const ctx = canvas.getContext("2d");
const fps = AUDIO_DATA.fps;
const totalFrames = AUDIO_DATA.totalFrames;

for (let f = 0; f < totalFrames; f++) {
  tl.call(
    () => {
      const frame = AUDIO_DATA.frames[f];
      if (!frame) return;
      drawVisualization(ctx, canvas.width, canvas.height, frame);
    },
    [],
    f / fps,
  );
}
```

This is deterministic — same input produces identical output on every render. The timeline is seekable so scrubbing in the studio works.

## Visualization Patterns

### Spectrum Bars

Vertical bars where each bar represents a frequency band. Bass on the left, treble on the right.

```js
function drawSpectrumBars(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h);
  const bands = frame.bands;
  const n = bands.length;
  const barWidth = (w * 0.8) / n;
  const gap = (w * 0.2) / (n + 1);
  const maxHeight = h * 0.85;

  for (let i = 0; i < n; i++) {
    const barHeight = bands[i] * maxHeight;
    const x = gap + i * (barWidth + gap);
    const y = h - barHeight;

    // Gradient from bass color to treble color
    const t = i / (n - 1);
    const r = Math.round(106 + t * 150);
    const g = Math.round(220 - t * 100);
    const b = Math.round(255 - t * 80);
    ctx.fillStyle = `rgb(${r},${g},${b})`;

    // Rounded top
    const radius = Math.min(barWidth / 2, 6);
    ctx.beginPath();
    ctx.moveTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.lineTo(x + barWidth - radius, y);
    ctx.quadraticCurveTo(x + barWidth, y, x + barWidth, y + radius);
    ctx.lineTo(x + barWidth, h);
    ctx.lineTo(x, h);
    ctx.closePath();
    ctx.fill();
  }
}
```

### Mirrored Waveform Bars

Bars extend both up and down from a center line, creating a symmetric waveform.

```js
function drawMirroredBars(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h);
  const bands = frame.bands;
  const n = bands.length;
  const barWidth = (w * 0.8) / n;
  const gap = (w * 0.2) / (n + 1);
  const centerY = h / 2;
  const maxHeight = h * 0.4;

  for (let i = 0; i < n; i++) {
    const barHeight = bands[i] * maxHeight;
    const x = gap + i * (barWidth + gap);

    const t = i / (n - 1);
    ctx.fillStyle = `rgba(116, 225, 185, ${0.6 + bands[i] * 0.4})`;

    // Top half
    ctx.fillRect(x, centerY - barHeight, barWidth, barHeight);
    // Bottom half (mirrored)
    ctx.fillRect(x, centerY, barWidth, barHeight);
  }
}
```

### Pulsing Circle

A circle that scales with overall amplitude. Works well as a background element behind other content.

```js
function drawPulsingCircle(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h);
  const baseRadius = Math.min(w, h) * 0.15;
  const radius = baseRadius + frame.rms * baseRadius * 0.8;

  const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, radius);
  gradient.addColorStop(0, `rgba(106, 220, 255, ${0.3 + frame.rms * 0.5})`);
  gradient.addColorStop(0.6, `rgba(116, 225, 185, ${0.1 + frame.rms * 0.2})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, radius, 0, Math.PI * 2);
  ctx.fill();
}
```

### Circular Visualizer

Bars arranged in a ring. Each bar points outward from the center. Frequency bands map around the circle.

```js
function drawCircularVisualizer(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const innerRadius = Math.min(w, h) * 0.15;
  const maxBarLength = Math.min(w, h) * 0.25;
  const bands = frame.bands;
  const n = bands.length;
  // Mirror bands for full circle
  const allBands = [...bands, ...bands.slice().reverse()];
  const total = allBands.length;

  ctx.lineCap = "round";

  for (let i = 0; i < total; i++) {
    const angle = (i / total) * Math.PI * 2 - Math.PI / 2;
    const barLength = allBands[i] * maxBarLength;
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * (innerRadius + barLength);
    const y2 = cy + Math.sin(angle) * (innerRadius + barLength);

    const t = i / total;
    ctx.strokeStyle = `rgba(106, 220, 255, ${0.5 + allBands[i] * 0.5})`;
    ctx.lineWidth = Math.max(2, ((w * 0.8) / total) * 0.6);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
}
```

### Background Glow

Subtle color/opacity shift tied to amplitude. Layer behind other composition content.

```js
function drawBackgroundGlow(ctx, w, h, frame) {
  ctx.clearRect(0, 0, w, h);
  const bass = frame.bands[0] || 0;
  const mid = frame.bands[Math.floor(frame.bands.length / 2)] || 0;

  const gradient = ctx.createRadialGradient(w * 0.3, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.7);
  gradient.addColorStop(0, `rgba(116, 225, 185, ${bass * 0.15})`);
  gradient.addColorStop(0.5, `rgba(106, 220, 255, ${mid * 0.08})`);
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}
```

## Smoothing

Raw per-frame data can look jittery. Smooth by blending with the previous frame:

```js
let prevFrame = null;
const smoothing = 0.3; // 0 = no smoothing, 0.5 = heavy

function getSmoothedFrame(f) {
  const raw = AUDIO_DATA.frames[f];
  if (!raw) return prevFrame || { rms: 0, bands: new Array(AUDIO_DATA.bands).fill(0) };

  if (!prevFrame) {
    prevFrame = { rms: raw.rms, bands: [...raw.bands] };
    return prevFrame;
  }

  const smoothed = {
    rms: prevFrame.rms * smoothing + raw.rms * (1 - smoothing),
    bands: raw.bands.map((b, i) => prevFrame.bands[i] * smoothing + b * (1 - smoothing)),
  };
  prevFrame = smoothed;
  return smoothed;
}
```

Use `getSmoothedFrame(f)` instead of `AUDIO_DATA.frames[f]` in the draw calls.

## Band Count Guide

| Bands | Detail level | Good for                                      |
| ----- | ------------ | --------------------------------------------- |
| 4     | Low          | Pulsing circles, simple bars, background glow |
| 8     | Medium       | Spectrum bars, mirrored waveforms (default)   |
| 16    | High         | Circular visualizers, detailed EQ displays    |
| 32    | Very high    | Smooth curves, dense radial visualizers       |

More bands = larger JSON file. 8 is a good default for most visualizations.

## Combining Patterns

Layer multiple canvases with CSS z-index for rich compositions:

```html
<canvas id="bg-glow" style="position:absolute;top:0;left:0;z-index:1;"></canvas>
<canvas id="spectrum" style="position:absolute;top:0;left:0;z-index:2;"></canvas>
```

Background glow reacts to bass while spectrum bars show the full frequency range.

## HyperFrames Integration Notes

- The `<canvas>` element needs `data-start`, `data-duration`, and `data-track-index` like any other clip
- Set canvas width/height attributes to match the composition dimensions (1920x1080)
- The extraction script FPS must match the render FPS (default: 30)
- For large audio files, the JSON can be several MB — load via fetch rather than inlining
- Smoothing works correctly with seeking because `prevFrame` resets — but for perfect seek behavior, disable smoothing or pre-compute smoothed values in the extraction script
