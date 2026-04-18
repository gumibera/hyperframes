#!/usr/bin/env bash
#
# Copy the built studio UI, runtime skills, and static assets into
# `packages/cli/dist/` so `hyperframes preview` / `hyperframes publish`
# can serve them without reaching into sibling workspaces at runtime.
#
# This script fails loudly if any required source is missing — previously
# `cp -r ../studio/dist/*` would silently succeed with zero files when
# the studio was not yet built, producing a CLI bundle that shipped a
# tunnel URL whose every request returned `500 Studio not found`. That
# failure was invisible until someone tried to actually share a link.
#
# Preconditions: `bun run build:studio` has already run. We verify by
# checking for the sentinel `index.html`.

set -euo pipefail

CLI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$CLI_DIR"

STUDIO_DIST="../studio/dist"
STUDIO_INDEX="$STUDIO_DIST/index.html"

if [[ ! -f "$STUDIO_INDEX" ]]; then
  echo "❌ build:copy: studio dist is missing ($STUDIO_INDEX)" >&2
  echo "   The 'build:studio' step should have produced this file." >&2
  echo "   From the repo root, run: bun install && bun run build" >&2
  exit 1
fi

mkdir -p dist/studio dist/docs dist/templates dist/skills dist/docker

# Copy the studio bundle. Using a glob with shopt so an empty source
# directory would be caught as an error even if index.html existed.
shopt -s nullglob
STUDIO_FILES=("$STUDIO_DIST"/*)
if [[ ${#STUDIO_FILES[@]} -eq 0 ]]; then
  echo "❌ build:copy: studio dist is empty" >&2
  exit 1
fi
cp -r "${STUDIO_FILES[@]}" dist/studio/

# Verify the copy actually landed — a partial copy would otherwise only
# surface when someone hit the published URL.
if [[ ! -f "dist/studio/index.html" ]]; then
  echo "❌ build:copy: dist/studio/index.html missing after copy" >&2
  exit 1
fi

cp -r src/templates/blank src/templates/_shared dist/templates/
cp -r ../../skills/hyperframes ../../skills/hyperframes-cli ../../skills/gsap dist/skills/
cp src/docker/Dockerfile.render dist/docker/

# Optional docs — silent if none exist.
if compgen -G "src/docs/*.md" > /dev/null; then
  cp src/docs/*.md dist/docs/
fi

echo "✓ build:copy: dist/studio, templates, skills, docker copied"
