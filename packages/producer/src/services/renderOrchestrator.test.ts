import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import type { ElementStackingInfo, EngineConfig } from "@hyperframes/engine";
import type { CompiledComposition } from "./htmlCompiler.js";

import {
  applyRenderModeHints,
  blitHdrVideoLayer,
  extractStandaloneEntryFromIndex,
  writeCompiledArtifacts,
} from "./renderOrchestrator.js";
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

describe("writeCompiledArtifacts — external assets on Windows drive-letter paths (GH #321)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    while (tempDirs.length > 0) {
      const d = tempDirs.pop();
      if (d) {
        try {
          rmSync(d, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
  });

  function makeWorkDir(): string {
    const d = mkdtempSync(join(tmpdir(), "hf-orch-"));
    tempDirs.push(d);
    return d;
  }

  it("copies an external asset with a Windows-style drive-letter key into compileDir", () => {
    const workDir = makeWorkDir();
    const sourceDir = mkdtempSync(join(tmpdir(), "hf-src-"));
    tempDirs.push(sourceDir);
    const srcFile = join(sourceDir, "segment.wav");
    writeFileSync(srcFile, "fake wav bytes");

    const windowsStyleInput = "D:\\coder\\assets\\segment.wav";
    const key = toExternalAssetKey(windowsStyleInput);
    expect(key).toBe("hf-ext/D/coder/assets/segment.wav");

    const externalAssets = new Map<string, string>([[key, srcFile]]);
    const compiled = {
      html: "<!doctype html><html><body></body></html>",
      subCompositions: new Map<string, string>(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets,
      width: 1920,
      height: 1080,
      staticDuration: 10,
      renderModeHints: {
        recommendScreenshot: false,
        reasons: [],
      },
    };

    writeCompiledArtifacts(compiled, workDir, false);

    const landed = join(workDir, "compiled", key);
    expect(existsSync(landed)).toBe(true);
    expect(readFileSync(landed, "utf-8")).toBe("fake wav bytes");
  });

  it("rejects a maliciously crafted key that tries to escape compileDir", () => {
    const workDir = makeWorkDir();
    const sourceDir = mkdtempSync(join(tmpdir(), "hf-src-"));
    tempDirs.push(sourceDir);
    const srcFile = join(sourceDir, "evil.wav");
    writeFileSync(srcFile, "should never be copied");

    const externalAssets = new Map<string, string>([["hf-ext/../../etc/passwd", srcFile]]);
    const compiled = {
      html: "<!doctype html>",
      subCompositions: new Map<string, string>(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets,
      width: 1920,
      height: 1080,
      staticDuration: 10,
      renderModeHints: {
        recommendScreenshot: false,
        reasons: [],
      },
    };

    writeCompiledArtifacts(compiled, workDir, false);

    const escapeTarget = join(workDir, "..", "..", "etc", "passwd");
    expect(existsSync(escapeTarget)).toBe(false);
  });
});

describe("applyRenderModeHints", () => {
  function createCompiledComposition(
    reasonCodes: Array<"iframe" | "requestAnimationFrame">,
  ): CompiledComposition {
    return {
      html: "<html></html>",
      subCompositions: new Map(),
      videos: [],
      audios: [],
      unresolvedCompositions: [],
      externalAssets: new Map(),
      width: 1920,
      height: 1080,
      staticDuration: 5,
      renderModeHints: {
        recommendScreenshot: reasonCodes.length > 0,
        reasons: reasonCodes.map((code) => ({
          code,
          message: `reason: ${code}`,
        })),
      },
    };
  }

  function createConfig(): EngineConfig {
    return {
      fps: 30,
      quality: "standard",
      format: "jpeg",
      jpegQuality: 80,
      concurrency: "auto",
      coresPerWorker: 2.5,
      minParallelFrames: 120,
      largeRenderThreshold: 1000,
      disableGpu: false,
      enableBrowserPool: false,
      browserTimeout: 120000,
      protocolTimeout: 300000,
      forceScreenshot: false,
      enableChunkedEncode: false,
      chunkSizeFrames: 360,
      enableStreamingEncode: false,
      ffmpegEncodeTimeout: 600000,
      ffmpegProcessTimeout: 300000,
      ffmpegStreamingTimeout: 600000,
      audioGain: 1.35,
      frameDataUriCacheLimit: 256,
      playerReadyTimeout: 45000,
      renderReadyTimeout: 15000,
      verifyRuntime: true,
      debug: false,
    };
  }

  it("forces screenshot mode when compatibility hints recommend it", () => {
    const cfg = createConfig();
    const compiled = createCompiledComposition(["iframe", "requestAnimationFrame"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    applyRenderModeHints(cfg, compiled, log);

    expect(cfg.forceScreenshot).toBe(true);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("does nothing when screenshot mode is already forced", () => {
    const cfg = createConfig();
    cfg.forceScreenshot = true;
    const compiled = createCompiledComposition(["iframe"]);
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };

    applyRenderModeHints(cfg, compiled, log);

    expect(log.warn).not.toHaveBeenCalled();
  });
});

describe("blitHdrVideoLayer", () => {
  // Inline 16-bit PNG helpers (mirrors makePng16 / makeChunk in
  // packages/engine alphaBlit.test.ts). We tag each frame's first pixel R
  // channel with its 1-based index so we can identify which frame the blit
  // selected by reading canvas.readUInt16LE(0).
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
    return table;
  })();
  function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function uint32BE(n: number): Buffer {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(n >>> 0, 0);
    return b;
  }
  function makeChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, "ascii");
    const crc = crc32(Buffer.concat([typeBuf, data]));
    return Buffer.concat([uint32BE(data.length), typeBuf, data, uint32BE(crc)]);
  }
  /** Produces a width×height PNG with bit depth 16, color type 2 (RGB). */
  function makePng16(width: number, height: number, fillR: number): Buffer {
    const ihdr = Buffer.concat([uint32BE(width), uint32BE(height), Buffer.from([16, 2, 0, 0, 0])]);
    const rowBytes = width * 6;
    const raw = Buffer.alloc((rowBytes + 1) * height);
    for (let y = 0; y < height; y++) {
      raw[y * (rowBytes + 1)] = 0;
      for (let x = 0; x < width; x++) {
        const off = y * (rowBytes + 1) + 1 + x * 6;
        raw.writeUInt16BE(fillR, off);
        raw.writeUInt16BE(0, off + 2);
        raw.writeUInt16BE(0, off + 4);
      }
    }
    return Buffer.concat([
      PNG_SIG,
      makeChunk("IHDR", ihdr),
      makeChunk("IDAT", deflateSync(raw)),
      makeChunk("IEND", Buffer.alloc(0)),
    ]);
  }

  function writeFrameSet(dir: string, count: number): void {
    for (let i = 1; i <= count; i++) {
      const png = makePng16(8, 8, i);
      writeFileSync(join(dir, `frame_${String(i).padStart(4, "0")}.png`), png);
    }
  }

  function makeElement(overrides: Partial<ElementStackingInfo> = {}): ElementStackingInfo {
    return {
      id: "v1",
      zIndex: 0,
      x: 0,
      y: 0,
      width: 8,
      height: 8,
      layoutWidth: 8,
      layoutHeight: 8,
      opacity: 1,
      visible: true,
      isHdr: true,
      transform: "none",
      borderRadius: [0, 0, 0, 0],
      ...overrides,
    };
  }

  let workDir: string;
  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "hdr-blit-"));
    writeFrameSet(workDir, 5);
  });
  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true });
  });

  it("returns without modifying canvas when element is not in frame-dir map", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    blitHdrVideoLayer(canvas, el, 0, 30, new Map(), new Map(), 8, 8);
    expect(canvas.every((b) => b === 0)).toBe(true);
  });

  it("returns without modifying canvas when computed frame index is < 1", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    blitHdrVideoLayer(canvas, el, -0.5, 30, new Map([["v1", workDir]]), new Map([["v1", 0]]), 8, 8);
    expect(canvas.every((b) => b === 0)).toBe(true);
  });

  it("blits frame 1 at time = startTime", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    blitHdrVideoLayer(canvas, el, 0, 30, new Map([["v1", workDir]]), new Map([["v1", 0]]), 8, 8);
    expect(canvas.readUInt16LE(0)).toBe(1);
  });

  it("computes frame index as round((time - startTime) * fps) + 1", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    blitHdrVideoLayer(
      canvas,
      el,
      2 / 30,
      30,
      new Map([["v1", workDir]]),
      new Map([["v1", 0]]),
      8,
      8,
    );
    expect(canvas.readUInt16LE(0)).toBe(3);
  });

  it("freezes on the last available frame when time outlives the clip", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    blitHdrVideoLayer(
      canvas,
      el,
      10, // 10s @ 30fps would request frame 301; we have 5 → clamp to 5
      30,
      new Map([["v1", workDir]]),
      new Map([["v1", 0]]),
      8,
      8,
    );
    expect(canvas.readUInt16LE(0)).toBe(5);
  });

  it("respects startTime offset", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    blitHdrVideoLayer(
      canvas,
      el,
      4 / 30, // time
      30,
      new Map([["v1", workDir]]),
      new Map([["v1", 2 / 30]]), // startTime → effective video frame index = 4-2+1 = 3
      8,
      8,
    );
    expect(canvas.readUInt16LE(0)).toBe(3);
  });

  it("uses region blit (placement at el.x,el.y) when transform is 'none'", () => {
    const canvas = Buffer.alloc(16 * 16 * 6);
    const el = makeElement({ x: 4, y: 0, width: 8, height: 8 });
    blitHdrVideoLayer(canvas, el, 0, 30, new Map([["v1", workDir]]), new Map([["v1", 0]]), 16, 16);
    // (0,0) untouched, (4,0) is frame-1 R channel
    expect(canvas.readUInt16LE(0)).toBe(0);
    expect(canvas.readUInt16LE((0 * 16 + 4) * 6)).toBe(1);
  });

  it("uses affine blit when transform parses to a matrix", () => {
    const canvas = Buffer.alloc(16 * 16 * 6);
    // matrix(a,b,c,d,e,f) — translate(4,0)
    const el = makeElement({
      x: 0,
      y: 0,
      transform: "matrix(1, 0, 0, 1, 4, 0)",
    });
    blitHdrVideoLayer(canvas, el, 0, 30, new Map([["v1", workDir]]), new Map([["v1", 0]]), 16, 16);
    expect(canvas.readUInt16LE(0)).toBe(0);
    expect(canvas.readUInt16LE((0 * 16 + 4) * 6)).toBe(1);
  });

  it("does not throw when target frame file does not exist", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    rmSync(join(workDir, "frame_0001.png"));
    expect(() =>
      blitHdrVideoLayer(canvas, el, 0, 30, new Map([["v1", workDir]]), new Map([["v1", 0]]), 8, 8),
    ).not.toThrow();
    expect(canvas.every((b) => b === 0)).toBe(true);
  });

  it("logs decode errors via the supplied logger and does not throw", () => {
    const canvas = Buffer.alloc(8 * 8 * 6);
    const el = makeElement();
    // Replace frame_0001.png with garbage so decodePngToRgb48le throws.
    writeFileSync(join(workDir, "frame_0001.png"), Buffer.from("not a png"));
    const log = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    };
    expect(() =>
      blitHdrVideoLayer(
        canvas,
        el,
        0,
        30,
        new Map([["v1", workDir]]),
        new Map([["v1", 0]]),
        8,
        8,
        log,
      ),
    ).not.toThrow();
    expect(log.warn).toHaveBeenCalledOnce();
    const call = log.warn.mock.calls[0]!;
    expect(call[0]).toContain("HDR blit failed for v1");
  });
});
