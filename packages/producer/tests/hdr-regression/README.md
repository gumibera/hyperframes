# HDR Regression Fixtures

End-to-end fixtures that exercise the HDR rendering pipeline (BT.2020 PQ
10-bit encode, sRGB→BT.2020 overlay conversion, HDR10 container metadata,
mixed SDR + HDR source compositing).

These fixtures live next to the SDR regression tests but are verified by a
different mechanism, and **are not currently part of the CI regression
matrix**. See [Known gaps](#known-gaps) below.

## Fixtures

Each fixture is a self-contained composition under
`packages/producer/tests/hdr-regression/<id>/`:

| ID                   | What it covers                                                                                                                        | `meta.json` |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `sdr-baseline`       | All media types in plain SDR. Confirms the HDR pipeline doesn't regress SDR output.                                                   | yes         |
| `hdr-pq`             | Native HDR composition: BT.2020 PQ video + 16-bit HDR PNG + audio + captions + shader transitions, rendered with `--hdr`.             | yes         |
| `mixed-sdr-hdr`      | SDR (BT.709) and HDR (BT.2020 PQ) sources in the same scene stack. Renders twice (SDR and HDR) to exercise cross-transfer compositing. | yes         |
| `hdr-feature-stack`  | Six-scene tour through the HDR feature surface (overlays, transforms, mixed sources, white background, etc.).                         | no          |
| `opacity-mixed-fade` | Single scene with one SDR and one HDR clip, both fading in and yo-yoing opacity. Pinned regression for the SDR opacity bug.           | no          |

Fixtures with a `meta.json` are discoverable by the regression harness;
fixtures without it are only invoked by the smoke script (and manual renders
through the studio / CLI).

## How HDR is tested today

Three layers, in order of strength:

### 1. Engine unit tests (in CI, vitest)

Run by `bun run --filter @hyperframes/engine test`:

- `packages/engine/src/utils/hdr.test.ts` — transfer detection, BT.2020 vs
  BT.709 encoder param selection, `analyzeCompositionHdr`.
- `packages/engine/src/services/hdrCapture.test.ts` — float16 → PQ RGB
  conversion (the rgb48le capture path).
- `packages/engine/src/utils/mp4HdrBoxes.test.ts` — HDR10 mastering display
  (`mdcv`) and content light level (`clli`) box construction and post-mux
  injection.
- `packages/engine/src/utils/layerCompositor.test.ts`,
  `packages/engine/src/utils/alphaBlit.test.ts`,
  `packages/engine/src/utils/uint16-alignment-audit.test.ts` — 16-bpc
  compositing correctness.

These cover the building blocks but not the assembled pipeline.

### 2. `hdr-smoke.ts` (manual, not in CI)

`packages/producer/scripts/hdr-smoke.ts` renders every fixture in this
directory through the orchestrator with the right `hdr` flag, then asserts
on **color metadata** via `ffprobe`:

- `pix_fmt` (e.g. `yuv420p10le` for HDR)
- `color_transfer` (`smpte2084` for PQ, `bt709` for SDR)
- `color_primaries` (`bt2020` for HDR, `bt709` for SDR)
- HDR10 side data (MaxCLL / MasteringDisplay) when `requireHdrSideData` is
  set on the fixture

This gives a portable signal that the encode and side-data path are intact,
without requiring committed pixel goldens. **It does not verify visual
correctness** — opacity bugs, layer order regressions, transition glitches,
and similar visual issues will still pass it. Run locally:

```bash
bunx tsx packages/producer/scripts/hdr-smoke.ts                  # all fixtures
bunx tsx packages/producer/scripts/hdr-smoke.ts hdr-pq           # one fixture
KEEP_TEMP=1 bunx tsx packages/producer/scripts/hdr-smoke.ts      # keep workdir for inspection
```

Requires a working `ffmpeg` and `ffprobe` on `PATH`.

### 3. Visual regression harness (partial)

`packages/producer/src/regression-harness.ts` discovers fixtures by walking
`packages/producer/tests/*` and looking for `meta.json` + `src/index.html`.
It compares rendered output to a committed `output/output.mp4` golden using
PSNR and audio correlation.

For HDR:

- The three fixtures with `meta.json` (`sdr-baseline`, `hdr-pq`,
  `mixed-sdr-hdr`) are discoverable by the harness.
- **No HDR golden MP4s are committed**, so the harness will not actually
  validate them today.
- The `regression.yml` shards in `.github/workflows/regression.yml` enumerate
  named fixtures explicitly and do not include the HDR ones.
- The harness also doesn't pass `hdr: true` to `createRenderJob`, so even if
  goldens existed, the HDR encode path wouldn't be exercised through this
  route.

## Known gaps

- **No visual goldens.** Pixel-level correctness for HDR is uncovered. This
  is how the SDR opacity yoyo bug on `<video>`-backed clips slipped through
  initially — `hdr-smoke` passed because the metadata was correct.
- **`hdr-smoke` is not wired into CI.** It must be run by hand on
  HDR-touching changes.
- **Two fixtures (`hdr-feature-stack`, `opacity-mixed-fade`) lack
  `meta.json`** and are invisible to the regression harness. They exist for
  the smoke script and for manual / studio inspection.
- **Goldens are platform-sensitive.** Producing HDR goldens that are stable
  across local macOS development and the Linux Docker image used by the
  regression workflow is the open design problem blocking CI integration.

When making HDR-affecting changes, run both the engine unit tests and
`hdr-smoke` locally before opening a PR, and inspect the rendered output
visually for at least the affected fixture.

## Adding a new fixture

1. Create `packages/producer/tests/hdr-regression/<id>/` with:

   - `src/index.html` — composition entrypoint
   - `src/script.js`, `src/style.css` — as needed
   - `assets/` — media files (or symlinks to a sibling fixture's assets)
   - `meta.json` — optional, but required if you want the regression harness
     to discover it

2. Register it in `packages/producer/scripts/hdr-smoke.ts` by appending to
   the `FIXTURES` array with the expected `pix_fmt`, `color_transfer`,
   `color_primaries`, and (for HDR) `requireHdrSideData: true`.

3. Run it locally:

   ```bash
   bunx tsx packages/producer/scripts/hdr-smoke.ts <id>
   ```

4. If the fixture exercises a behavior worth pinning visually, plan how the
   golden will be produced (which platform, which encoder version) before
   committing one — see [Known gaps](#known-gaps).

## Related files

- `packages/producer/scripts/hdr-smoke.ts` — the smoke runner.
- `packages/engine/src/services/hdrCapture.ts` — rgb48le capture path.
- `packages/engine/src/utils/hdr.ts` — transfer / primaries detection and
  encoder param selection.
- `packages/engine/src/utils/mp4HdrBoxes.ts` — HDR10 container metadata.
- `packages/engine/src/services/screenshotService.ts` — DOM mask + video
  frame injection (the surface where the SDR opacity bug originated).
