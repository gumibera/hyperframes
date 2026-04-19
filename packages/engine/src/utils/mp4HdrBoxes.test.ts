import { copyFileSync, existsSync, readFileSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_HDR10_MASTERING } from "./hdr.js";
import {
  buildClliBox,
  buildMdcvBox,
  findBox,
  injectHdrBoxes,
  injectHdrBoxesInBuffer,
  parseMasteringDisplayString,
  parseMaxCllString,
  shiftChunkOffsetsAfter,
} from "./mp4HdrBoxes.js";

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

describe("parseMasteringDisplayString", () => {
  it("parses the canonical HDR10 P3-D65 string", () => {
    const parsed = parseMasteringDisplayString(
      "G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)",
    );
    expect(parsed).toEqual({
      greenX: 13250,
      greenY: 34500,
      blueX: 7500,
      blueY: 3000,
      redX: 34000,
      redY: 16000,
      whitePointX: 15635,
      whitePointY: 16450,
      maxLuminance: 10000000,
      minLuminance: 1,
    });
  });

  it("parses BT.2020 primaries (full color volume)", () => {
    const parsed = parseMasteringDisplayString(
      "G(8500,39850)B(6550,2300)R(35400,14600)WP(15635,16450)L(40000000,50)",
    );
    expect(parsed.greenX).toBe(8500);
    expect(parsed.maxLuminance).toBe(40000000);
    expect(parsed.minLuminance).toBe(50);
  });

  it("throws on a malformed string", () => {
    expect(() => parseMasteringDisplayString("not a real string")).toThrow(
      /Invalid mastering-display string/,
    );
  });

  it("throws when a coordinate is missing", () => {
    expect(() =>
      parseMasteringDisplayString("G(13250)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)"),
    ).toThrow(/Invalid mastering-display string/);
  });
});

describe("parseMaxCllString", () => {
  it("parses MaxCLL,MaxFALL", () => {
    expect(parseMaxCllString("1000,400")).toEqual({ maxCll: 1000, maxFall: 400 });
  });

  it("parses zeros", () => {
    expect(parseMaxCllString("0,0")).toEqual({ maxCll: 0, maxFall: 0 });
  });

  it("throws on missing comma", () => {
    expect(() => parseMaxCllString("1000")).toThrow(/Invalid max-cll string/);
  });

  it("throws on non-numeric values", () => {
    expect(() => parseMaxCllString("foo,bar")).toThrow(/non-numeric values/);
  });
});

// ---------------------------------------------------------------------------
// Box builders — validate exact byte layout against ISO/IEC 23001-8
// ---------------------------------------------------------------------------

describe("buildMdcvBox", () => {
  it("emits a 32-byte box with G/B/R primary order (NOT R/G/B)", () => {
    const box = buildMdcvBox({
      greenX: 13250,
      greenY: 34500,
      blueX: 7500,
      blueY: 3000,
      redX: 34000,
      redY: 16000,
      whitePointX: 15635,
      whitePointY: 16450,
      maxLuminance: 10000000,
      minLuminance: 1,
    });

    expect(box.length).toBe(32);
    expect(box.readUInt32BE(0)).toBe(32);
    expect(box.toString("ascii", 4, 8)).toBe("mdcv");

    expect(box.readUInt16BE(8)).toBe(13250);
    expect(box.readUInt16BE(10)).toBe(34500);

    expect(box.readUInt16BE(12)).toBe(7500);
    expect(box.readUInt16BE(14)).toBe(3000);

    expect(box.readUInt16BE(16)).toBe(34000);
    expect(box.readUInt16BE(18)).toBe(16000);

    expect(box.readUInt16BE(20)).toBe(15635);
    expect(box.readUInt16BE(22)).toBe(16450);

    expect(box.readUInt32BE(24)).toBe(10000000);
    expect(box.readUInt32BE(28)).toBe(1);
  });
});

describe("buildClliBox", () => {
  it("emits a 12-byte box with maxCll then maxFall", () => {
    const box = buildClliBox({ maxCll: 1000, maxFall: 400 });

    expect(box.length).toBe(12);
    expect(box.readUInt32BE(0)).toBe(12);
    expect(box.toString("ascii", 4, 8)).toBe("clli");
    expect(box.readUInt16BE(8)).toBe(1000);
    expect(box.readUInt16BE(10)).toBe(400);
  });

  it("clamps within the uint16 range", () => {
    const box = buildClliBox({ maxCll: 65535, maxFall: 65535 });
    expect(box.readUInt16BE(8)).toBe(65535);
    expect(box.readUInt16BE(10)).toBe(65535);
  });
});

// ---------------------------------------------------------------------------
// Synthetic-MP4 round-trip — exercises the box walker without needing FFmpeg
// ---------------------------------------------------------------------------

/**
 * Build a minimal MP4 buffer that has just enough structure for the injector
 * to find an HEVC sample entry. This isn't a playable file — it's the
 * smallest tree that exercises every parent-bumping path.
 */
function makeSyntheticHevcMp4(): {
  buffer: Buffer;
  insertPos: number;
  chunkOffsets: number[];
} {
  // Build inside-out so we know each box's size at construction time.
  const colr = box("colr", Buffer.from("nclx", "ascii"));
  // Minimal hvcC — content doesn't matter for the walker, only the type.
  const hvcC = box("hvcC", Buffer.alloc(8));
  // VisualSampleEntry header is 78 bytes after the box header
  // (offsets 8..86 inside the box). Zeroes are fine for our purposes.
  const sampleEntryBody = Buffer.concat([Buffer.alloc(78), hvcC, colr]);
  const hvc1 = box("hvc1", sampleEntryBody);

  // stsd is a FullBox: 4 bytes version+flags + 4 bytes entry_count + entries.
  const stsdBody = Buffer.concat([Buffer.from([0, 0, 0, 0]), u32(1), hvc1]);
  const stsd = box("stsd", stsdBody);

  // stco with two chunks. Offsets will be patched once we know where mdat lands.
  const stcoBody = Buffer.concat([Buffer.from([0, 0, 0, 0]), u32(2), u32(0), u32(0)]);
  const stco = box("stco", stcoBody);

  const stbl = box("stbl", Buffer.concat([stsd, stco]));
  const minf = box("minf", stbl);
  const mdia = box("mdia", minf);
  const trak = box("trak", mdia);
  const moov = box("moov", trak);

  const ftyp = box("ftyp", Buffer.from("isomavc1\x00\x00\x00\x00", "binary"));
  const mdatPayload = Buffer.from("FAKE_VIDEO_DATA");
  const mdat = box("mdat", mdatPayload);

  // ftyp + moov + mdat (faststart layout).
  const buffer = Buffer.concat([ftyp, moov, mdat]);

  // Patch stco entries to point at mdat's payload region. We need the file
  // offsets (post-concatenation), so locate stco in the final buffer.
  const stcoLoc = findBox(buffer, 0, buffer.length, "moov");
  if (!stcoLoc) throw new Error("synthetic moov missing");
  const found = locateAllBoxes(buffer, stcoLoc.offset + 8, stcoLoc.offset + stcoLoc.size);
  const stcoFinal = found.find((b) => b.type === "stco");
  if (!stcoFinal) throw new Error("synthetic stco missing");

  const mdatStart = ftyp.length + moov.length;
  const chunk1 = mdatStart + 8;
  const chunk2 = mdatStart + 8 + 5;
  buffer.writeUInt32BE(chunk1, stcoFinal.offset + 16);
  buffer.writeUInt32BE(chunk2, stcoFinal.offset + 20);

  // The insertion site is right after `colr` inside hvc1.
  const insertPos = locateColrEnd(buffer);

  return { buffer, insertPos, chunkOffsets: [chunk1, chunk2] };
}

function box(type: string, body: Buffer): Buffer {
  const size = 8 + body.length;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, body]);
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function locateAllBoxes(
  buf: Buffer,
  start: number,
  end: number,
): Array<{ type: string; offset: number; size: number }> {
  const out: Array<{ type: string; offset: number; size: number }> = [];
  let p = start;
  while (p < end - 8) {
    const size = buf.readUInt32BE(p);
    const type = buf.toString("ascii", p + 4, p + 8);
    if (size <= 0 || size > end - p) {
      p += 1;
      continue;
    }
    out.push({ type, offset: p, size });
    if (
      type === "trak" ||
      type === "mdia" ||
      type === "minf" ||
      type === "stbl" ||
      type === "stsd" ||
      type === "hvc1"
    ) {
      const childStart = type === "stsd" ? p + 16 : type === "hvc1" ? p + 86 : p + 8;
      out.push(...locateAllBoxes(buf, childStart, p + size));
    }
    p += size;
  }
  return out;
}

function locateColrEnd(buf: Buffer): number {
  const colr = findColrInTree(buf);
  if (!colr) throw new Error("synthetic colr missing");
  return colr.offset + colr.size;
}

function findColrInTree(buf: Buffer): { offset: number; size: number } | null {
  // Tiny scan — the synthetic file only contains one `colr`.
  for (let p = 0; p < buf.length - 4; p++) {
    if (buf.toString("ascii", p, p + 4) === "colr") {
      const size = buf.readUInt32BE(p - 4);
      return { offset: p - 4, size };
    }
  }
  return null;
}

describe("injectHdrBoxesInBuffer (synthetic MP4)", () => {
  it("inserts mdcv + clli (44 bytes) and bumps every parent box", () => {
    const { buffer, insertPos, chunkOffsets } = makeSyntheticHevcMp4();

    const result = injectHdrBoxesInBuffer(buffer, DEFAULT_HDR10_MASTERING);

    expect(result.injected).toBe(true);
    expect(result.addedBytes).toBe(44);
    expect(result.buffer.length).toBe(buffer.length + 44);

    // Boxes appear at the expected position with the expected types.
    expect(result.buffer.toString("ascii", insertPos + 4, insertPos + 8)).toBe("mdcv");
    expect(result.buffer.toString("ascii", insertPos + 32 + 4, insertPos + 32 + 8)).toBe("clli");

    // moov size grew by 44.
    const oldMoov = findBox(buffer, 0, buffer.length, "moov")!;
    const newMoov = findBox(result.buffer, 0, result.buffer.length, "moov")!;
    expect(newMoov.size).toBe(oldMoov.size + 44);

    // stco chunk offsets shifted forward by 44 (faststart layout: moov before mdat).
    const stco = findBox(result.buffer, newMoov.offset + 8, newMoov.offset + newMoov.size, "trak")!;
    const trakChildren = locateAllBoxes(result.buffer, stco.offset + 8, stco.offset + stco.size);
    const newStco = trakChildren.find((b) => b.type === "stco")!;
    expect(result.buffer.readUInt32BE(newStco.offset + 16)).toBe(chunkOffsets[0] + 44);
    expect(result.buffer.readUInt32BE(newStco.offset + 20)).toBe(chunkOffsets[1] + 44);
  });

  it("is idempotent — second call is a no-op", () => {
    const { buffer } = makeSyntheticHevcMp4();
    const first = injectHdrBoxesInBuffer(buffer, DEFAULT_HDR10_MASTERING);
    expect(first.injected).toBe(true);

    const second = injectHdrBoxesInBuffer(first.buffer, DEFAULT_HDR10_MASTERING);
    expect(second.injected).toBe(false);
    expect(second.reason).toMatch(/already present/);
    expect(second.buffer).toBe(first.buffer);
  });

  it("returns injected=false for a buffer without a moov box", () => {
    const buffer = box("ftyp", Buffer.from("isom\x00\x00\x00\x00", "binary"));
    const result = injectHdrBoxesInBuffer(buffer, DEFAULT_HDR10_MASTERING);
    expect(result.injected).toBe(false);
    expect(result.reason).toMatch(/no moov box/);
  });

  it("returns injected=false for a moov without an HEVC sample entry", () => {
    // A trak with avc1 (H.264) instead of hvc1 — the injector should not
    // accidentally tag SDR or H.264 files as HDR10.
    const avc1 = box("avc1", Buffer.alloc(78));
    const stsd = box("stsd", Buffer.concat([Buffer.from([0, 0, 0, 0]), u32(1), avc1]));
    const stbl = box("stbl", stsd);
    const minf = box("minf", stbl);
    const mdia = box("mdia", minf);
    const trak = box("trak", mdia);
    const moov = box("moov", trak);
    const ftyp = box("ftyp", Buffer.from("isomavc1\x00\x00\x00\x00", "binary"));
    const buffer = Buffer.concat([ftyp, moov]);

    const result = injectHdrBoxesInBuffer(buffer, DEFAULT_HDR10_MASTERING);
    expect(result.injected).toBe(false);
    expect(result.reason).toMatch(/HEVC/);
  });
});

// ---------------------------------------------------------------------------
// shiftChunkOffsetsAfter — verifies the "only past-insertion-site" rule
// ---------------------------------------------------------------------------

describe("shiftChunkOffsetsAfter", () => {
  it("only shifts offsets >= insertPos (handles mdat-before-moov layouts)", () => {
    const { buffer } = makeSyntheticHevcMp4();
    const moov = findBox(buffer, 0, buffer.length, "moov")!;

    const trak = findBox(buffer, moov.offset + 8, moov.offset + moov.size, "trak")!;
    const trakChildren = locateAllBoxes(buffer, trak.offset + 8, trak.offset + trak.size);
    const stco = trakChildren.find((b) => b.type === "stco")!;

    const before1 = buffer.readUInt32BE(stco.offset + 16);
    const before2 = buffer.readUInt32BE(stco.offset + 20);

    // Pretend the insertion site is AFTER all chunk offsets — none should shift.
    shiftChunkOffsetsAfter(buffer, moov.offset, buffer.length + 1, 100);
    expect(buffer.readUInt32BE(stco.offset + 16)).toBe(before1);
    expect(buffer.readUInt32BE(stco.offset + 20)).toBe(before2);

    // Now pretend the insertion site is BEFORE all chunk offsets — both shift.
    shiftChunkOffsetsAfter(buffer, moov.offset, 0, 100);
    expect(buffer.readUInt32BE(stco.offset + 16)).toBe(before1 + 100);
    expect(buffer.readUInt32BE(stco.offset + 20)).toBe(before2 + 100);
  });
});

// ---------------------------------------------------------------------------
// Real-file integration — only runs when an HDR10 fixture is present locally.
// Skipped on CI to keep the fixture optional; the synthetic tests above cover
// the byte-level invariants.
// ---------------------------------------------------------------------------

const FIXTURE = "/tmp/hyperframes-hdr-test/hdr-pq.mp4";

describe.skipIf(!existsSync(FIXTURE))("injectHdrBoxes (real HDR10 fixture)", () => {
  let workPath: string;

  beforeAll(() => {
    workPath = join(tmpdir(), `hdr-inject-test-${Date.now()}.mp4`);
    copyFileSync(FIXTURE, workPath);
  });

  afterAll(() => {
    // Best-effort cleanup; tmpdir gets pruned anyway.
    try {
      const { rmSync } = require("fs") as typeof import("fs");
      rmSync(workPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  it("injects 44 bytes and produces a still-valid MP4", () => {
    const beforeSize = statSync(workPath).size;
    const result = injectHdrBoxes(workPath, DEFAULT_HDR10_MASTERING);

    expect(result.injected).toBe(true);
    expect(result.addedBytes).toBe(44);
    expect(statSync(workPath).size).toBe(beforeSize + 44);

    const data = readFileSync(workPath);
    // mdcv and clli should now appear inside the moov tree.
    const moov = findBox(data, 0, data.length, "moov")!;
    const moovBytes = data.subarray(moov.offset, moov.offset + moov.size);
    expect(moovBytes.includes(Buffer.from("mdcv"))).toBe(true);
    expect(moovBytes.includes(Buffer.from("clli"))).toBe(true);
  });
});
