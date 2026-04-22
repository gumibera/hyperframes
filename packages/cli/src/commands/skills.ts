import { defineCommand } from "citty";
import { execFileSync, spawn } from "node:child_process";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";

function hasNpx(): boolean {
  try {
    execFileSync("npx", ["--version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function runSkillsAdd(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["skills", "add", source, "--all"], {
      stdio: "inherit",
      timeout: 120_000,
      // The hosted docs endpoint serves a static .well-known skills index, so
      // the upstream `skills` CLI can install without cloning this repo or
      // touching Git LFS. Keep Git's clone-protection opt-out as a harmless
      // fallback in case upstream behavior changes.
      env: { ...process.env, GIT_CLONE_PROTECTION_ACTIVE: "0" },
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else if (signal === "SIGINT" || code === 130) process.exit(0);
      else reject(new Error(`npx skills add exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

const SOURCES = [{ name: "HyperFrames", repo: "https://hyperframes.heygen.com" }];

export default defineCommand({
  meta: {
    name: "skills",
    description: "Install HyperFrames skills for AI coding tools",
  },
  args: {},
  async run() {
    if (!hasNpx()) {
      clack.log.error(c.error("npx not found. Install Node.js and retry."));
      return;
    }

    for (const source of SOURCES) {
      console.log();
      console.log(c.bold(`Installing ${source.name} skills...`));
      console.log();
      try {
        await runSkillsAdd(source.repo);
      } catch {
        console.log(c.dim(`${source.name} skills skipped`));
      }
    }
  },
});
