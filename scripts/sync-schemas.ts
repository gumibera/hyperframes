#!/usr/bin/env tsx
/**
 * Mirror JSON Schemas from `packages/core/schemas/` into `docs/schema/` so
 * Mintlify serves them at `https://hyperframes.heygen.com/schema/*`. The core
 * copies stay authoritative — they're exported from `@hyperframes/core` for
 * npm consumers — and this script is the single contract that prevents the
 * docs mirror from drifting.
 *
 * Usage:
 *   bun run sync-schemas         # copy core → docs
 *   bun run sync-schemas --check # exit non-zero if copies are stale (CI)
 *
 * `docs/schema/hyperframes.json` is authored directly in docs (no source in
 * core) so it's skipped by this script.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { DriftEntry } from "./lib/sync.ts";
import { reportAndExit } from "./lib/sync.ts";

const ROOT = join(import.meta.dirname, "..");
const SOURCE_DIR = join(ROOT, "packages/core/schemas");
const TARGET_DIR = join(ROOT, "docs/schema");
const MIRRORED = ["registry.json", "registry-item.json"];

function main() {
  const checkMode = process.argv.includes("--check");
  const drifted: DriftEntry[] = [];

  for (const name of MIRRORED) {
    const source = readFileSync(join(SOURCE_DIR, name), "utf-8");
    const targetPath = join(TARGET_DIR, name);
    const target = (() => {
      try {
        return readFileSync(targetPath, "utf-8");
      } catch {
        return null;
      }
    })();

    if (target === source) continue;

    drifted.push({ kind: target === null ? "missing" : "changed", path: name });
    if (!checkMode) {
      writeFileSync(targetPath, source);
    }
  }

  reportAndExit(drifted, {
    checkMode,
    label: "docs/schema/",
    fixCommand: "bun run sync-schemas",
  });
}

main();
