/**
 * Build the Codex plugin by copying skills from the repo-root `skills/`
 * directory into `packages/codex-plugin/skills/`.
 *
 * The Codex plugin is source-of-truth in-tree: users install it with
 *   codex plugin marketplace add heygen-com/hyperframes --sparse packages/codex-plugin
 * so the built output must be committed. CI runs this script with --check
 * to fail if the committed output has drifted from the skills/ sources.
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DriftEntry } from "../../scripts/lib/sync.ts";
import { reportAndExit, walkFiles } from "../../scripts/lib/sync.ts";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoSkillsDir = resolve(__dirname, "..", "..", "skills");
const outDir = resolve(__dirname, "skills");

// Skills to include in the plugin. Explicit allowlist so a new top-level
// skills/ entry doesn't silently ship in the plugin.
const SKILLS = [
  "hyperframes",
  "hyperframes-cli",
  "hyperframes-registry",
  "gsap",
  "website-to-hyperframes",
];

const checkMode = process.argv.includes("--check");

function assertSkillDir(src: string) {
  let stat;
  try {
    stat = statSync(src);
  } catch {
    throw new Error(`Missing skill source: ${src}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Expected directory, got file: ${src}`);
  }
}

function reportExtras() {
  const extras = readdirSync(repoSkillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKILLS.includes(e.name))
    .map((e) => e.name);
  if (extras.length > 0) {
    console.log(
      `\nNote: skills/ contains directories not in the plugin allowlist: ${extras.join(", ")}.`,
    );
    console.log("Add to SKILLS in build.mts if they should ship.");
  }
}

/**
 * Returns the expected file map (relative path → bytes) and the actual file
 * map from the built output. Used by both apply and check modes.
 */
function buildFileMaps(): { expected: Map<string, Buffer>; actual: Map<string, Buffer> } {
  const expected = new Map<string, Buffer>();
  for (const name of SKILLS) {
    const src = join(repoSkillsDir, name);
    assertSkillDir(src);
    for (const rel of walkFiles(src)) {
      expected.set(join(name, rel), readFileSync(join(src, rel)));
    }
  }
  const actual = new Map<string, Buffer>();
  if (existsSync(outDir)) {
    for (const rel of walkFiles(outDir)) {
      actual.set(rel, readFileSync(join(outDir, rel)));
    }
  }
  return { expected, actual };
}

function diff(expected: Map<string, Buffer>, actual: Map<string, Buffer>): DriftEntry[] {
  const drifted: DriftEntry[] = [];
  for (const [path, content] of expected) {
    const have = actual.get(path);
    if (!have) drifted.push({ kind: "missing", path });
    else if (!have.equals(content)) drifted.push({ kind: "changed", path });
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) drifted.push({ kind: "extra", path });
  }
  return drifted.sort((a, b) => a.path.localeCompare(b.path));
}

if (checkMode) {
  const { expected, actual } = buildFileMaps();
  const drifted = diff(expected, actual);
  reportExtras();
  reportAndExit(drifted, {
    checkMode: true,
    label: "Codex plugin skills/",
    fixCommand: "bun run --cwd packages/codex-plugin build",
  });
} else {
  console.log(`Assembling Codex plugin skills/ from ${repoSkillsDir}\n`);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const name of SKILLS) {
    const src = join(repoSkillsDir, name);
    assertSkillDir(src);
    cpSync(src, join(outDir, name), { recursive: true });
    console.log(`  ${name}`);
  }
  reportExtras();
  console.log(`\n✓ Wrote ${SKILLS.length} skills to ${outDir}`);
}
