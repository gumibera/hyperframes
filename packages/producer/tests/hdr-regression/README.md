# hdr-regression

Comprehensive regression test that locks down end-to-end **HDR10 (BT.2020 PQ)**
rendering across the most common composition shapes that touch the layered HDR
compositing pipeline. Replaces the older single-shape `hdr-pq` and
`hdr-image-only` suites with a single 20-second timeline that exercises eight
windows back-to-back.

## What it covers

| Window | Time          | Shape                                     | Expected            |
| ------ | ------------- | ----------------------------------------- | ------------------- |
| A      | 0.0 – 2.0 s   | Baseline HDR video + DOM overlay          | pass                |
| B      | 2.0 – 4.5 s   | Wrapper opacity fade around HDR video     | pass                |
| C      | 4.5 – 7.0 s   | Direct `<video>` opacity tween            | **known fail (C1)** |
| D      | 7.0 – 9.5 s   | DOM → HDR → DOM z-order sandwich          | pass                |
| E      | 9.5 – 12.0 s  | Two HDR videos side-by-side (same source) | pass                |
| F      | 12.0 – 14.5 s | Transform + scale + border-radius         | **known fail (C4)** |
| G      | 14.5 – 17.0 s | `object-fit: contain` letterbox           | pass                |
| H      | 17.0 – 20.0 s | Shader transition (HDR video → HDR image) | pass                |

The test pins the contract that:

- `extractVideoMetadata` reports `bt2020/smpte2084/full` for the HDR clip.
- `parseImageElements` discovers the HDR PQ PNG (window H) and
  `extractStillImageMetadata` reads its `cICP` chunk.
- `isHdrColorSpace` flips the orchestrator into the layered HDR path.
- The HDR sources are decoded once into `rgb48le` and blitted under the SDR
  DOM overlay on every frame.
- Wrapper-opacity (window B) and z-order sandwiches (window D) compose
  correctly through the layered pipeline.
- Multiple HDR sources (window E) deduplicate and decode as expected.
- The shader transition library (`@hyperframes/shader-transitions`,
  `cross-warp-morph`) drives `window.__hf.transitions`, the engine reads that
  metadata, and the CPU-bound shader compositor produces the expected
  `rgb48le` blend across the transition window.
- `hdrEncoder` writes HEVC Main10 / `yuv420p10le` / BT.2020 PQ with HDR10
  mastering display + content light level metadata.

## Known failures

Windows **C** (direct `<video>` opacity) and **F** (transform + border-radius
on the video itself) are intentionally **expected to fail** until the
corresponding follow-up chunks land:

- **C** — fixed by chunk 1 (videoFrameInjector opacity-walk bugs).
- **F** — fixed by chunk 4 (transform + clipping pipeline).

`maxFrameFailures` is set high enough to absorb both windows. The intent is
that the suite stays green while we ship the fixes, **and tightens
automatically as soon as we regenerate goldens** (chunk 1 → drop C tolerance,
chunk 4 → drop F tolerance, eventually reaching `maxFrameFailures: 0`).

## Fixtures

- `src/hdr-clip.mp4` — short HEVC Main10 / BT.2020 PQ clip with a moving
  bright gradient (see `NOTICE.md` for attribution). Reused across windows
  A–G and as scene A of the window-H shader transition.
- `src/hdr-photo-pq.png` — 256×144 16-bit RGB PNG with a hand-injected `cICP`
  chunk (primaries=BT.2020, transfer=SMPTE ST 2084, matrix=GBR, range=full).
  Used as scene B of the window-H shader transition.

ffmpeg is **not** used to generate the PNG because it does not embed `cICP`
in PNGs — without that chunk Chromium would not treat the file as HDR and the
test would silently fall back to SDR.

To regenerate the PNG fixture (deterministic, byte-for-byte stable):

```bash
python3 packages/producer/tests/hdr-regression/scripts/generate-hdr-photo-pq.py
```

## Running

```bash
cd packages/producer
bun run test hdr-regression

bun run test:update hdr-regression
```

In CI it runs in the `hdr` shard alongside `hdr-hlg-regression`
(see `.github/workflows/regression.yml`).
