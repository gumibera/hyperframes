import { describe, expect, it } from "vitest";
import { extractStandaloneEntryFromIndex } from "./renderOrchestrator.js";

describe("extractStandaloneEntryFromIndex", () => {
  it("reuses the index wrapper and keeps only the requested composition host", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>body { background: #111; }</style>
</head>
<body>
  <div id="main" data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html" data-start="5"></div>
    <div id="outro" data-composition-id="outro" data-composition-src="compositions/outro.html" data-start="12"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toContain('data-composition-id="root"');
    expect(extracted).toContain('id="outro"');
    expect(extracted).toContain('data-composition-src="compositions/outro.html"');
    expect(extracted).toContain('data-start="0"');
    expect(extracted).not.toContain('id="intro"');
    expect(extracted).toContain("<style>body { background: #111; }</style>");
  });

  it("matches normalized data-composition-src paths", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="./compositions/intro.html" data-start="3"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/intro.html");

    expect(extracted).not.toBeNull();
    expect(extracted).toContain('data-start="0"');
    expect(extracted).toContain('data-composition-src="./compositions/intro.html"');
  });

  it("returns null when index.html does not mount the requested entry file", () => {
    const indexHtml = `<!DOCTYPE html>
<html>
<body>
  <div data-composition-id="root" data-width="1920" data-height="1080">
    <div id="intro" data-composition-id="intro" data-composition-src="compositions/intro.html"></div>
  </div>
</body>
</html>`;

    const extracted = extractStandaloneEntryFromIndex(indexHtml, "compositions/outro.html");

    expect(extracted).toBeNull();
  });
});
