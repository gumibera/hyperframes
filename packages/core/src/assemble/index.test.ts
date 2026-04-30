import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assembleScenes } from "./index";

function makeProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hyperframes-assemble-"));
  mkdirSync(join(dir, ".hyperframes", "scenes"), { recursive: true });
  writeFileSync(
    join(dir, "index.html"),
    `<div data-composition-id="demo" data-width="1920" data-height="1080">
  <div id="scene1" class="scene"><!-- SCENE 1 CONTENT --></div>
  <div id="scene2" class="scene"><!-- SCENE 2 CONTENT --></div>
  <style>
    .scene { position: absolute; inset: 0; }
    /* SCENE STYLES */
  </style>
  <script>
    const tl = gsap.timeline({ paused: true });
    // SCENE TWEENS
    window.__timelines = window.__timelines || {};
    window.__timelines.demo = tl;
  </script>
</div>`,
    "utf-8",
  );
  return dir;
}

function writeScene(dir: string, sceneNumber: number, title: string): void {
  writeFileSync(
    join(dir, ".hyperframes", "scenes", `scene${sceneNumber}.html`),
    `<!-- HTML -->
<h1 id="s${sceneNumber}-title" class="s${sceneNumber}-title">${title}</h1>
<!-- CSS -->
.s${sceneNumber}-title { color: white; }
<!-- GSAP -->
var S${sceneNumber} = ${sceneNumber === 1 ? 0 : 4};
tl.set(".s${sceneNumber}-title", { opacity: 0 }, 0);
tl.to(".s${sceneNumber}-title", { opacity: 1, duration: 0.3, ease: "power2.out" }, S${sceneNumber});`,
    "utf-8",
  );
}

describe("assembleScenes", () => {
  it("injects scene HTML, CSS, and GSAP into scaffold markers", () => {
    const dir = makeProject();
    writeScene(dir, 1, "One");
    writeScene(dir, 2, "Two");

    const result = assembleScenes(dir);

    expect(result.ok).toBe(true);
    expect(result.scenes).toBe(2);
    const assembled = readFileSync(join(dir, "index.html"), "utf-8");
    expect(assembled).toContain("<!-- SCENE 1 CONTENT -->");
    expect(assembled).toContain('<h1 id="s1-title" class="s1-title">One</h1>');
    expect(assembled).toContain(".s2-title { color: white; }");
    expect(assembled).toContain('tl.to(".s2-title"');
  });

  it("can re-run assembly without duplicating generated scene blocks", () => {
    const dir = makeProject();
    writeScene(dir, 1, "One");
    writeScene(dir, 2, "Two");

    expect(assembleScenes(dir).ok).toBe(true);
    writeScene(dir, 1, "Updated");
    expect(assembleScenes(dir).ok).toBe(true);

    const assembled = readFileSync(join(dir, "index.html"), "utf-8");
    expect(assembled).toContain('<h1 id="s1-title" class="s1-title">Updated</h1>');
    expect(assembled).not.toContain('<h1 id="s1-title" class="s1-title">One</h1>');
    expect(assembled.match(/HYPERFRAMES GENERATED SCENE 1 HTML START/g)).toHaveLength(1);
    expect(assembled.match(/HYPERFRAMES GENERATED SCENE STYLES START/g)).toHaveLength(1);
    expect(assembled.match(/HYPERFRAMES GENERATED SCENE TWEENS START/g)).toHaveLength(1);
  });

  it("finds scene slots with extra classes and reordered attributes", () => {
    const dir = makeProject();
    writeFileSync(
      join(dir, "index.html"),
      `<div data-composition-id="demo" data-width="1920" data-height="1080">
  <div class="scene scene--intro" data-region="hero" id="scene1"><!-- SCENE 1 CONTENT --></div>
  <div data-region="details" class="scene scene--details" id="scene2"><!-- SCENE 2 CONTENT --></div>
  <style>
    .scene { position: absolute; inset: 0; }
    /* SCENE STYLES */
  </style>
  <script>
    const tl = gsap.timeline({ paused: true });
    // SCENE TWEENS
    window.__timelines = window.__timelines || {};
    window.__timelines.demo = tl;
  </script>
</div>`,
      "utf-8",
    );
    writeScene(dir, 1, "One");
    writeScene(dir, 2, "Two");

    const result = assembleScenes(dir);

    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, "index.html"), "utf-8")).toContain(
      '<h1 id="s2-title" class="s2-title">Two</h1>',
    );
  });

  it("rejects standalone scene documents", () => {
    const dir = makeProject();
    writeFileSync(
      join(dir, ".hyperframes", "scenes", "scene1.html"),
      `<!doctype html>
<!-- HTML -->
<h1>Broken</h1>
<!-- CSS -->
h1 { color: white; }
<!-- GSAP -->
var S1 = 0;`,
      "utf-8",
    );
    writeFileSync(
      join(dir, ".hyperframes", "scenes", "scene2.html"),
      `<!-- HTML -->
<h1>Two</h1>
<!-- CSS -->
h1 { color: white; }
<!-- GSAP -->
var S2 = 4;`,
      "utf-8",
    );

    const result = assembleScenes(dir, { dryRun: true });

    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.message.includes("DOCTYPE"))).toBe(true);
  });

  it("rejects scene fragment contract violations", () => {
    const dir = makeProject();
    writeFileSync(
      join(dir, ".hyperframes", "scenes", "scene1.html"),
      `<!-- HTML -->
<div id="hero" class="heading">Broken</div>
<!-- CSS -->
body { margin: 0; }
.heading { transform: translate(-50%, -50%); }
#scene1 { opacity: 1; }
<!-- GSAP -->
tl.set(".heading", { opacity: 0 });
tl.to(".heading", { opacity: 1, repeat: -1 }, 0);`,
      "utf-8",
    );
    writeScene(dir, 2, "Two");

    const result = assembleScenes(dir, { dryRun: true });
    const messages = result.errors.map((error) => error.message).join("\n");

    expect(result.ok).toBe(false);
    expect(messages).toContain('HTML id "hero" must use "s1-" prefix');
    expect(messages).toContain("CSS must not style body");
    expect(messages).toContain("CSS must not set opacity on #scene1");
    expect(messages).toContain('GSAP section must define "var S1 = <start_time>;"');
    expect(messages).toContain('GSAP repeat value "-1" must be a finite non-negative number');
    expect(messages).toContain("tl.set() calls must use time 0");
    expect(messages).toContain("tl.to() calls must use S1");
  });

  it("rejects direct gsap tween creators in scene fragments", () => {
    const dir = makeProject();
    writeFileSync(
      join(dir, ".hyperframes", "scenes", "scene1.html"),
      `<!-- HTML -->
<h1 id="s1-title" class="s1-title">Broken</h1>
<!-- CSS -->
.s1-title { color: white; }
<!-- GSAP -->
var S1 = 0;
gsap.from(".s1-title", { opacity: 0, duration: 0.3 });`,
      "utf-8",
    );
    writeScene(dir, 2, "Two");

    const result = assembleScenes(dir, { dryRun: true });
    const messages = result.errors.map((error) => error.message).join("\n");

    expect(result.ok).toBe(false);
    expect(messages).toContain("gsap.from(); use tl.set() and tl.to() instead");
  });
});
