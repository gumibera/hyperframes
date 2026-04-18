import { describe, expect, it } from "vitest";
import { Hono } from "hono";

import { generateToken, secureFetch } from "./publishSecurity.js";

function makeGuarded(token: string, allowEdit: boolean) {
  // Representative routes so the guard has realistic surface to defend.
  const app = new Hono();
  app.get("/api/projects/:id/files/*", (c) => c.json({ ok: true, kind: "read" }));
  app.put("/api/projects/:id/files/*", (c) => c.json({ ok: true, kind: "write" }));
  app.post("/api/projects/:id/files/*", (c) => c.json({ ok: true, kind: "create" }));
  app.delete("/api/projects/:id/files/*", (c) => c.json({ ok: true, kind: "delete" }));
  app.patch("/api/projects/:id/files/*", (c) => c.json({ ok: true, kind: "rename" }));
  app.post("/api/projects/:id/duplicate-file", (c) => c.json({ ok: true, kind: "dup" }));
  app.post("/api/projects/:id/render", (c) => c.json({ ok: true, kind: "render" }));
  app.get("/", (c) =>
    c.html("<!doctype html><html><head><title>studio</title></head><body>root</body></html>"),
  );
  // The bundled composition HTML served inside the player iframe. Must
  // NOT get the banner injected — that caused a double-banner bug and
  // pushed the composition layout around.
  app.get("/api/projects/:id/bundle", (c) =>
    c.html("<!doctype html><html><head><title>comp</title></head><body>comp</body></html>"),
  );
  app.get("/api/meta", (c) => c.json({ version: 1 }));

  const guarded = secureFetch(app.fetch.bind(app), { token, allowEdit });
  const hit = (path: string, init?: RequestInit): Promise<Response> =>
    guarded(new Request("http://localhost" + path, init));
  return { hit };
}

describe("generateToken", () => {
  it("produces distinct 32-byte base64url strings", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a.length).toBe(43);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("secureFetch — token gate", () => {
  it("404s a request with neither cookie nor matching query token", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/");
    expect(res.status).toBe(404);
  });

  it("404s a request with a wrong query token", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/?t=wrong");
    expect(res.status).toBe(404);
  });

  it("redirects the first-visit request and sets a session cookie", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/?t=secret");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^hf_publish_session=secret/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("strips the token from the redirect target — it never lands in browser history", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/?t=secret&foo=bar");
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("t=secret");
    expect(location).toContain("foo=bar");
  });

  it("lets through an API request carrying the cookie", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/meta", { headers: { cookie: "hf_publish_session=secret" } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
  });

  it("404s a request whose cookie has the wrong value", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/", { headers: { cookie: "hf_publish_session=wrong" } });
    expect(res.status).toBe(404);
  });

  it("is constant-time-safe against length-prefix attacks", async () => {
    const { hit } = makeGuarded("a".repeat(43), false);
    const short = await hit("/?t=aaa");
    const long = await hit("/?t=" + "a".repeat(80));
    expect(short.status).toBe(404);
    expect(long.status).toBe(404);
  });
});

describe("secureFetch — mutation gate (read-only)", () => {
  const authed = { cookie: "hf_publish_session=secret" } as Record<string, string>;

  it("allows GET on files — reading is fine in read-only mode", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/files/index.html", { headers: authed });
    expect(res.status).toBe(200);
  });

  it("blocks PUT on files", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/files/index.html", { method: "PUT", headers: authed });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("forbidden");
  });

  it("blocks POST on files (create)", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/files/new.html", { method: "POST", headers: authed });
    expect(res.status).toBe(403);
  });

  it("blocks DELETE on files", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/files/index.html", {
      method: "DELETE",
      headers: authed,
    });
    expect(res.status).toBe(403);
  });

  it("blocks PATCH on files (rename)", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/files/index.html", {
      method: "PATCH",
      headers: authed,
    });
    expect(res.status).toBe(403);
  });

  it("blocks POST /duplicate-file", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/duplicate-file", { method: "POST", headers: authed });
    expect(res.status).toBe(403);
  });

  it("blocks POST /render", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/render", { method: "POST", headers: authed });
    expect(res.status).toBe(403);
  });
});

describe("secureFetch — mutation gate (--allow-edit)", () => {
  const authed = { cookie: "hf_publish_session=secret" } as Record<string, string>;

  it("allows PUT on files when allowEdit is true", async () => {
    const { hit } = makeGuarded("secret", true);
    const res = await hit("/api/projects/foo/files/index.html", { method: "PUT", headers: authed });
    expect(res.status).toBe(200);
  });

  it("still requires the token even with allowEdit", async () => {
    const { hit } = makeGuarded("secret", true);
    const res = await hit("/api/projects/foo/files/index.html", { method: "PUT" });
    expect(res.status).toBe(404);
  });
});

describe("secureFetch — read-only UI enforcement", () => {
  const authed = { cookie: "hf_publish_session=secret" } as Record<string, string>;

  it("sets X-HF-Publish-Readonly on every response in read-only mode", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/meta", { headers: authed });
    expect(res.headers.get("x-hf-publish-readonly")).toBe("1");
  });

  it("does NOT set the readonly header when --allow-edit is on", async () => {
    const { hit } = makeGuarded("secret", true);
    const res = await hit("/api/meta", { headers: authed });
    expect(res.headers.get("x-hf-publish-readonly")).toBeNull();
  });

  it("injects the read-only banner + script into HTML responses in read-only mode", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/", { headers: authed });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("hf-publish-readonly-style");
    expect(body).toContain("hf-publish-readonly-banner");
    expect(body).toContain("__HF_PUBLISH_READONLY__");
    // Body must still be well-formed HTML with our content.
    expect(body).toMatch(/<\/head>/);
    expect(body).toMatch(/root/);
  });

  it("does NOT inject anything when --allow-edit is on", async () => {
    const { hit } = makeGuarded("secret", true);
    const res = await hit("/", { headers: authed });
    const body = await res.text();
    expect(body).not.toContain("hf-publish-readonly-style");
    expect(body).not.toContain("__HF_PUBLISH_READONLY__");
  });

  it("does NOT rewrite non-HTML responses", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/meta", { headers: authed });
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.text();
    expect(body).not.toContain("hf-publish-readonly-style");
    expect(JSON.parse(body).version).toBe(1);
  });

  it("does NOT inject into HTML served under /api/* (composition bundle in the player iframe)", async () => {
    const { hit } = makeGuarded("secret", false);
    const res = await hit("/api/projects/foo/bundle", { headers: authed });
    expect(res.status).toBe(200);
    // Header still ships so clients can detect the mode.
    expect(res.headers.get("x-hf-publish-readonly")).toBe("1");
    // But the body must be untouched — no banner inside the iframe.
    const body = await res.text();
    expect(body).not.toContain("hf-publish-readonly-style");
    expect(body).not.toContain("__HF_PUBLISH_READONLY__");
    expect(body).toContain("<title>comp</title>");
  });
});
