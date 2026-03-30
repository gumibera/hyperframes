import { describe, it, expect, vi } from "vitest";
import { lintHyperframeHtml, lintScriptUrls } from "./hyperframeLinter.js";

describe("lintHyperframeHtml", () => {
  const validComposition = `
<html>
<body>
  <div id="root" data-composition-id="comp-1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script src="https://cdn.gsap.com/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["comp-1"] = tl;
  </script>
</body>
</html>`;

  it("reports no errors for a valid composition", () => {
    const result = lintHyperframeHtml(validComposition);
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("reports error when root is missing data-composition-id", () => {
    const html = `
<html><body>
  <div id="root" data-width="1920" data-height="1080"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "root_missing_composition_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error when root is missing data-width or data-height", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1"></div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "root_missing_dimensions");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error when timeline registry is missing", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080"></div>
  <script>
    const tl = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "missing_timeline_registry");
    expect(finding).toBeDefined();
  });

  it("reports error for duplicate media ids", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" src="a.mp4" data-start="0" data-duration="5"></video>
    <video id="v1" src="b.mp4" data-start="0" data-duration="3"></video>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "duplicate_media_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.elementId).toBe("v1");
  });

  it("reports error for composition host missing data-composition-id", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="host1" data-composition-src="child.html"></div>
  </div>
  <script>window.__timelines = {};</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "host_missing_composition_id");
    expect(finding).toBeDefined();
  });

  it("attaches filePath to findings when option is set", () => {
    const html = "<html><body><div></div></body></html>";
    const result = lintHyperframeHtml(html, { filePath: "test.html" });
    for (const finding of result.findings) {
      expect(finding.file).toBe("test.html");
    }
  });

  it("deduplicates identical findings", () => {
    // Calling with the same HTML should not produce duplicate entries
    const html = `
<html><body>
  <div id="root"></div>
  <script>const tl = gsap.timeline();</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const codes = result.findings.map((f) => `${f.code}|${f.message}`);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });

  it("reports info for composition with external CDN script dependency", () => {
    const html = `<template id="rockets-template">
  <div data-composition-id="rockets" data-width="1920" data-height="1080">
    <div id="rocket-container"></div>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["rockets"] = gsap.timeline({ paused: true });
    </script>
  </div>
</template>`;
    const result = lintHyperframeHtml(html, { filePath: "compositions/rockets.html" });
    const finding = result.findings.find((f) => f.code === "external_script_dependency");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("info");
    expect(finding?.message).toContain("cdnjs.cloudflare.com");
    // info findings do not count as errors — ok should still be true
    expect(result.ok).toBe(true);
    expect(result.errorCount).toBe(0);
  });

  it("does not report external_script_dependency for inline scripts", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="main" data-width="1920" data-height="1080">
    <script>
      window.__timelines = {};
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </div>
</body></html>`;
    const result = lintHyperframeHtml(html);
    expect(result.findings.find((f) => f.code === "external_script_dependency")).toBeUndefined();
  });

  it("strips <template> wrapper before linting composition files", () => {
    const html = `<template id="my-comp-template">
  <div data-composition-id="my-comp" data-width="1920" data-height="1080"
       style="position:relative;width:1920px;height:1080px;">
    <div id="stage"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["my-comp"] = tl;
  </script>
</template>`;
    const result = lintHyperframeHtml(html, { filePath: "compositions/my-comp.html" });
    const missing = result.findings.filter(
      (f) => f.code === "missing-composition-id" || f.code === "missing-dimensions",
    );
    expect(missing).toHaveLength(0);
  });

  it("reports error when timeline registry is assigned without initializing", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="stage"></div>
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.to("#stage", { opacity: 1, duration: 1 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("without initializing");
  });

  it("does not flag timeline assignment when init guard is present", () => {
    const result = lintHyperframeHtml(validComposition);
    const finding = result.findings.find((f) => f.code === "timeline_registry_missing_init");
    expect(finding).toBeUndefined();
  });

  it("reports error for audio with data-start but no id", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <audio data-start="0" data-duration="10" src="narration.wav"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("SILENT");
  });

  it("reports error for video with data-start but no id", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video data-start="0" data-duration="10" src="clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_id");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("FROZEN");
  });

  it("does not flag media elements that have id", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <audio id="a1" data-start="0" data-duration="10" src="narration.wav"></audio>
    <video id="v1" data-start="0" data-duration="10" src="clip.mp4" muted playsinline></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_id");
    expect(finding).toBeUndefined();
  });

  it("reports warning for media with preload=none", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <video id="v1" data-start="0" data-duration="10" src="clip.mp4" muted playsinline preload="none"></video>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_preload_none");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
  });

  it("reports error for media with id but no src", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <audio id="a1" data-start="0" data-duration="10"></audio>
  </div>
  <script>window.__timelines = window.__timelines || {}; window.__timelines["c1"] = gsap.timeline({ paused: true });</script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "media_missing_src");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });
});

describe("lintScriptUrls", () => {
  it("reports error for script URL returning non-2xx", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://unpkg.com/@hyperframe/player@latest/dist/player.js"></script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    const finding = findings.find((f) => f.code === "inaccessible_script_url");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
    expect(finding?.message).toContain("404");

    vi.unstubAllGlobals();
  });

  it("reports error for unreachable script URL", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("AbortError"));
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://example.invalid/nonexistent.js"></script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    const finding = findings.find((f) => f.code === "inaccessible_script_url");
    expect(finding).toBeDefined();

    vi.unstubAllGlobals();
  });

  it("does not flag accessible script URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    expect(findings.length).toBe(0);

    vi.unstubAllGlobals();
  });

  it("skips inline scripts without src", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>console.log("inline")</script>
</body></html>`;
    const findings = await lintScriptUrls(html);
    expect(findings.length).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  // ── gsap_css_transform_conflict ──────────────────────────────────────────

  it("warns when tl.to animates x on an element with CSS translateX", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title" style=""></div>
  </div>
  <style>
    #title { position: absolute; top: 240px; left: 50%; transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#title", { x: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.selector).toBe("#title");
    expect(finding?.fixHint).toMatch(/fromTo/);
    expect(finding?.fixHint).toMatch(/xPercent/);
  });

  it("warns when tl.to animates scale on an element with CSS scale transform", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero"></div>
  </div>
  <style>
    #hero { transform: scale(0.8); opacity: 0; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", { opacity: 1, scale: 1, duration: 0.5 }, 1.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("warning");
    expect(finding?.selector).toBe("#hero");
  });

  it("does NOT warn when tl.to targets element without CSS transform", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="card"></div>
  </div>
  <style>
    #card { position: absolute; top: 100px; left: 100px; opacity: 0; }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#card", { x: 0, opacity: 1, duration: 0.3 }, 0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("does NOT warn when tl.fromTo targets element WITH CSS transform (author owns both ends)", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="title"></div>
  </div>
  <style>
    #title { position: absolute; left: 50%; transform: translateX(-50%); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#title", { xPercent: -50, x: -1000, opacity: 0 }, { xPercent: -50, x: 0, opacity: 1, duration: 0.4 }, 0.5);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const conflict = result.findings.find((f) => f.code === "gsap_css_transform_conflict");
    expect(conflict).toBeUndefined();
  });

  it("emits one warning when a combined CSS transform conflicts with multiple GSAP properties", () => {
    const html = `
<html><body>
  <div id="root" data-composition-id="c1" data-width="1920" data-height="1080">
    <div id="hero"></div>
  </div>
  <style>
    #hero { transform: translateX(-50%) scale(0.8); }
  </style>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    tl.to("#hero", { x: 0, scale: 1, opacity: 1, duration: 0.5 }, 1.0);
    window.__timelines["c1"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const conflicts = result.findings.filter((f) => f.code === "gsap_css_transform_conflict");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.message).toMatch(/x\/scale|scale\/x/);
  });
});

describe("template_literal_selector rule", () => {
  it("reports error when querySelector uses template literal variable", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="chart"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const compId = "main";
    const el = document.querySelector(\`[data-composition-id="\${compId}"] .chart\`);
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe("error");
  });

  it("reports error for querySelectorAll with template literal variable", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    window.__timelines = window.__timelines || {};
    const id = "main";
    document.querySelectorAll(\`[data-composition-id="\${id}"] .item\`);
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeDefined();
  });

  it("does not report error for hardcoded querySelector strings", () => {
    const html = `
<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div class="chart"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const el = document.querySelector('[data-composition-id="main"] .chart');
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const finding = result.findings.find((f) => f.code === "template_literal_selector");
    expect(finding).toBeUndefined();
  });
});
