import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { copyExternalAssets, extractStandaloneEntryFromIndex } from "./renderOrchestrator.js";
import { toExternalAssetKey } from "../utils/paths.js";

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

describe("copyExternalAssets (GH #321)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) rmSync(d, { recursive: true, force: true });
    }
  });

  function mkTemp(prefix: string): string {
    const d = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(d);
    return d;
  }

  it("copies a Windows-style drive-letter external asset to a safe path inside compileDir", () => {
    const compileDir = mkTemp("hf-compile-");
    const sourceDir = mkTemp("hf-src-");
    const srcFile = join(sourceDir, "segment.wav");
    writeFileSync(srcFile, "fake wav");

    const key = toExternalAssetKey("D:\\coder\\assets\\segment.wav");
    copyExternalAssets(new Map([[key, srcFile]]), compileDir);

    const landed = join(compileDir, key);
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, "utf-8")).toBe("fake wav");
  });

  it("rejects keys that would escape compileDir via ..", () => {
    const compileDir = mkTemp("hf-compile-");
    const sourceDir = mkTemp("hf-src-");
    const srcFile = join(sourceDir, "evil.wav");
    writeFileSync(srcFile, "should not copy");

    copyExternalAssets(new Map([["hf-ext/../../escaped.wav", srcFile]]), compileDir);

    expect(existsSync(join(compileDir, "..", "..", "escaped.wav"))).toBe(false);
  });
});
