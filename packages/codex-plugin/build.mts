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

function assemble() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const name of SKILLS) {
    const src = join(repoSkillsDir, name);
    assertSkillDir(src);
    cpSync(src, join(outDir, name), { recursive: true });
    console.log(`  ${name}`);
  }
}

function walkFiles(root: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(root, { withFileTypes: true });
  for (const e of entries) {
    const abs = join(root, e.name);
    if (e.isDirectory()) {
      for (const rel of walkFiles(abs)) out.push(join(e.name, rel));
    } else if (e.isFile()) {
      out.push(e.name);
    }
  }
  return out;
}

function detectDrift(): string[] {
  // Build the expected file map from source skills; the committed output is
  // the "actual". A drifted path is any that differs, is missing, or extra.
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

  const drifted: string[] = [];
  for (const [path, content] of expected) {
    const have = actual.get(path);
    if (!have) {
      drifted.push(`missing: ${path}`);
    } else if (!have.equals(content)) {
      drifted.push(`changed: ${path}`);
    }
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) drifted.push(`extra:   ${path}`);
  }
  return drifted.sort();
}

if (checkMode) {
  const drifted = detectDrift();
  reportExtras();
  if (drifted.length === 0) {
    console.log("\n✓ Codex plugin skills/ is up to date.");
  } else {
    console.error("\n✗ Codex plugin skills/ is out of sync with repo skills/:\n");
    for (const line of drifted.slice(0, 30)) console.error(`  ${line}`);
    if (drifted.length > 30) console.error(`  … and ${drifted.length - 30} more`);
    console.error("\nRun `bun run --cwd packages/codex-plugin build` and commit the result.");
    process.exit(1);
  }
} else {
  console.log(`Assembling Codex plugin skills/ from ${repoSkillsDir}\n`);
  assemble();
  reportExtras();
  console.log(`\n✓ Wrote ${SKILLS.length} skills to ${outDir}`);
}
