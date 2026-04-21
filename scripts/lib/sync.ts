/**
 * Shared primitives for scripts that mirror one tree/file set into another
 * and need a --check mode that fails CI on drift.
 *
 * Used by `scripts/sync-schemas.ts` (flat file list) and
 * `packages/codex-plugin/build.mts` (recursive skill directories).
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";

export type DriftKind = "changed" | "missing" | "extra";

export interface DriftEntry {
  kind: DriftKind;
  /** Display path, relative to the source/target roots. */
  path: string;
}

/**
 * Recursively list file paths under `root`, returning paths relative to
 * `root`. Skips everything that isn't a regular file (symlinks, sockets).
 * Optional `filter` returns true to keep the file.
 */
export function walkFiles(root: string, filter?: (relPath: string) => boolean): string[] {
  const out: string[] = [];
  function visit(dir: string, prefix: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      const rel = prefix ? join(prefix, entry.name) : entry.name;
      if (entry.isDirectory()) {
        visit(abs, rel);
      } else if (entry.isFile() && (!filter || filter(rel))) {
        out.push(rel);
      }
    }
  }
  visit(root, "");
  return out;
}

/**
 * Print a sync/check result and, in check mode, exit non-zero on drift.
 *
 * The output shape is shared across sync scripts so users learn one pattern:
 * a ✓/✗ header, a per-entry list (capped), and a "run X to fix" hint.
 */
export function reportAndExit(
  drifted: DriftEntry[],
  options: {
    checkMode: boolean;
    /** What is being synced. Used in the success message. */
    label: string;
    /** Command the user should run to fix drift. */
    fixCommand: string;
    /** Max entries to print before truncating. Default 30. */
    maxEntries?: number;
  },
): void {
  const max = options.maxEntries ?? 30;
  if (drifted.length === 0) {
    console.log(`\n✓ ${options.label} is up to date.`);
    return;
  }
  if (!options.checkMode) {
    console.log(`\n${options.label}: ${drifted.length} file(s) updated.`);
    return;
  }
  console.error(`\n✗ ${options.label} is out of sync:\n`);
  for (const entry of drifted.slice(0, max)) {
    console.error(`  ${entry.kind.padEnd(7)} ${entry.path}`);
  }
  if (drifted.length > max) {
    console.error(`  … and ${drifted.length - max} more`);
  }
  console.error(`\nRun \`${options.fixCommand}\` and commit the result.`);
  process.exit(1);
}
