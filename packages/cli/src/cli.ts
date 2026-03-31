#!/usr/bin/env node

// ── Fast-path exits ─────────────────────────────────────────────────────────
// Check --version before importing anything heavy. This makes
// `hyperframes --version` near-instant (~10ms vs ~80ms).
import { VERSION } from "./version.js";

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(VERSION);
  process.exit(0);
}

// ── Lazy imports ────────────────────────────────────────────────────────────
// Telemetry, update checks, and heavy modules are imported only when needed.
// For --help we skip telemetry entirely.

import { defineCommand, runMain } from "citty";

const isHelp = process.argv.includes("--help") || process.argv.includes("-h");

// ---------------------------------------------------------------------------
// CLI definition — all commands are lazy-loaded via dynamic import()
// ---------------------------------------------------------------------------

const subCommands = {
  init: () => import("./commands/init.js").then((m) => m.default),
  preview: () => import("./commands/preview.js").then((m) => m.default),
  render: () => import("./commands/render.js").then((m) => m.default),
  lint: () => import("./commands/lint.js").then((m) => m.default),
  info: () => import("./commands/info.js").then((m) => m.default),
  compositions: () => import("./commands/compositions.js").then((m) => m.default),
  benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
  browser: () => import("./commands/browser.js").then((m) => m.default),
  skills: () => import("./commands/install-skills.js").then((m) => m.default),
  transcribe: () => import("./commands/transcribe.js").then((m) => m.default),
  docs: () => import("./commands/docs.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  telemetry: () => import("./commands/telemetry.js").then((m) => m.default),
};

const main = defineCommand({
  meta: {
    name: "hyperframes",
    version: VERSION,
    description: "Create and render HTML video compositions",
  },
  subCommands,
});

// ---------------------------------------------------------------------------
// Telemetry — lazy-loaded, skipped for --help/--version
// ---------------------------------------------------------------------------

const commandArg = process.argv[2];
const command = commandArg && commandArg in subCommands ? commandArg : "unknown";

if (!isHelp && command !== "telemetry" && command !== "unknown") {
  // Defer telemetry import so --help doesn't pay for system metadata collection
  import("./telemetry/index.js").then(
    ({ showTelemetryNotice, trackCommand, shouldTrack, incrementCommandCount }) => {
      showTelemetryNotice();
      trackCommand(command);
      if (shouldTrack()) incrementCommandCount();
    },
  );
}

// Fire background update check (non-blocking)
const hasJsonFlag = process.argv.includes("--json");
if (!isHelp && !hasJsonFlag && command !== "upgrade") {
  import("./utils/updateCheck.js").then(({ checkForUpdate }) => {
    checkForUpdate().catch(() => {});
  });
}

// Async flush for normal exit
process.on("beforeExit", () => {
  import("./telemetry/index.js").then(({ flush }) => flush().catch(() => {}));
  if (!hasJsonFlag) {
    import("./utils/updateCheck.js").then(({ printUpdateNotice }) => printUpdateNotice());
  }
});

// Sync flush for process.exit() calls
process.on("exit", () => {
  // flushSync must be imported eagerly if it's needed synchronously in exit handler.
  // But since we only need it when telemetry was actually used, use try/require as fallback.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { flushSync } = require("./telemetry/index.js");
    flushSync();
  } catch {
    // Telemetry not yet loaded — nothing to flush
  }
});

runMain(main);
