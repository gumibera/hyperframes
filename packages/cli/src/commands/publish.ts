/**
 * `hyperframes publish` — start the preview and expose it through a public
 * HTTPS tunnel so the project can be shared with a single URL. No account,
 * no third-party tooling setup on the user's part — we pick the best tunnel
 * available (`cloudflared` if present, else `ssh`-based tuns.sh as a
 * universal fallback) and print the URL.
 *
 * The shared URL lives for the duration of the process. When the user hits
 * Ctrl-C, both the preview server and the tunnel shut down.
 */

import { basename, resolve } from "node:path";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";

import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { findPortAndServe, type FindPortResult } from "../server/portUtils.js";
import { lintProject } from "../utils/lintProject.js";
import { formatLintFindings } from "../utils/lintFormat.js";
import { openTunnel, pickTunnelProvider, type TunnelProvider } from "../utils/tunnel.js";
import { confirmPublishSecurity, generateToken, secureFetch } from "../utils/publishSecurity.js";

export const examples: Example[] = [
  ["Publish the current project with a public URL", "hyperframes publish"],
  ["Publish a specific directory", "hyperframes publish ./my-video"],
  ["Force tuns.sh (skip cloudflared)", "hyperframes publish --provider tuns"],
  ["Pick the port the preview binds to", "hyperframes publish --port 4830"],
  ["Allow remote edits (trusted collaborator)", "hyperframes publish --allow-edit"],
  ["Skip the consent prompt (scripts)", "hyperframes publish --yes"],
];

export default defineCommand({
  meta: {
    name: "publish",
    description: "Start the preview and expose it via a public URL",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    port: { type: "string", description: "Port to run the preview server on", default: "3002" },
    provider: {
      type: "string",
      description: "Tunnel provider: cloudflared | tuns | auto (default)",
      default: "auto",
    },
    "allow-edit": {
      type: "boolean",
      description: "Allow remote visitors to write / delete project files (default: read-only)",
      default: false,
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the security consent prompt",
      default: false,
    },
  },
  async run({ args }) {
    const rawArg = args.dir;
    const dir = resolve(rawArg ?? ".");
    const isImplicitCwd = !rawArg || rawArg === "." || rawArg === "./";
    const projectName = isImplicitCwd ? basename(process.env["PWD"] ?? dir) : basename(dir);
    const startPort = parseInt(args.port ?? "3002", 10);

    const providerArg = (args.provider ?? "auto") as TunnelProvider | "auto";
    const provider = pickTunnelProvider(providerArg);
    if (!provider) {
      console.error();
      console.error(`  ${c.error("Tunnel provider not available")}`);
      console.error();
      console.error(`  --provider ${providerArg} requires a binary that isn't installed.`);
      console.error(
        `  Install cloudflared  →  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/`,
      );
      console.error(`  Or use the default   →  hyperframes publish (falls back to ssh + tuns.sh)`);
      console.error();
      process.exitCode = 1;
      return;
    }

    // Lint before publishing — users share what the preview will render, so
    // surface any authoring issues up front.
    const indexPath = join(dir, "index.html");
    if (existsSync(indexPath)) {
      const lintResult = lintProject({ dir, name: projectName, indexPath });
      if (lintResult.totalErrors > 0 || lintResult.totalWarnings > 0) {
        console.log();
        for (const line of formatLintFindings(lintResult)) console.log(line);
        console.log();
      }
    }

    // Explicit consent before any public surface is exposed. The prompt
    // spells out the exposure — first-time users shouldn't learn what
    // `publish` does from a Twitter screenshot of someone else's laptop.
    const allowEdit = args["allow-edit"] === true;
    const approved = await confirmPublishSecurity({ skip: args.yes === true, allowEdit });
    if (!approved) {
      console.log();
      console.log(`  ${c.dim("Aborted.")}`);
      console.log();
      return;
    }

    clack.intro(c.bold("hyperframes publish"));

    // Mint the session token before the server so the middleware can
    // reference it before any request lands.
    const token = generateToken();

    // 1. Start the preview server on an available port. The server's own
    // fetch handler is wrapped with `secureFetch` — we don't use Hono
    // middleware because the studio routes are registered inside
    // `createStudioServer`, and `.use('*', ...)` added afterwards doesn't
    // apply to already-registered routes. Wrapping `fetch` sidesteps that
    // ordering issue entirely and enforces the policy at the HTTP boundary.
    //
    // `createStudioServer` throws `StudioAssetsMissingError` when the
    // built studio UI is missing. We try to FIX rather than complain:
    // if the CLI is running from inside the hyperframes-oss monorepo we
    // can rebuild the studio ourselves. Only if that fails (or there's
    // nothing to build — e.g. a broken global install) do we surface
    // the error to the user.
    const { createStudioServer, StudioAssetsMissingError } =
      await import("../server/studioServer.js");

    async function buildStudio(): Promise<{ ok: true } | { ok: false; reason: string }> {
      return new Promise((resolveP) => {
        try {
          const { existsSync: exists } = require("node:fs") as typeof import("node:fs");
          const { spawn } = require("node:child_process") as typeof import("node:child_process");
          const { resolve: r } = require("node:path") as typeof import("node:path");
          // __dirname inside the built CLI is `dist/`. Walk up to the
          // monorepo root and check for `packages/studio`.
          const candidates = [
            r(__dirname, "..", "..", "studio"),
            r(__dirname, "..", "..", "..", "studio"),
          ];
          const studioPkg = candidates.find((p) => exists(r(p, "package.json")));
          if (!studioPkg) return resolveP({ ok: false, reason: "not a dev checkout" });

          const bin = exists("/opt/homebrew/bin/bun")
            ? "/opt/homebrew/bin/bun"
            : exists("/usr/local/bin/bun")
              ? "/usr/local/bin/bun"
              : "bun";
          const child = spawn(bin, ["run", "build"], {
            cwd: studioPkg,
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stderr = "";
          child.stderr?.on("data", (d: Buffer) => {
            stderr += d.toString();
          });
          child.on("exit", (code: number | null) => {
            resolveP(
              code === 0
                ? { ok: true }
                : { ok: false, reason: stderr.trim() || `exited with ${code ?? "?"}` },
            );
          });
          child.on("error", (err: Error) => resolveP({ ok: false, reason: err.message }));
        } catch (err) {
          resolveP({ ok: false, reason: (err as Error).message });
        }
      });
    }

    async function makeStudio(): Promise<ReturnType<typeof createStudioServer>> {
      try {
        return createStudioServer({ projectDir: dir, projectName });
      } catch (err: unknown) {
        if (!(err instanceof StudioAssetsMissingError)) throw err;
        // Try to auto-repair.
        const repairSpinner = clack.spinner();
        repairSpinner.start("Studio assets missing — rebuilding");
        const result = await buildStudio();
        if (!result.ok) {
          repairSpinner.stop(c.error("Could not rebuild studio"));
          console.error();
          console.error(`  ${c.error("Cannot publish — studio assets are missing.")}`);
          console.error();
          console.error(`  ${c.dim(`Auto-rebuild failed: ${result.reason}`)}`);
          console.error();
          for (const line of err.message.split("\n").slice(1)) {
            console.error(`  ${c.dim(line)}`);
          }
          console.error();
          process.exit(1);
        }
        repairSpinner.stop(c.success("Studio rebuilt"));
        return createStudioServer({ projectDir: dir, projectName });
      }
    }

    const { app } = await makeStudio();
    const guardedFetch = secureFetch(app.fetch.bind(app), { token, allowEdit });

    const localSpinner = clack.spinner();
    localSpinner.start("Starting preview server...");

    let portResult: FindPortResult;
    try {
      portResult = await findPortAndServe(guardedFetch, startPort, dir, /* forceNew */ true);
    } catch (err: unknown) {
      localSpinner.stop(c.error("Failed to start preview server"));
      console.error();
      console.error(`  ${(err as Error).message}`);
      console.error();
      process.exitCode = 1;
      return;
    }
    const localUrl = `http://localhost:${portResult.port}`;
    localSpinner.stop(c.success(`Preview on ${localUrl}`));

    // 2. Open the tunnel.
    const tunnelSpinner = clack.spinner();
    tunnelSpinner.start(`Opening tunnel via ${provider}...`);

    let tunnelHandle;
    try {
      tunnelHandle = await openTunnel({ provider, localUrl });
    } catch (err: unknown) {
      tunnelSpinner.stop(c.error("Tunnel failed"));
      console.error();
      console.error(`  ${(err as Error).message}`);
      console.error();
      if (provider === "cloudflared") {
        console.error(`  Retry with  →  hyperframes publish --provider tuns`);
      } else {
        console.error(`  tuns.sh may be unreachable. Install cloudflared and retry:`);
        console.error(`    brew install cloudflared`);
      }
      console.error();
      process.exitCode = 1;
      return;
    }

    // Token goes in the query string of the entry URL only. The middleware
    // immediately redirects to drop it and sets a session cookie; the token
    // never appears in browser history or referrer headers after that.
    const publicProjectUrl = `${tunnelHandle.publicUrl}/?t=${token}#project/${projectName}`;
    tunnelSpinner.stop(c.success("Tunnel ready"));

    console.log();
    console.log(`  ${c.dim("Project")}    ${c.accent(projectName)}`);
    console.log(`  ${c.dim("Local")}      ${c.accent(localUrl)}`);
    console.log(`  ${c.dim("Public")}     ${c.accent(publicProjectUrl)}`);
    console.log(`  ${c.dim("Provider")}   ${tunnelHandle.provider}`);
    console.log(
      `  ${c.dim("Access")}     ${allowEdit ? c.warn("read + write (--allow-edit)") : "read-only"}`,
    );
    console.log();
    console.log(`  ${c.dim("The Public URL carries a 32-byte token — treat it like a password.")}`);
    console.log(
      `  ${c.dim("Share it privately. Anyone with the full URL can reach the studio for up to 12 h.")}`,
    );
    console.log(`  ${c.dim("Press Ctrl+C to stop sharing.")}`);
    console.log();

    // Clean up the tunnel when the user Ctrl-Cs. The preview server is part
    // of this process and goes away with it; only the tunnel child needs to
    // be reaped explicitly so cloudflared/ssh don't hang around.
    const cleanup = (): void => {
      tunnelHandle.close();
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("exit", cleanup);

    // Block forever — preview and tunnel keep running until the user exits.
    return new Promise<void>(() => {});
  },
});
