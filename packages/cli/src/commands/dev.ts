import { defineCommand } from "citty";
import { spawn } from "node:child_process";
import { existsSync, lstatSync, symlinkSync, unlinkSync, readlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname, basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as clack from "@clack/prompts";
import { c } from "../ui/colors.js";
import { isDevMode } from "../utils/env.js";

/**
 * Check if a port is available by trying to listen on it briefly.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const { createServer } = require("node:net") as typeof import("node:net");
    const server = createServer();
    server.once("error", () => resolvePromise(false));
    server.once("listening", () => {
      server.close(() => resolvePromise(true));
    });
    server.listen(port);
  });
}

/**
 * Find an available port starting from the given port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 10; port++) {
    if (await isPortAvailable(port)) return port;
  }
  return startPort; // fallback — let the server fail with a clear error
}

export default defineCommand({
  meta: { name: "dev", description: "Start the studio for local development" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    port: { type: "string", description: "Port to run the dev server on", default: "3002" },
  },
  async run({ args }) {
    const dir = resolve(args.dir ?? ".");
    const startPort = parseInt(args.port ?? "3002", 10);

    if (isDevMode()) {
      return runDevMode(dir);
    }

    // If @hyperframes/studio is installed locally, use Vite for full HMR
    if (hasLocalStudio(dir)) {
      return runLocalStudioMode(dir);
    }

    const port = await findAvailablePort(startPort);
    return runEmbeddedMode(dir, port);
  },
});

/**
 * Dev mode: spawn pnpm studio from the monorepo (existing behavior).
 */
async function runDevMode(dir: string): Promise<void> {
  // Find monorepo root by navigating from packages/cli/src/commands/
  const thisFile = fileURLToPath(import.meta.url);
  const repoRoot = resolve(dirname(thisFile), "..", "..", "..", "..");

  // Symlink project into the studio's data directory
  const projectsDir = join(repoRoot, "packages", "studio", "data", "projects");
  const projectName = basename(dir);
  const symlinkPath = join(projectsDir, projectName);

  mkdirSync(projectsDir, { recursive: true });

  let createdSymlink = false;
  if (dir !== symlinkPath) {
    if (existsSync(symlinkPath)) {
      try {
        const stat = lstatSync(symlinkPath);
        if (stat.isSymbolicLink()) {
          const target = readlinkSync(symlinkPath);
          if (resolve(target) !== resolve(dir)) {
            unlinkSync(symlinkPath);
          }
        }
        // If it's a real directory, leave it alone
      } catch {
        // Not a symlink — don't touch it
      }
    }

    if (!existsSync(symlinkPath)) {
      symlinkSync(dir, symlinkPath, "dir");
      createdSymlink = true;
    }
  }

  clack.intro(c.bold("hyperframes dev"));

  const s = clack.spinner();
  s.start("Starting studio...");

  // Run the new consolidated studio (single Vite dev server with API plugin)
  const studioPkgDir = join(repoRoot, "packages", "studio");
  const child = spawn("pnpm", ["exec", "vite"], {
    cwd: studioPkgDir,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let frontendUrl = "";

  function handleOutput(data: Buffer): void {
    const text = data.toString();

    // Detect Vite URL
    const localMatch = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
    if (localMatch && !frontendUrl) {
      frontendUrl = localMatch[1] ?? "";
      s.stop(c.success("Studio running"));
      console.log();
      console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
      console.log(`  ${c.dim("Studio")}    ${c.accent(frontendUrl)}`);
      console.log();
      console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
      console.log();

      const urlToOpen = `${frontendUrl}#/project/${projectName}`;
      import("open").then((mod) => mod.default(urlToOpen)).catch(() => {});

      child.stdout?.removeListener("data", handleOutput);
      child.stderr?.removeListener("data", handleOutput);
    }
  }

  child.stdout?.on("data", handleOutput);
  child.stderr?.on("data", handleOutput);

  // If child exits before we detect readiness, show what we have
  child.on("error", (err) => {
    s.stop(c.error("Failed to start studio"));
    console.error(c.dim(err.message));
  });

  function cleanup(): void {
    if (createdSymlink && existsSync(symlinkPath)) {
      try {
        unlinkSync(symlinkPath);
      } catch {
        /* ignore */
      }
    }
  }

  return new Promise<void>((resolvePromise) => {
    // Temporarily ignore SIGINT on the parent so Ctrl+C only kills the child.
    // The child gets SIGINT from the terminal's process group signal.
    // When the child exits, we clean up and resolve back to the caller.
    const noop = (): void => {};
    process.on("SIGINT", noop);

    child.on("close", () => {
      process.removeListener("SIGINT", noop);
      cleanup();
      resolvePromise();
    });
  });
}

/**
 * Check if @hyperframes/studio is installed locally in the project's node_modules.
 */
function hasLocalStudio(dir: string): boolean {
  try {
    const req = createRequire(join(dir, "package.json"));
    req.resolve("@hyperframes/studio/package.json");
    return true;
  } catch {
    return false;
  }
}

/**
 * Local studio mode: spawn Vite using a locally installed @hyperframes/studio.
 * Provides full Vite HMR and the complete studio experience.
 */
async function runLocalStudioMode(dir: string): Promise<void> {
  const req = createRequire(join(dir, "package.json"));
  const studioPkgPath = dirname(req.resolve("@hyperframes/studio/package.json"));
  const projectName = basename(dir);

  // Symlink project into studio's data directory
  const projectsDir = join(studioPkgPath, "data", "projects");
  const symlinkPath = join(projectsDir, projectName);
  mkdirSync(projectsDir, { recursive: true });

  let createdSymlink = false;
  if (dir !== symlinkPath) {
    if (existsSync(symlinkPath) && lstatSync(symlinkPath).isSymbolicLink()) {
      if (resolve(readlinkSync(symlinkPath)) !== resolve(dir)) {
        unlinkSync(symlinkPath);
      }
    }
    if (!existsSync(symlinkPath)) {
      symlinkSync(dir, symlinkPath, "dir");
      createdSymlink = true;
    }
  }

  clack.intro(c.bold("hyperframes dev") + c.dim(" (local studio)"));
  const s = clack.spinner();
  s.start("Starting studio...");

  const child = spawn("npx", ["vite"], {
    cwd: studioPkgPath,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let detected = false;

  function handleOutput(data: Buffer): void {
    const text = data.toString();
    const localMatch = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
    if (localMatch && !detected) {
      detected = true;
      const url = localMatch[1] ?? "";
      s.stop(c.success("Studio running"));
      console.log();
      console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
      console.log(`  ${c.dim("Studio")}    ${c.accent(url)}`);
      console.log();
      console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
      console.log();
      import("open").then((mod) => mod.default(`${url}#project/${projectName}`)).catch(() => {});
    }
  }

  child.stdout?.on("data", handleOutput);
  child.stderr?.on("data", handleOutput);
  child.on("error", (err) => {
    s.stop(c.error("Failed to start studio"));
    console.error(c.dim(err.message));
  });

  return new Promise<void>((resolvePromise) => {
    const noop = (): void => {};
    process.on("SIGINT", noop);
    child.on("close", () => {
      process.removeListener("SIGINT", noop);
      if (createdSymlink && existsSync(symlinkPath)) {
        try {
          unlinkSync(symlinkPath);
        } catch {
          /* ignore */
        }
      }
      resolvePromise();
    });
  });
}

/**
 * Embedded mode: serve the pre-built studio SPA with a standalone Hono server.
 * Works without any additional dependencies — the studio is bundled in dist/.
 */
async function runEmbeddedMode(dir: string, port: number): Promise<void> {
  const { createStudioServer } = await import("../server/studioServer.js");
  const { serve } = await import("@hono/node-server");

  const projectName = basename(dir);
  const { app, watcher } = createStudioServer({ projectDir: dir });

  clack.intro(c.bold("hyperframes dev"));
  const s = clack.spinner();
  s.start("Starting studio...");

  const server = serve({ fetch: app.fetch, port }, () => {
    const url = `http://localhost:${port}`;
    s.stop(c.success("Studio running"));
    console.log();
    console.log(`  ${c.dim("Project")}   ${c.accent(projectName)}`);
    console.log(`  ${c.dim("Studio")}    ${c.accent(url)}`);
    console.log();
    console.log(`  ${c.dim("Press Ctrl+C to stop")}`);
    console.log();
    import("open").then((mod) => mod.default(`${url}#project/${projectName}`)).catch(() => {});
  });

  return new Promise<void>((resolvePromise) => {
    process.on("SIGINT", () => {
      console.log();
      watcher.close();
      server.close(() => resolvePromise());
    });
  });
}
