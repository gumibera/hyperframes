import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import {
  extractPngMetadataFromBuffer,
  extractVideoMetadata,
  pixelFormatHasAlpha,
} from "./ffprobe.js";

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i] ?? 0;
    for (let bit = 0; bit < 8; bit++) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: number[]): Buffer {
  const chunkData = Buffer.from(data);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(chunkData.length, 0);
  header.write(type, 4, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), chunkData])), 0);
  return Buffer.concat([header, chunkData, crc]);
}

function buildPngWithChunks(chunks: Buffer[]): Buffer {
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

function buildMinimalPng(options?: {
  cIcpAfterIdat?: boolean;
  invalidCrc?: boolean;
  longCicp?: boolean;
}) {
  const ihdr = pngChunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 16, 2, 0, 0, 0]);
  const cicpData = options?.longCicp ? [9, 16, 0, 1, 255] : [9, 16, 0, 1];
  let cicp = pngChunk("cICP", cicpData);
  if (options?.invalidCrc) {
    cicp = Buffer.from(cicp);
    cicp[cicp.length - 1] ^= 0xff;
  }
  const idat = pngChunk(
    "IDAT",
    [0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01],
  );
  const iend = pngChunk("IEND", []);
  return options?.cIcpAfterIdat
    ? buildPngWithChunks([ihdr, idat, cicp, iend])
    : buildPngWithChunks([ihdr, cicp, idat, iend]);
}

describe("extractVideoMetadata", () => {
  it("reads HDR PNG cICP metadata when ffprobe color fields are absent", async () => {
    const fixturePath = resolve(
      __dirname,
      "../../../producer/tests/hdr-regression/src/hdr-photo-pq.png",
    );

    const metadata = await extractVideoMetadata(fixturePath);

    expect(metadata.colorSpace).toEqual({
      colorPrimaries: "bt2020",
      colorTransfer: "smpte2084",
      colorSpace: "gbr",
    });
  });
});

describe("extractPngMetadataFromBuffer", () => {
  it("accepts a valid cICP chunk before IDAT", () => {
    const metadata = extractPngMetadataFromBuffer(buildMinimalPng());
    expect(metadata?.colorSpace).toEqual({
      colorPrimaries: "bt2020",
      colorTransfer: "smpte2084",
      colorSpace: "gbr",
    });
  });

  it("rejects cICP chunks after IDAT", () => {
    const metadata = extractPngMetadataFromBuffer(buildMinimalPng({ cIcpAfterIdat: true }));
    expect(metadata).toEqual({
      width: 1,
      height: 1,
      colorSpace: null,
    });
  });

  it("rejects cICP chunks with invalid CRC", () => {
    expect(extractPngMetadataFromBuffer(buildMinimalPng({ invalidCrc: true }))).toBeNull();
  });

  it("rejects cICP chunks whose payload is not exactly four bytes", () => {
    const metadata = extractPngMetadataFromBuffer(buildMinimalPng({ longCicp: true }));
    expect(metadata).toEqual({
      width: 1,
      height: 1,
      colorSpace: null,
    });
  });

  it("continues to parse the checked-in HDR PNG fixture", () => {
    const fixture = readFileSync(
      resolve(__dirname, "../../../producer/tests/hdr-regression/src/hdr-photo-pq.png"),
    );
    expect(extractPngMetadataFromBuffer(fixture)?.colorSpace?.colorTransfer).toBe("smpte2084");
  });
});

// Drives the hwaccel gating in the extractor — a misclassification here
// would either strip alpha silently (false negatives) or disable a safe
// optimization (false positives). Covers the common alpha pix_fmts plus
// the 10/12-bit yuva variants ProRes 4444 and WebM-alpha emit.
describe("pixelFormatHasAlpha", () => {
  it.each([
    "yuva420p",
    "yuva422p",
    "yuva444p",
    "yuva444p10le",
    "yuva444p12le",
    "rgba",
    "bgra",
    "argb",
    "abgr",
    "rgba64le",
    "rgba64be",
  ])("returns true for alpha-bearing pix_fmt %s", (pf) => {
    expect(pixelFormatHasAlpha(pf)).toBe(true);
  });

  it.each([
    "yuv420p",
    "yuv422p",
    "yuv444p",
    "yuv444p10le",
    "gbrp",
    "nv12",
    "rgb24",
    "bgr24",
    "rgb48le",
    "",
  ])("returns false for opaque pix_fmt %s", (pf) => {
    expect(pixelFormatHasAlpha(pf)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(pixelFormatHasAlpha("YUVA420P")).toBe(true);
    expect(pixelFormatHasAlpha("Rgba")).toBe(true);
  });
});
