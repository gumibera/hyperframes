# Rendering

Render compositions to MP4 with `npx hyperframes render`.

## Local Mode (default)

Uses Puppeteer (bundled Chromium) + system FFmpeg. Fast for iteration.
Requires: FFmpeg installed (`brew install ffmpeg` or `apt install ffmpeg`).

## Backend Selection

- `--backend chrome` — Always render through Chrome CDP. This is the reference renderer.
- `--backend native` — Render through the Rust/Skia native renderer. Unsupported browser features fail loudly with fallback reasons.
- `--backend auto` — Use native only when the composition passes support detection; otherwise fall back to Chrome for Chrome-perfect final output.

Native acceleration is a fast path for supported HyperFrames compositions, not a full Chromium replacement. SVG, canvas, iframe, video, unsupported CSS filters, masks, backdrop filters, vertical writing mode, animated elements without stable IDs, and other unsupported browser surfaces use Chrome fallback in `auto` mode.

## Docker Mode (--docker)

Deterministic output with exact Chrome version and fonts. For production.
Requires: Docker installed and running.

## Options

- `-f, --fps` — 24, 30, or 60 (default: 30)
- `-q, --quality` — draft, standard, high (default: standard)
- `-w, --workers` — Parallel workers 1-8 (default: auto)
- `--crf` — Override encoder CRF (mutually exclusive with `--video-bitrate`)
- `--video-bitrate` — Target video bitrate such as `10M` (mutually exclusive with `--crf`)
- `--gpu` — Use GPU encoding (NVENC, VideoToolbox, VAAPI)
- `--backend` — `chrome`, `native`, or `auto` (default: chrome)
- `-o, --output` — Custom output path

## Tips

- Use `draft` quality for fast previews during development
- Use `npx hyperframes benchmark` to find optimal settings
- 4 workers is usually the sweet spot for most compositions
