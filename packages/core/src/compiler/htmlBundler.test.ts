// @vitest-environment node
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { bundleToSingleHtml } from "./htmlBundler";

function makeTempProject(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-bundler-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return dir;
}

describe("bundleToSingleHtml", () => {
  it("hoists external CDN scripts from sub-compositions into the bundle", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="rockets-host"
      data-composition-id="rockets"
      data-composition-src="compositions/rockets.html"
      data-start="0" data-duration="2"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/rockets.html": `<template id="rockets-template">
  <div data-composition-id="rockets" data-width="1920" data-height="1080">
    <div id="rocket-container"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      const anim = lottie.loadAnimation({ container: document.querySelector("#rocket-container"), path: "rocket.json" });
      window.__timelines["rockets"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Lottie CDN script from sub-composition must be present in the bundle
    expect(bundled).toContain(
      "https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js",
    );

    // Should only appear once (deduped)
    const occurrences = (bundled.match(/cdnjs\.cloudflare\.com\/ajax\/libs\/lottie-web/g) ?? [])
      .length;
    expect(occurrences).toBe(1);

    // GSAP CDN from main doc should still be present
    expect(bundled).toContain("cdn.jsdelivr.net/npm/gsap");

    // data-composition-src should be stripped (composition was inlined)
    expect(bundled).not.toContain("data-composition-src");
  });

  it("does not duplicate CDN scripts already present in the main document", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="child-host"
      data-composition-id="child"
      data-composition-src="compositions/child.html"
      data-start="0" data-duration="5"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/child.html": `<template id="child-template">
  <div data-composition-id="child" data-width="1920" data-height="1080">
    <div id="stage"></div>
    <!-- Same GSAP CDN as parent — should not be duplicated -->
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["child"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // GSAP CDN should appear exactly once (deduped)
    const gsapOccurrences = (
      bundled.match(/cdn\.jsdelivr\.net\/npm\/gsap@3\.14\.2\/dist\/gsap\.min\.js/g) ?? []
    ).length;
    expect(gsapOccurrences).toBe(1);
  });

  it("inlines <template> compositions into matching empty host elements", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <template id="logo-reveal-template">
    <div data-composition-id="logo-reveal" data-width="1920" data-height="1080">
      <style>.logo { opacity: 0; }</style>
      <div class="logo">Logo Here</div>
      <script>
        window.__timelines = window.__timelines || {};
        window.__timelines["logo-reveal"] = gsap.timeline({ paused: true });
      </script>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="logo-host"
      data-composition-id="logo-reveal"
      data-start="0" data-duration="5"
      data-track-index="1"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Template element should be removed
    expect(bundled).not.toContain("<template");

    // Host should contain the template content (the logo div)
    expect(bundled).toContain("Logo Here");

    // Styles from template should be hoisted
    expect(bundled).toContain(".logo");

    // Scripts from template should be included
    expect(bundled).toContain('window.__timelines["logo-reveal"]');
  });

  it("does not inline template when host already has content", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <template id="comp-template">
    <div data-composition-id="comp" data-width="800" data-height="600">
      <p>Template content</p>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div data-composition-id="comp" data-start="0" data-duration="5">
      <span>Already filled</span>
    </div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Existing content should be preserved
    expect(bundled).toContain("Already filled");

    // Template content should NOT replace the existing host content
    // (template element may still exist in the output since it was not consumed)
    const hostMatch = bundled.match(
      /data-composition-id="comp"[^>]*data-start="0"[^>]*>([\s\S]*?)<\/div>/,
    );
    expect(hostMatch).toBeTruthy();
    expect(hostMatch![1]).toContain("Already filled");
    expect(hostMatch![1]).not.toContain("Template content");
  });

  it("copies dimension attributes from inline template to host", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <template id="sized-template">
    <div data-composition-id="sized" data-width="800" data-height="600">
      <p>Sized content</p>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div data-composition-id="sized" data-start="0" data-duration="3"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // The host should have dimensions copied from the template inner root
    expect(bundled).toContain('data-width="800"');
    expect(bundled).toContain('data-height="600"');
    expect(bundled).toContain("Sized content");
  });

  it("rewrites CSS url(...) asset paths from sub-compositions when styles are hoisted", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div
      data-composition-id="hero"
      data-composition-src="compositions/hero.html"
      data-start="0"
      data-duration="2"></div>
  </div>
  <script>window.__timelines={};</script>
</body></html>`,
      "compositions/hero.html": `<template id="hero-template">
  <div data-composition-id="hero" data-width="1920" data-height="1080">
    <style>
      @font-face {
        font-family: "Brand Sans";
        src: url("../fonts/brand.woff2") format("woff2");
      }
    </style>
    <p>Hello</p>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain('url("fonts/brand.woff2")');
    expect(bundled).not.toContain('url("../fonts/brand.woff2")');
  });

  it("interpolates {{key}} placeholders in sub-compositions using data-props", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
</head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="card1"
      data-composition-id="card1"
      data-composition-src="compositions/card.html"
      data-props='{"title":"Pro Plan","price":"$19/mo","featured":true}'
      data-start="0" data-duration="5" data-track-index="0" class="clip"></div>
    <div id="card2"
      data-composition-id="card2"
      data-composition-src="compositions/card.html"
      data-props='{"title":"Enterprise","price":"$49/mo","featured":false}'
      data-start="5" data-duration="5" data-track-index="0" class="clip"></div>
  </div>
  <script>window.__timelines={}; const tl=gsap.timeline({paused:true}); window.__timelines["main"]=tl;</script>
</body></html>`,
      "compositions/card.html": `<template id="card1-template">
  <div data-composition-id="card1" data-width="1920" data-height="1080">
    <h2 class="card-title">{{title}}</h2>
    <p class="card-price">{{price}}</p>
    <span class="badge">Featured: {{featured}}</span>
    <script>
      window.__timelines = window.__timelines || {};
      const cardTl = gsap.timeline({ paused: true });
      window.__timelines["card1"] = cardTl;
    </script>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // Card 1 should have interpolated values
    expect(bundled).toContain("Pro Plan");
    expect(bundled).toContain("$19/mo");

    // Card 2 should have its own interpolated values
    expect(bundled).toContain("Enterprise");
    expect(bundled).toContain("$49/mo");

    // No raw mustache placeholders should remain for resolved keys
    expect(bundled).not.toContain("{{title}}");
    expect(bundled).not.toContain("{{price}}");
  });

  it("interpolates {{key}} in inline template compositions", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <template id="badge-template">
    <div data-composition-id="badge" data-width="1920" data-height="1080">
      <span class="label">{{label}}</span>
      <style>.label { color: {{color}}; }</style>
    </div>
  </template>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div data-composition-id="badge"
      data-props='{"label":"BEST VALUE","color":"#ff0000"}'
      data-start="0" data-duration="5" data-track-index="0" class="clip"></div>
  </div>
</body></html>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    expect(bundled).toContain("BEST VALUE");
    expect(bundled).toContain("#ff0000");
    expect(bundled).not.toContain("{{label}}");
    expect(bundled).not.toContain("{{color}}");
  });

  it("HTML-escapes interpolated values to prevent XSS", async () => {
    const dir = makeTempProject({
      "index.html": `<!doctype html>
<html><head></head><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <div id="xss-test"
      data-composition-id="xss-test"
      data-composition-src="compositions/unsafe.html"
      data-props='{"name":"<script>alert(1)</script>"}'
      data-start="0" data-duration="5" data-track-index="0" class="clip"></div>
  </div>
</body></html>`,
      "compositions/unsafe.html": `<template id="xss-test-template">
  <div data-composition-id="xss-test" data-width="1920" data-height="1080">
    <p>Hello, {{name}}</p>
  </div>
</template>`,
    });

    const bundled = await bundleToSingleHtml(dir);

    // The interpolated content inside <p> should be escaped
    expect(bundled).toContain("Hello, &lt;script&gt;alert(1)&lt;/script&gt;");
    // The raw script tag should NOT appear as actual HTML content (only in the JSON attribute)
    expect(bundled).not.toContain("<p>Hello, <script>alert(1)</script></p>");
  });
});
