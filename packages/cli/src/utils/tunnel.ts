/**
 * Open a public HTTPS tunnel to a local URL. Used by `hyperframes publish` to
 * turn a local preview into a shareable link without the user running any
 * third-party service themselves.
 *
 * Providers, in preference order:
 *   1. `cloudflared` — most reliable free quick-tunnel (Cloudflare's own).
 *      Requires the `cloudflared` binary. Brew-installable on macOS.
 *   2. `tuns.sh`     — zero-install fallback via `ssh -R`. Works anywhere
 *      with OpenSSH (which is everywhere). Slightly less rock-solid than
 *      cloudflared but always available.
 *
 * Detection picks whichever is present. The caller can force a specific
 * provider; `"none"` is returned if no provider is usable so the caller can
 * render a helpful install hint.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { execSync } from "node:child_process";

export type TunnelProvider = "cloudflared" | "tuns";

export interface TunnelHandle {
  /** Public HTTPS URL the tunnel terminates at. */
  publicUrl: string;
  /** Provider that opened the tunnel, for UX/debug display. */
  provider: TunnelProvider;
  /** Stop the tunnel. Idempotent. */
  close: () => void;
}

/**
 * Choose a tunnel provider for this environment. `preference` lets the user
 * force one; otherwise we probe for `cloudflared` and fall back to `tuns`.
 * Returns `null` only when the user explicitly requested an unavailable
 * provider — `tuns` is assumed to be reachable because OpenSSH is always
 * installed.
 */
export function pickTunnelProvider(preference?: TunnelProvider | "auto"): TunnelProvider | null {
  if (preference === "cloudflared") return hasBinary("cloudflared") ? "cloudflared" : null;
  if (preference === "tuns") return "tuns";
  if (hasBinary("cloudflared")) return "cloudflared";
  return "tuns";
}

function hasBinary(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract the first tunnel URL from a provider's output stream. Each provider
 * prints it on a dedicated line within the first few seconds; we just watch
 * for the known pattern. Exported so tests can exercise it in isolation.
 */
export function extractTunnelUrl(provider: TunnelProvider, chunk: string): string | null {
  const pattern =
    provider === "cloudflared"
      ? /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i
      : /https:\/\/[a-z0-9-]+\.tuns\.sh/i;
  const match = chunk.match(pattern);
  return match ? match[0] : null;
}

/**
 * Open a tunnel to `localUrl` and resolve with the public URL once the
 * provider prints it. Rejects if the provider exits before emitting a URL
 * or if `timeoutMs` elapses.
 */
export function openTunnel(params: {
  provider: TunnelProvider;
  localUrl: string;
  timeoutMs?: number;
}): Promise<TunnelHandle> {
  const { provider, localUrl } = params;
  const timeoutMs = params.timeoutMs ?? 30_000;

  const child = spawnProvider(provider, localUrl);

  return new Promise<TunnelHandle>((resolve, reject) => {
    let resolved = false;

    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      child.kill();
      reject(new Error(`Tunnel provider "${provider}" did not emit a URL within ${timeoutMs}ms`));
    }, timeoutMs);

    const onData = (data: Buffer): void => {
      if (resolved) return;
      const url = extractTunnelUrl(provider, data.toString());
      if (!url) return;
      resolved = true;
      clearTimeout(timer);
      resolve({
        publicUrl: url,
        provider,
        close: () => {
          try {
            child.kill();
          } catch {
            /* already dead */
          }
        },
      });
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    child.on("exit", (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      reject(
        new Error(`Tunnel provider "${provider}" exited with code ${code} before emitting a URL`),
      );
    });
  });
}

function spawnProvider(provider: TunnelProvider, localUrl: string): ChildProcess {
  if (provider === "cloudflared") {
    return spawn("cloudflared", ["tunnel", "--url", localUrl], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  }
  // tuns.sh: SSH remote-forward 80 → localhost:<port>. Quiet flags keep the
  // terminal noise down; BatchMode=yes forbids password prompts (we should
  // never see one with `nokey@` but it's a belt-and-braces guard).
  const port = new URL(localUrl).port || "80";
  return spawn(
    "ssh",
    [
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "BatchMode=yes",
      "-o",
      "ServerAliveInterval=60",
      "-o",
      "ExitOnForwardFailure=yes",
      "-R",
      `80:localhost:${port}`,
      "nokey@tuns.sh",
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
}
