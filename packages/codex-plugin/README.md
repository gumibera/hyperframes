# @hyperframes/codex-plugin

[OpenAI Codex](https://developers.openai.com/codex/plugins) plugin that bundles the HyperFrames skills for AI-assisted video authoring.

## Install (direct from this repo)

```bash
codex plugin marketplace add heygen-com/hyperframes --sparse packages/codex-plugin
```

Then enable the `hyperframes` plugin in Codex.

## Requirements

The skills invoke the `hyperframes` CLI via `npx hyperframes`, which needs:

- **Node.js >= 22**
- **FFmpeg** on `PATH`

See [hyperframes.dev/quickstart](https://hyperframes.dev/quickstart) for full setup.

## What's inside

Five skills, source-of-truth in `skills/` at the repo root, copied verbatim by [`build.mts`](./build.mts):

- **hyperframes** — composition authoring (HTML + GSAP + CSS), house style, visual styles, palettes
- **hyperframes-cli** — `hyperframes init / lint / preview / render / transcribe / tts / doctor`
- **hyperframes-registry** — `hyperframes add` to install registry blocks and components
- **gsap** — GSAP tween/timeline/performance reference
- **website-to-hyperframes** — 7-step pipeline turning any URL into a video

## Structure

```
packages/codex-plugin/
  .codex-plugin/plugin.json    # Codex manifest
  assets/                      # icon + logo (PNGs)
  skills/                      # built output — DO NOT edit directly
  build.mts                    # copies ../../skills/<name>/ → ./skills/<name>/
```

## Editing skills

Edit the source in [`skills/`](../../skills/) at the repo root. Run the build to refresh the plugin copy:

```bash
bun run --cwd packages/codex-plugin build
```

CI runs `bun run --cwd packages/codex-plugin check` on every PR to fail if `skills/` here has drifted from the sources.

## Publishing

The plugin ships in the main HyperFrames release. To submit to OpenAI's plugin directory, we fork [openai/plugins](https://github.com/openai/plugins), copy the contents of this package into `plugins/hyperframes/`, append an entry to `.agents/plugins/marketplace.json`, and open a PR.
