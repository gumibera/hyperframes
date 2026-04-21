/**
 * Build the Codex plugin by copying skills from the repo-root `skills/`
 * directory into `packages/codex-plugin/skills/`.
 *
 * The Codex plugin is source-of-truth in-tree: users install it with
 *   codex plugin marketplace add heygen-com/hyperframes --sparse packages/codex-plugin
 * so the built output must be committed. CI runs this script with --check
 * to fail if the committed output has drifted from the skills/ sources.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync } from "node:child_process";

const __dirname = new URL(".", import.meta.url).pathname;
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

function assemble(dest: string) {
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true });
  }
  mkdirSync(dest, { recursive: true });

  for (const name of SKILLS) {
    const src = join(repoSkillsDir, name);
    if (!existsSync(src) || !statSync(src).isDirectory()) {
      throw new Error(`Missing skill source: ${src}`);
    }
    cpSync(src, join(dest, name), { recursive: true });
    console.log(`  ${name}`);
  }

  const extras = readdirSync(repoSkillsDir).filter(
    (n) => !SKILLS.includes(n) && statSync(join(repoSkillsDir, n)).isDirectory(),
  );
  if (extras.length > 0) {
    console.log(
      `\nNote: skills/ contains directories not in the plugin allowlist: ${extras.join(", ")}.`,
    );
    console.log("Add to SKILLS in build.mts if they should ship.");
  }
}

if (checkMode) {
  const tmp = resolve(__dirname, ".skills-check");
  console.log("Assembling into temp dir for drift check...");
  assemble(tmp);
  try {
    execSync(`diff -r "${outDir}" "${tmp}"`, { stdio: "pipe" });
    console.log("\n✓ Codex plugin skills/ is up to date.");
    rmSync(tmp, { recursive: true });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = (e.stdout?.toString() || "") + (e.stderr?.toString() || "");
    rmSync(tmp, { recursive: true });
    console.error("\n✗ Codex plugin skills/ is out of sync with repo skills/.\n");
    console.error(out.slice(0, 2000));
    console.error("\nRun `bun run --cwd packages/codex-plugin build` and commit the result.");
    process.exit(1);
  }
} else {
  console.log(`Assembling Codex plugin skills/ from ${repoSkillsDir}\n`);
  assemble(outDir);
  console.log(`\n✓ Wrote ${SKILLS.length} skills to ${outDir}`);
}
