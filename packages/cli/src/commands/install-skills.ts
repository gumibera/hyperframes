import { defineCommand } from "citty";
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

const SKILLS_DIR = join(homedir(), ".claude", "skills");
const GSAP_REPO = "https://github.com/greensock/gsap-skills.git";
const GSAP_CACHE = join(homedir(), ".cache", "hyperframes", "gsap-skills");

// ---------------------------------------------------------------------------
// Bundled HyperFrames skills — embedded at build time from .claude/skills/
// ---------------------------------------------------------------------------

function getBundledSkillsDir(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  // In dev: cli/src/commands/ → ../../.claude/skills = repo root .claude/skills/
  const devPath = resolve(dir, "..", "..", "..", ".claude", "skills");
  // In built: cli/dist/ → skills = cli/dist/skills/
  const builtPath = resolve(dir, "skills");
  return existsSync(devPath) ? devPath : builtPath;
}

// ---------------------------------------------------------------------------
// GSAP skills — cloned from GitHub
// ---------------------------------------------------------------------------

function hasGit(): boolean {
  try {
    execSync("git --version", { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function fetchGsapSkills(): string {
  if (existsSync(GSAP_CACHE)) {
    // Pull latest
    try {
      execSync("git pull --ff-only", {
        cwd: GSAP_CACHE,
        stdio: "ignore",
        timeout: 30_000,
      });
    } catch {
      // If pull fails, nuke and re-clone
      rmSync(GSAP_CACHE, { recursive: true, force: true });
      execSync(`git clone --depth 1 ${GSAP_REPO} ${GSAP_CACHE}`, {
        stdio: "ignore",
        timeout: 60_000,
      });
    }
  } else {
    mkdirSync(dirname(GSAP_CACHE), { recursive: true });
    execSync(`git clone --depth 1 ${GSAP_REPO} ${GSAP_CACHE}`, {
      stdio: "ignore",
      timeout: 60_000,
    });
  }
  return GSAP_CACHE;
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

interface InstalledSkill {
  name: string;
  source: "hyperframes" | "gsap";
}

function installHyperframesSkills(): InstalledSkill[] {
  const bundledDir = getBundledSkillsDir();
  const installed: InstalledSkill[] = [];

  if (!existsSync(bundledDir)) {
    return installed;
  }

  const entries = readdirSync(bundledDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(bundledDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const destDir = join(SKILLS_DIR, entry.name);
    // Remove existing to avoid file/directory conflicts
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });
    cpSync(join(bundledDir, entry.name), destDir, { recursive: true });
    installed.push({ name: entry.name, source: "hyperframes" });
  }

  return installed;
}

function installGsapSkills(): InstalledSkill[] {
  const cacheDir = fetchGsapSkills();
  const installed: InstalledSkill[] = [];

  // GSAP skills are in skills/ subdirectory of the repo
  const skillsRoot = join(cacheDir, "skills");
  if (!existsSync(skillsRoot)) return installed;

  const entries = readdirSync(skillsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsRoot, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const destDir = join(SKILLS_DIR, entry.name);
    // Remove existing to avoid file/directory conflicts
    if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });
    cpSync(join(skillsRoot, entry.name), destDir, { recursive: true });
    installed.push({ name: entry.name, source: "gsap" });
  }

  return installed;
}

// ---------------------------------------------------------------------------
// List logic
// ---------------------------------------------------------------------------

function listInstalledSkills(): string[] {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(SKILLS_DIR, e.name, "SKILL.md")))
    .map((e) => e.name);
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

async function runInstall(): Promise<void> {
  clack.intro(c.bold("hyperframes skills"));

  mkdirSync(SKILLS_DIR, { recursive: true });

  // 1. Install HyperFrames skills
  const hfSpinner = clack.spinner();
  hfSpinner.start("Installing HyperFrames skills...");
  const hfSkills = installHyperframesSkills();
  if (hfSkills.length > 0) {
    hfSpinner.stop(c.success(`${hfSkills.length} HyperFrames skills installed`));
  } else {
    hfSpinner.stop(c.warn("No bundled HyperFrames skills found"));
  }

  // 2. Install GSAP skills
  if (!hasGit()) {
    clack.log.warn(c.warn("git not found — skipping GSAP skills. Install git and retry."));
  } else {
    const gsapSpinner = clack.spinner();
    gsapSpinner.start("Fetching GSAP skills from GitHub...");
    try {
      const gsapSkills = installGsapSkills();
      gsapSpinner.stop(c.success(`${gsapSkills.length} GSAP skills installed`));
    } catch (err) {
      gsapSpinner.stop(
        c.warn(`Failed to fetch GSAP skills: ${err instanceof Error ? err.message : err}`),
      );
    }
  }

  // 3. Summary
  const all = listInstalledSkills();
  console.log();
  console.log(`   ${c.dim("Location:")} ${c.bold(SKILLS_DIR)}`);
  console.log(`   ${c.dim("Skills:")}   ${all.map((s) => c.accent(s)).join(", ")}`);
  console.log();

  clack.outro(c.success("Skills ready. They'll be available in all Claude Code sessions."));
}

export default defineCommand({
  meta: {
    name: "skills",
    description: "Install HyperFrames and GSAP skills for Claude Code",
  },
  run: runInstall,
});
