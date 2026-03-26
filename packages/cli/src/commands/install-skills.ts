import { defineCommand } from "citty";
import { existsSync, mkdirSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

// ---------------------------------------------------------------------------
// Target CLI tools — each has a global skills directory
// ---------------------------------------------------------------------------

interface Target {
  name: string;
  flag: string;
  dir: string;
  defaultEnabled: boolean;
}

const TARGETS: Target[] = [
  {
    name: "Claude Code",
    flag: "claude",
    dir: join(homedir(), ".claude", "skills"),
    defaultEnabled: true,
  },
  {
    name: "Gemini CLI",
    flag: "gemini",
    dir: join(homedir(), ".gemini", "skills"),
    defaultEnabled: true,
  },
  {
    name: "Codex CLI",
    flag: "codex",
    dir: join(homedir(), ".codex", "skills"),
    defaultEnabled: true,
  },
  {
    name: "Cursor",
    flag: "cursor",
    get dir() {
      return join(process.cwd(), ".cursor", "skills");
    },
    defaultEnabled: false,
  },
];

// ---------------------------------------------------------------------------
// Skill sources — all fetched from GitHub
// ---------------------------------------------------------------------------

interface SkillSource {
  name: string;
  repo: string;
  /** Subdirectory within the repo that contains skill folders */
  skillsPath: string;
  cache: string;
}

const SOURCES: SkillSource[] = [
  {
    name: "HyperFrames",
    repo: "https://github.com/heygen-com/hyperframes.git",
    skillsPath: "skills",
    cache: join(homedir(), ".cache", "hyperframes", "hyperframes-skills"),
  },
  {
    name: "GSAP",
    repo: "https://github.com/greensock/gsap-skills.git",
    skillsPath: "skills",
    cache: join(homedir(), ".cache", "hyperframes", "gsap-skills"),
  },
];

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function hasGit(): boolean {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// Suppress git credential prompts — fail fast instead of hanging
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function gitClone(repo: string, dest: string): void {
  execFileSync("git", ["clone", "--depth", "1", repo, dest], {
    stdio: "ignore",
    timeout: 60_000,
    env: GIT_ENV,
  });
}

function fetchRepo(source: SkillSource): string {
  if (existsSync(source.cache)) {
    try {
      execFileSync("git", ["pull", "--ff-only"], {
        cwd: source.cache,
        stdio: "ignore",
        timeout: 30_000,
        env: GIT_ENV,
      });
    } catch {
      // Pull failed — use stale cache if valid
      const skillsDir = join(source.cache, source.skillsPath);
      if (existsSync(skillsDir)) {
        return skillsDir;
      }
      // Cache is broken — re-clone
      rmSync(source.cache, { recursive: true, force: true });
      gitClone(source.repo, source.cache);
    }
  } else {
    mkdirSync(dirname(source.cache), { recursive: true });
    gitClone(source.repo, source.cache);
  }
  return join(source.cache, source.skillsPath);
}

// ---------------------------------------------------------------------------
// Install logic
// ---------------------------------------------------------------------------

interface InstalledSkill {
  name: string;
  source: string;
  overwritten: boolean;
}

function installSkillsFromDir(
  sourceDir: string,
  targetDir: string,
  sourceName: string,
): InstalledSkill[] {
  const installed: InstalledSkill[] = [];
  if (!existsSync(sourceDir)) return installed;

  const entries = readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(sourceDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    const destDir = join(targetDir, entry.name);
    const overwritten = existsSync(destDir);
    if (overwritten) rmSync(destDir, { recursive: true, force: true });
    mkdirSync(destDir, { recursive: true });
    cpSync(join(sourceDir, entry.name), destDir, { recursive: true });
    installed.push({ name: entry.name, source: sourceName, overwritten });
  }
  return installed;
}

// ---------------------------------------------------------------------------
// Programmatic API — used by init command
// ---------------------------------------------------------------------------

export { TARGETS };

export async function installAllSkills(
  targetNames?: string[],
): Promise<{ count: number; targets: string[]; skipped: string[] }> {
  if (!hasGit()) return { count: 0, targets: [], skipped: SOURCES.map((s) => s.name) };

  const targets = targetNames
    ? TARGETS.filter((t) => targetNames.includes(t.flag))
    : TARGETS.filter((t) => t.defaultEnabled);
  let totalCount = 0;
  const skipped: string[] = [];

  // Fetch sources
  const fetched: { source: SkillSource; skillsDir: string }[] = [];
  for (const source of SOURCES) {
    try {
      const skillsDir = fetchRepo(source);
      if (existsSync(skillsDir)) {
        fetched.push({ source, skillsDir });
      } else {
        skipped.push(source.name);
      }
    } catch {
      skipped.push(source.name);
    }
  }

  // Install to first target and count, then install to remaining targets
  const [firstTarget, ...remainingTargets] = targets;
  if (firstTarget) {
    mkdirSync(firstTarget.dir, { recursive: true });
    for (const { skillsDir, source } of fetched) {
      const skills = installSkillsFromDir(skillsDir, firstTarget.dir, source.name);
      totalCount += skills.length;
    }
  }
  for (const target of remainingTargets) {
    mkdirSync(target.dir, { recursive: true });
    for (const { skillsDir, source } of fetched) {
      installSkillsFromDir(skillsDir, target.dir, source.name);
    }
  }

  return { count: totalCount, targets: targets.map((t) => t.name), skipped };
}

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

function resolveTargets(args: Record<string, unknown>): Target[] {
  const hasAnyFlag = TARGETS.some((t) => args[t.flag] === true);
  if (hasAnyFlag) {
    return TARGETS.filter((t) => args[t.flag] === true);
  }
  return TARGETS.filter((t) => t.defaultEnabled);
}

async function runInstall({ args }: { args: Record<string, unknown> }): Promise<void> {
  clack.intro(c.bold("hyperframes skills"));

  if (!hasGit()) {
    clack.log.error(c.error("git is required to install skills. Install git and retry."));
    clack.outro(c.warn("No skills installed."));
    return;
  }

  const targets = resolveTargets(args);

  // 1. Fetch all skill sources
  const fetched: { source: SkillSource; skillsDir: string }[] = [];

  for (const source of SOURCES) {
    const spinner = clack.spinner();
    spinner.start(`Fetching ${source.name} skills...`);
    try {
      const skillsDir = fetchRepo(source);
      if (existsSync(skillsDir)) {
        fetched.push({ source, skillsDir });
        spinner.stop(c.success(`${source.name} skills fetched`));
      } else {
        spinner.stop(c.warn(`${source.name}: no skills directory found`));
      }
    } catch {
      spinner.stop(c.dim(`${source.name} skills skipped (repo not accessible)`));
    }
  }

  // 2. Install to each target
  const allInstalled: InstalledSkill[] = [];

  let counted = false;
  for (const target of targets) {
    const spinner = clack.spinner();
    spinner.start(`Installing to ${target.name}...`);

    mkdirSync(target.dir, { recursive: true });

    let count = 0;
    for (const { source, skillsDir } of fetched) {
      const skills = installSkillsFromDir(skillsDir, target.dir, source.name);
      count += skills.length;
      if (!counted) allInstalled.push(...skills);
    }
    counted = true;

    spinner.stop(c.success(`${count} skills → ${target.name} ${c.dim(target.dir)}`));
  }

  // 3. Summary
  console.log();
  for (const source of SOURCES) {
    const names = allInstalled.filter((s) => s.source === source.name).map((s) => s.name);
    if (names.length > 0) {
      const label = `${source.name}:`.padEnd(14);
      console.log(`   ${c.dim(label)} ${names.map((s) => c.accent(s)).join(", ")}`);
    }
  }
  console.log(`   ${c.dim("Targets:")}      ${targets.map((t) => t.name).join(", ")}`);
  console.log();

  const skippedSources = SOURCES.filter((s) => !fetched.some((f) => f.source.name === s.name));
  if (skippedSources.length > 0) {
    console.log(
      `   ${c.dim("Skipped:")}      ${skippedSources.map((s) => s.name).join(", ")} (repo not accessible)`,
    );
  }
  console.log();

  if (allInstalled.length > 0 && skippedSources.length > 0) {
    const readySources = fetched.map((f) => f.source.name).join(", ");
    const skippedNames = skippedSources.map((s) => s.name).join(", ");
    clack.outro(
      c.warn(
        `${allInstalled.length} skills ready (${readySources}). Unavailable: ${skippedNames}.`,
      ),
    );
  } else if (allInstalled.length > 0) {
    clack.outro(c.success(`${allInstalled.length} skills ready.`));
  } else {
    clack.outro(c.warn("No skills installed."));
  }
}

export default defineCommand({
  meta: {
    name: "skills",
    description: "Install HyperFrames and GSAP skills for AI coding tools",
  },
  args: {
    claude: { type: "boolean", description: "Install to Claude Code (~/.claude/skills/)" },
    gemini: { type: "boolean", description: "Install to Gemini CLI (~/.gemini/skills/)" },
    codex: { type: "boolean", description: "Install to Codex CLI (~/.codex/skills/)" },
    cursor: {
      type: "boolean",
      description: "Install to Cursor (.cursor/skills/ in current project)",
    },
  },
  run: runInstall,
});
