import { readConfig, writeConfig } from "./config.js";
import { VERSION } from "../version.js";
import { c } from "../ui/colors.js";
import { isDevMode } from "../utils/env.js";

// This is a public project API key — safe to embed in client-side code.
// It only allows writing events, not reading data.
const POSTHOG_API_KEY = "phc_zjjbX0PnWxERXrMHhkEJWj9A9BhGVLRReICgsfTMmpx";
const POSTHOG_HOST = "https://us.i.posthog.com";
const FLUSH_TIMEOUT_MS = 5_000;

// ---------------------------------------------------------------------------
// Lightweight PostHog client — uses the HTTP batch API directly to avoid
// pulling in the full posthog-node SDK and its dependencies.
// All calls are fire-and-forget with a hard timeout.
// ---------------------------------------------------------------------------

interface EventProperties {
  [key: string]: string | number | boolean | undefined;
}

let eventQueue: Array<{
  event: string;
  properties: EventProperties;
  timestamp: string;
}> = [];

let telemetryEnabled: boolean | null = null;

/**
 * Check if telemetry should be active.
 * Disabled when: dev mode, user opted out, CI environment, or HYPERFRAMES_NO_TELEMETRY set.
 */
export function shouldTrack(): boolean {
  if (telemetryEnabled !== null) return telemetryEnabled;

  if (process.env["HYPERFRAMES_NO_TELEMETRY"] === "1" || process.env["DO_NOT_TRACK"] === "1") {
    telemetryEnabled = false;
    return false;
  }

  if (process.env["CI"] === "true" || process.env["CI"] === "1") {
    telemetryEnabled = false;
    return false;
  }

  if (isDevMode()) {
    telemetryEnabled = false;
    return false;
  }

  // Placeholder API key means it hasn't been configured yet
  if (!POSTHOG_API_KEY.startsWith("phc_")) {
    telemetryEnabled = false;
    return false;
  }

  const config = readConfig();
  telemetryEnabled = config.telemetryEnabled;
  return telemetryEnabled;
}

/**
 * Queue a telemetry event. Non-blocking, fail-silent.
 */
export function trackEvent(event: string, properties: EventProperties = {}): void {
  if (!shouldTrack()) return;

  eventQueue.push({
    event,
    properties: {
      ...properties,
      cli_version: VERSION,
      os: process.platform,
      arch: process.arch,
      node_version: process.version,
    },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Flush all queued events to PostHog via async HTTP POST.
 * Called before normal process exit via `beforeExit`.
 */
export async function flush(): Promise<void> {
  if (eventQueue.length === 0) {
    return;
  }

  const config = readConfig();
  const batch = eventQueue.map((e) => ({
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: config.anonymousId,
    timestamp: e.timestamp,
  }));
  eventQueue = [];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FLUSH_TIMEOUT_MS);

  try {
    await fetch(`${POSTHOG_HOST}/batch/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: POSTHOG_API_KEY, batch }),
      signal: controller.signal,
    });
  } catch {
    // Silently ignore — telemetry must never break the CLI
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Synchronous flush for use in the `exit` event handler (which doesn't support async).
 * Uses a synchronous XMLHttpRequest-style approach via child_process to ensure
 * events are sent even when process.exit() is called.
 */
export function flushSync(): void {
  if (eventQueue.length === 0) {
    return;
  }

  const config = readConfig();
  const batch = eventQueue.map((e) => ({
    event: e.event,
    properties: { ...e.properties, $ip: null },
    distinct_id: config.anonymousId,
    timestamp: e.timestamp,
  }));
  eventQueue = [];

  const payload = JSON.stringify({ api_key: POSTHOG_API_KEY, batch });

  try {
    // Spawn a detached process to send the request so we don't block exit.
    // The subprocess inherits nothing and runs independently.
    const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
    execFileSync(
      process.execPath,
      [
        "-e",
        `fetch(${JSON.stringify(`${POSTHOG_HOST}/batch/`)},{method:"POST",headers:{"Content-Type":"application/json"},body:${JSON.stringify(payload)},signal:AbortSignal.timeout(${FLUSH_TIMEOUT_MS})}).catch(()=>{})`,
      ],
      { stdio: "ignore", timeout: FLUSH_TIMEOUT_MS },
    );
  } catch {
    // Silently ignore
  }
}

/**
 * Show the first-run telemetry notice if it hasn't been shown yet.
 * Returns true if the notice was shown (so callers can add spacing).
 */
export function showTelemetryNotice(): boolean {
  if (!shouldTrack()) return false;

  const config = readConfig();
  if (config.telemetryNoticeShown) return false;

  console.log();
  console.log(`  ${c.dim("Hyperframes collects anonymous usage data to improve the tool.")}`);
  console.log(`  ${c.dim("No personal info, file paths, or content is collected.")}`);
  console.log();
  console.log(`  ${c.dim("Disable anytime:")} ${c.accent("hyperframes telemetry disable")}`);
  console.log();

  config.telemetryNoticeShown = true;
  writeConfig(config);
  return true;
}
