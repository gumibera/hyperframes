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
});
