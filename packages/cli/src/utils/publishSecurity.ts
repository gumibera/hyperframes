/**
 * Security hardening for `hyperframes publish`.
 *
 * The studio server was built for localhost-only development — every
 * endpoint is unauthenticated and `PUT` / `POST` / `DELETE` / `PATCH` on
 * `/api/projects/:id/files/*` lets the caller read and overwrite the
 * project directory. Exposing that surface over a public URL without
 * guardrails is how you ship a "drop a keylogger in their `index.html`"
 * bug. This module provides four defences, designed to compose:
 *
 *   1. Token gate — shared-secret cookie gate. An inbound request must
 *      present either `?t=<token>` on its first hit (which also sets an
 *      httpOnly cookie for the session) OR the cookie on every subsequent
 *      hit. Requests without either get 404 — we deliberately don't 403
 *      so the URL leaks no information about a server existing.
 *
 *   2. Mutation gate — refuses `PUT` / `POST` / `DELETE` / `PATCH` on
 *      routes that modify the project filesystem when `allowEdit` is
 *      false. Read-only viewers get full preview; trusted collaborators
 *      can opt in via `publish --allow-edit`.
 *
 *   3. Read-only UI enforcement — when `allowEdit` is false, every HTML
 *      response is rewritten to inject a banner + CSS that blocks the
 *      Monaco editor from accepting keystrokes. Every response also
 *      carries `X-HF-Publish-Readonly: 1` so server-side callers (and
 *      future studio code) can detect the mode. The existing mutation
 *      gate is the real security boundary — this purely fixes the UX
 *      gap where the studio UI happily let visitors type into an editor
 *      whose saves the server would silently 403.
 *
 *   4. `confirmPublishSecurity()` — explicit consent on startup. Prints
 *      the exposure surface and waits for the user to hit Enter (skip
 *      with `--yes`). First-time users see the risk before the tunnel
 *      goes up.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import * as clack from "@clack/prompts";

import { c } from "../ui/colors.js";

type FetchHandler = (request: Request) => Promise<Response> | Response;

export interface SecureFetchOptions {
  token: string;
  allowEdit: boolean;
}

/** Name of the cookie that carries the authenticated-session marker. */
const SESSION_COOKIE = "hf_publish_session";
/** Query parameter the first-hit URL includes to exchange for the cookie. */
const TOKEN_QUERY_PARAM = "t";
/** Session lifetime. Long enough for a working session, short enough to limit leaked-cookie damage. */
const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
/** Response header emitted on every read-only response. Lets the studio UI (or any client) detect the mode. */
const READONLY_RESPONSE_HEADER = "X-HF-Publish-Readonly";

/** Mint a 32-byte base64url token, unguessable for tunnel URLs. */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Constant-time comparison. Don't leak which character mismatched via
 * short-circuit timing.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/**
 * Wrap an existing fetch handler with the token gate, mutation gate, and
 * read-only UI enforcement. The wrapped handler enforces the policy
 * independently of the underlying framework's middleware semantics —
 * specifically, Hono `.use()` only applies to routes registered *after*
 * it, and by the time `publish.ts` wants to gate the studio server the
 * routes have already been wired. A fetch wrapper sidesteps that
 * ordering entirely.
 *
 * Policy:
 *   1. Token gate — first-hit with `?t=<token>` exchanges the param for
 *      an httpOnly session cookie and redirects to the clean URL (so the
 *      token never lands in browser history or Referer headers). Every
 *      subsequent request must carry the cookie. Anything else → 404
 *      (not 401/403: don't advertise that something is here).
 *   2. Mutation gate — when `allowEdit` is false, refuse writes/deletes
 *      on `/api/projects/:id/files/*`, `POST /duplicate-file`, and
 *      `POST /render`. Authenticated reads still work.
 *   3. Read-only UI — when `allowEdit` is false, HTML responses get a
 *      `<script>` + `<style>` block injected before `</head>` that
 *      disables the Monaco editor and shows a banner. Every response
 *      carries `X-HF-Publish-Readonly: 1`.
 */
export function secureFetch(
  upstream: FetchHandler,
  options: SecureFetchOptions,
): (request: Request) => Promise<Response> {
  const { token, allowEdit } = options;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const queryToken = url.searchParams.get(TOKEN_QUERY_PARAM);
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookieToken = extractCookie(cookieHeader, SESSION_COOKIE);

    // ── Token gate ──
    if (!(cookieToken && safeEqual(cookieToken, token))) {
      if (queryToken && safeEqual(queryToken, token)) {
        url.searchParams.delete(TOKEN_QUERY_PARAM);
        const target = url.pathname + url.search + url.hash;
        return new Response(null, {
          status: 302,
          headers: {
            location: target,
            "set-cookie": buildSessionCookie(token),
          },
        });
      }
      return new Response("Not Found", { status: 404 });
    }

    // ── Mutation gate ──
    if (!allowEdit && isMutationEndpoint(request.method, url.pathname)) {
      return new Response(
        JSON.stringify({
          error: "forbidden",
          reason:
            "This tunnel is read-only. Re-run with `hyperframes publish --allow-edit` to enable writes.",
        }),
        {
          status: 403,
          headers: {
            "content-type": "application/json",
            [READONLY_RESPONSE_HEADER]: "1",
          },
        },
      );
    }

    const response = await upstream(request);

    // ── Read-only UI enforcement ──
    // Readonly header ships on every response so any client can detect
    // the mode. HTML injection is narrower: only the studio shell (SPA
    // routes). We deliberately skip `/api/*` because those endpoints
    // return the bundled composition HTML that renders inside the
    // player's iframe — injecting a banner there causes a double-banner
    // and pushes the composition layout around.
    if (allowEdit) return response;

    const contentType = response.headers.get("content-type") ?? "";
    const headers = new Headers(response.headers);
    headers.set(READONLY_RESPONSE_HEADER, "1");

    const isStudioShell =
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/assets/") &&
      !url.pathname.startsWith("/icons/");
    const isHtml = contentType.toLowerCase().includes("text/html");

    if (!isHtml || !isStudioShell) {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }

    const original = await response.text();
    const injected = injectReadonlyMarkup(original);
    headers.delete("content-length");
    return new Response(injected, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

function isMutationEndpoint(method: string, path: string): boolean {
  const isFileMutation =
    /^\/api\/projects\/[^/]+\/files\/.+/.test(path) &&
    (method === "PUT" || method === "POST" || method === "DELETE" || method === "PATCH");
  const isDuplicate = method === "POST" && /^\/api\/projects\/[^/]+\/duplicate-file$/.test(path);
  const isRender = method === "POST" && /^\/api\/projects\/[^/]+\/render$/.test(path);
  return isFileMutation || isDuplicate || isRender;
}

function buildSessionCookie(token: string): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function extractCookie(cookieHeader: string, name: string): string | null {
  // Intentionally a simple parser — Hono doesn't ship one in its core and
  // we don't need full RFC 6265 coverage here, just "find our cookie".
  const parts = cookieHeader.split(";");
  const prefix = `${name}=`;
  for (const raw of parts) {
    const part = raw.trim();
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

/**
 * The inline payload we inject into HTML responses when the session is
 * read-only. Sets a global flag, renders a banner, and neutralises the
 * Monaco editor surface so visitors can't type into a buffer whose saves
 * the server will reject.
 *
 * Kept inline (no external fetch) so it works even if the studio is
 * behind an aggressive proxy or the visitor is offline after the page
 * loads — the enforcement can't be bypassed by blocking a separate
 * network request.
 */
const READONLY_MARKUP = `<style id="hf-publish-readonly-style">
  /* Neutralise every editor surface the studio currently uses. */
  .monaco-editor, .monaco-editor *, .cm-editor, .cm-editor * {
    caret-color: transparent !important;
    user-select: none !important;
  }
  .monaco-editor .view-lines, .monaco-editor textarea, .cm-content, .cm-scroller textarea {
    pointer-events: none !important;
  }
  /* Hide buttons that only make sense when you can write. */
  [data-hf-mutating], .hf-new-file-button {
    display: none !important;
  }
  /* Compact fixed-position pill centered in the studio header. Fixed
     positioning keeps it out of the studio's 100vh flex layout so the
     player's transport controls don't overflow the viewport. */
  #hf-publish-readonly-banner {
    position: fixed; top: 10px; left: 50%;
    transform: translateX(-50%);
    z-index: 2147483647;
    padding: 7px 14px;
    display: inline-flex; align-items: center; gap: 8px;
    font: 500 11px/1.2 -apple-system, "SF Pro Text", Inter, system-ui, sans-serif;
    letter-spacing: 0.04em;
    color: #e6fff8;
    background: rgba(5,6,10,0.82);
    border: 1px solid rgba(76,240,200,0.35);
    border-radius: 999px;
    backdrop-filter: blur(12px);
    box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    pointer-events: none;
  }
  #hf-publish-readonly-banner .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #4cf0c8; box-shadow: 0 0 8px #4cf0c8;
  }
  #hf-publish-readonly-banner strong { color: #4cf0c8; font-weight: 600; letter-spacing: 0.08em; }
</style>
<script>
  (function () {
    try {
      window.__HF_PUBLISH_READONLY__ = true;
      var apply = function () {
        if (!document.body) return;
        document.body.classList.add("hf-publish-readonly");
        if (document.getElementById("hf-publish-readonly-banner")) return;
        var b = document.createElement("div");
        b.id = "hf-publish-readonly-banner";
        b.innerHTML =
          '<span class="dot"></span>' +
          '<span><strong>READ-ONLY</strong> &nbsp;·&nbsp; Published tunnel</span>';
        document.body.prepend(b);
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", apply, { once: true });
      } else {
        apply();
      }
      // Belt & suspenders: short-circuit mutating fetch calls client-side
      // so the UI doesn't silently swallow the 403 the server returns.
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        try {
          var method = (init && init.method ? init.method : "GET").toUpperCase();
          if (method === "PUT" || method === "POST" || method === "DELETE" || method === "PATCH") {
            var url = typeof input === "string" ? input : (input && input.url) || "";
            if (/\\/api\\/projects\\/[^/]+\\/(files|duplicate-file|render)/.test(url)) {
              return Promise.resolve(
                new Response(
                  JSON.stringify({ error: "forbidden", reason: "read-only published tunnel" }),
                  { status: 403, headers: { "content-type": "application/json" } }
                )
              );
            }
          }
        } catch (e) {}
        return origFetch.apply(this, arguments);
      };
    } catch (e) {}
  })();
</script>`;

function injectReadonlyMarkup(html: string): string {
  if (html.includes('id="hf-publish-readonly-style"')) return html;
  const headCloseIdx = html.search(/<\/head>/i);
  if (headCloseIdx !== -1) {
    return html.slice(0, headCloseIdx) + READONLY_MARKUP + html.slice(headCloseIdx);
  }
  const bodyOpenIdx = html.search(/<body[^>]*>/i);
  if (bodyOpenIdx !== -1) {
    const after = html.indexOf(">", bodyOpenIdx) + 1;
    return html.slice(0, after) + READONLY_MARKUP + html.slice(after);
  }
  // Fallback: prepend. The browser still parses this as leading HTML fine.
  return READONLY_MARKUP + html;
}

/**
 * Interactive consent prompt. Skipped when `skip` is true (usually via a
 * `--yes` flag) or in a non-TTY environment where we can't prompt safely.
 * Returns whether the user said yes; the caller is expected to abort on
 * `false`.
 */
export async function confirmPublishSecurity(params: {
  skip: boolean;
  allowEdit: boolean;
}): Promise<boolean> {
  if (params.skip) return true;
  if (!process.stdin.isTTY) {
    console.error();
    console.error(`  ${c.error("Refusing to publish non-interactively without --yes")}`);
    console.error();
    console.error(
      `  ${c.dim("`hyperframes publish` exposes the studio server to the public internet.")}`,
    );
    console.error(
      `  ${c.dim("Pass --yes to acknowledge you understand the exposure and continue.")}`,
    );
    console.error();
    return false;
  }

  console.log();
  console.log(`  ${c.bold("hyperframes publish exposes the studio server via a public URL.")}`);
  console.log();
  console.log(
    `  ${c.dim("The tunnel URL carries a random 32-byte token — treat it like a password:")}`,
  );
  console.log(
    `  ${c.dim("anyone who learns the full URL can hit the server for up to 12 hours.")}`,
  );
  console.log();
  if (params.allowEdit) {
    console.log(
      `  ${c.warn("--allow-edit is set. Visitors can read, write, and delete files in this project.")}`,
    );
  } else {
    console.log(
      `  ${c.dim("Read-only by default — mutating endpoints return 403 and the UI is locked.")}`,
    );
    console.log(
      `  ${c.dim("Re-run with --allow-edit to let trusted collaborators edit files remotely.")}`,
    );
  }
  console.log();

  const answer = await clack.confirm({ message: "Continue?" });
  if (clack.isCancel(answer)) return false;
  return answer === true;
}
