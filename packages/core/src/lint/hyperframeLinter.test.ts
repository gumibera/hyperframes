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

  it("detects timeline ID mismatch", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div data-composition-id="intro" data-start="0" data-duration="3"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    window.__timelines["main"] = gsap.timeline({ paused: true });
    window.__timelines["intro-anim"] = gsap.timeline({ paused: true });
  </script>
</body></html>`;
    const result = lintHyperframeHtml(html);
    const mismatch = result.findings.find((f) => f.code === "timeline_id_mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch?.message).toContain("intro-anim");
  });

  it("does not flag matching timeline IDs", () => {
    const result = lintHyperframeHtml(validComposition);
    const mismatch = result.findings.find((f) => f.code === "timeline_id_mismatch");
    expect(mismatch).toBeUndefined();
  });

  it("reports error when timeline assignment has no init guard", () => {
    const html = `<html><body>
  <div data-composition-id="main" data-width="1920" data-height="1080"></div>
  <script>
    const tl = gsap.timeline({ paused: true });
    window.__timelines["main"] = tl;
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
});
