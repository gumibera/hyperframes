/**
 * MP4 HDR Container Metadata Injection
 *
 * x265 emits HDR10 mastering display + content light level as in-band SEI
 * messages, but FFmpeg's `mov` muxer does not extract those into the
 * container-level `mdcv` (Mastering Display Color Volume) and `clli`
 * (Content Light Level Info) boxes that ingest pipelines like YouTube,
 * Apple AirPlay, and most HDR TVs read. Without those boxes, players see
 * stream-level color tagging (`colr` only) and treat the file as SDR
 * BT.2020 — see https://support.google.com/youtube/answer/7126552.
 *
 * This module surgically inserts `mdcv` + `clli` boxes inside the HEVC
 * sample entry (`hvc1`/`hev1`), bumps every parent box's size, and
 * rewrites every `stco`/`co64` chunk offset that points past the
 * insertion site so the file stays decodable.
 *
 * Reference: ISO/IEC 14496-15 (carriage of NAL-structured video) and
 * ISO/IEC 23001-8 (coding-independent code points).
 */

import { readFileSync, writeFileSync } from "fs";

import type { HdrMasteringMetadata } from "./hdr.js";

// ---------------------------------------------------------------------------
// Mastering metadata parsers
// ---------------------------------------------------------------------------

export interface ParsedMasteringDisplay {
  /** Green chromaticity (x, y) in units of 0.00002 cd/m². */
  greenX: number;
  greenY: number;
  /** Blue chromaticity (x, y) in units of 0.00002 cd/m². */
  blueX: number;
  blueY: number;
  /** Red chromaticity (x, y) in units of 0.00002 cd/m². */
  redX: number;
  redY: number;
  /** White point (x, y) in units of 0.00002 cd/m². */
  whitePointX: number;
  whitePointY: number;
  /** Max display luminance in units of 0.0001 cd/m². */
  maxLuminance: number;
  /** Min display luminance in units of 0.0001 cd/m². */
  minLuminance: number;
}

export interface ParsedMaxCll {
  /** Maximum content light level (cd/m²). */
  maxCll: number;
  /** Maximum frame-average light level (cd/m²). */
  maxFall: number;
}

const MASTERING_DISPLAY_RE =
  /^G\((\d+),(\d+)\)B\((\d+),(\d+)\)R\((\d+),(\d+)\)WP\((\d+),(\d+)\)L\((\d+),(\d+)\)$/;

/**
 * Parse the x265 mastering-display string format
 * (`G(Gx,Gy)B(Bx,By)R(Rx,Ry)WP(WPx,WPy)L(Lmax,Lmin)`).
 *
 * Throws if the string doesn't match the expected shape — corrupt mastering
 * metadata is a real bug, not something to silently fall back from.
 */
export function parseMasteringDisplayString(s: string): ParsedMasteringDisplay {
  const match = MASTERING_DISPLAY_RE.exec(s);
  if (!match) {
    throw new Error(
      `Invalid mastering-display string: ${s} (expected G(x,y)B(x,y)R(x,y)WP(x,y)L(max,min))`,
    );
  }
  const [, gx, gy, bx, by, rx, ry, wpx, wpy, lmax, lmin] = match;
  return {
    greenX: Number(gx),
    greenY: Number(gy),
    blueX: Number(bx),
    blueY: Number(by),
    redX: Number(rx),
    redY: Number(ry),
    whitePointX: Number(wpx),
    whitePointY: Number(wpy),
    maxLuminance: Number(lmax),
    minLuminance: Number(lmin),
  };
}

/**
 * Parse the x265 max-cll string format (`MaxCLL,MaxFALL`).
 * Both values are in cd/m² (nits).
 */
export function parseMaxCllString(s: string): ParsedMaxCll {
  const parts = s.split(",");
  if (parts.length !== 2) {
    throw new Error(`Invalid max-cll string: ${s} (expected MaxCLL,MaxFALL)`);
  }
  const maxCll = Number(parts[0]);
  const maxFall = Number(parts[1]);
  if (!Number.isFinite(maxCll) || !Number.isFinite(maxFall)) {
    throw new Error(`Invalid max-cll string: ${s} (non-numeric values)`);
  }
  return { maxCll, maxFall };
}

// ---------------------------------------------------------------------------
// Box builders
// ---------------------------------------------------------------------------

/**
 * Build an `mdcv` (Mastering Display Color Volume) box.
 *
 * Per ISO/IEC 23001-8 §7.5, the payload is 24 bytes:
 *   - display_primaries[3]: (x,y) pairs for G, B, R (uint16 each, 0.00002 cd/m² units)
 *   - white_point: (x,y) (uint16 each)
 *   - max_display_mastering_luminance (uint32, 0.0001 cd/m² units)
 *   - min_display_mastering_luminance (uint32)
 *
 * Total box size = 8 (header) + 24 (payload) = 32 bytes.
 *
 * NOTE: ISO 23001-8 specifies G,B,R order, NOT R,G,B. Getting this wrong
 * produces visible primary swapping in HDR-aware players.
 */
export function buildMdcvBox(parsed: ParsedMasteringDisplay): Buffer {
  const box = Buffer.alloc(32);
  box.writeUInt32BE(32, 0);
  box.write("mdcv", 4, "ascii");
  box.writeUInt16BE(parsed.greenX, 8);
  box.writeUInt16BE(parsed.greenY, 10);
  box.writeUInt16BE(parsed.blueX, 12);
  box.writeUInt16BE(parsed.blueY, 14);
  box.writeUInt16BE(parsed.redX, 16);
  box.writeUInt16BE(parsed.redY, 18);
  box.writeUInt16BE(parsed.whitePointX, 20);
  box.writeUInt16BE(parsed.whitePointY, 22);
  box.writeUInt32BE(parsed.maxLuminance, 24);
  box.writeUInt32BE(parsed.minLuminance, 28);
  return box;
}

/**
 * Build a `clli` (Content Light Level Information) box.
 *
 * Per ISO/IEC 23001-8 §7.6, the payload is 4 bytes:
 *   - max_content_light_level (uint16, cd/m²)
 *   - max_pic_average_light_level (uint16, cd/m²)
 *
 * Total box size = 8 (header) + 4 (payload) = 12 bytes.
 */
export function buildClliBox(parsed: ParsedMaxCll): Buffer {
  const box = Buffer.alloc(12);
  box.writeUInt32BE(12, 0);
  box.write("clli", 4, "ascii");
  box.writeUInt16BE(parsed.maxCll, 8);
  box.writeUInt16BE(parsed.maxFall, 10);
  return box;
}

// ---------------------------------------------------------------------------
// Box walking helpers
// ---------------------------------------------------------------------------

interface BoxLocation {
  /** File offset where the box header begins. */
  offset: number;
  /** Total box size including the 8-byte (or 16-byte for size==1) header. */
  size: number;
  /** Number of bytes in the header (8 normally, 16 for 64-bit `largesize`). */
  headerSize: number;
}

function readBoxAt(
  buf: Buffer,
  offset: number,
): { type: string; size: number; headerSize: number } {
  if (offset + 8 > buf.length) {
    throw new Error(`Truncated MP4: box header at ${offset} exceeds file length`);
  }
  let size = buf.readUInt32BE(offset);
  const type = buf.toString("ascii", offset + 4, offset + 8);
  let headerSize = 8;
  if (size === 1) {
    if (offset + 16 > buf.length) {
      throw new Error(`Truncated MP4: largesize header at ${offset} exceeds file length`);
    }
    // 64-bit largesize. Node Buffer can't safely read 64-bit unsigned past 2^53,
    // but MP4 files capping at 2^53 bytes is a fine practical limit.
    const high = buf.readUInt32BE(offset + 8);
    const low = buf.readUInt32BE(offset + 12);
    size = high * 0x1_0000_0000 + low;
    headerSize = 16;
  } else if (size === 0) {
    // size==0 means "to end of file" — only valid for the last top-level box.
    size = buf.length - offset;
  }
  return { type, size, headerSize };
}

/**
 * Find the first child box of a given type within `[start, end)`.
 * Returns `null` if not found.
 */
export function findBox(buf: Buffer, start: number, end: number, type: string): BoxLocation | null {
  let pos = start;
  while (pos < end) {
    const { type: bt, size, headerSize } = readBoxAt(buf, pos);
    if (bt === type) {
      return { offset: pos, size, headerSize };
    }
    if (size <= 0) {
      // Defensive: a malformed box with size==0 or huge would otherwise
      // loop forever or bail past the end.
      throw new Error(`Invalid box size at offset ${pos}: ${size}`);
    }
    pos += size;
  }
  return null;
}

/**
 * Find the first video `trak` box (one containing an `hvc1` or `hev1` sample
 * entry). MP4 files commonly contain audio + video traks; we only inject HDR
 * metadata into the HEVC video track.
 */
function findVideoHevcTrak(buf: Buffer, moovStart: number, moovEnd: number): BoxLocation | null {
  let pos = moovStart + 8;
  while (pos < moovEnd) {
    const { type, size, headerSize } = readBoxAt(buf, pos);
    if (type === "trak") {
      const trakEnd = pos + size;
      // Cheap substring scan for 'hvc1' or 'hev1' inside the trak. Scoped to
      // the trak's bytes so we don't false-positive on neighboring traks.
      const slice = buf.subarray(pos, trakEnd);
      if (slice.includes(Buffer.from("hvc1")) || slice.includes(Buffer.from("hev1"))) {
        return { offset: pos, size, headerSize };
      }
    }
    pos += size;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

export interface InjectHdrBoxesResult {
  /** Whether boxes were inserted (false = already present or non-HEVC). */
  injected: boolean;
  /** Bytes appended to the file (0 when injected=false). */
  addedBytes: number;
  /** Reason for skipping when injected=false. */
  reason?: string;
}

/**
 * Inject `mdcv` + `clli` boxes into an HEVC HDR MP4.
 *
 * Idempotent: if both boxes are already present in the HEVC sample entry,
 * the file is left untouched and `injected: false` is returned.
 *
 * Safe with `moov`-before-`mdat` and `moov`-after-`mdat` layouts:
 * only chunk offsets that point past the insertion site are bumped, so a
 * faststart-style file (moov first → mdat shifts) and a default file
 * (mdat first → mdat doesn't shift) are both handled correctly.
 *
 * Returns `injected: false` (without throwing) for files without an HEVC
 * track — non-HDR encodes can call this safely as a no-op.
 */
export function injectHdrBoxes(
  mp4Path: string,
  mastering: HdrMasteringMetadata,
): InjectHdrBoxesResult {
  const data = readFileSync(mp4Path);
  const result = injectHdrBoxesInBuffer(data, mastering);
  if (result.injected) {
    writeFileSync(mp4Path, result.buffer);
  }
  return {
    injected: result.injected,
    addedBytes: result.addedBytes,
    reason: result.reason,
  };
}

interface BufferInjectionResult {
  injected: boolean;
  addedBytes: number;
  reason?: string;
  buffer: Buffer;
}

/**
 * In-memory variant of `injectHdrBoxes`. Returned `buffer` is the original
 * input when `injected: false`, and a freshly allocated buffer otherwise.
 *
 * Exported separately so tests can exercise the parser/walker logic without
 * touching the filesystem.
 */
export function injectHdrBoxesInBuffer(
  data: Buffer,
  mastering: HdrMasteringMetadata,
): BufferInjectionResult {
  const masteringParsed = parseMasteringDisplayString(mastering.masterDisplay);
  const maxCllParsed = parseMaxCllString(mastering.maxCll);

  const moov = findBox(data, 0, data.length, "moov");
  if (!moov) {
    return { injected: false, addedBytes: 0, reason: "no moov box", buffer: data };
  }
  const moovEnd = moov.offset + moov.size;

  const trak = findVideoHevcTrak(data, moov.offset, moovEnd);
  if (!trak) {
    return {
      injected: false,
      addedBytes: 0,
      reason: "no HEVC video trak (hvc1/hev1)",
      buffer: data,
    };
  }
  const trakEnd = trak.offset + trak.size;

  const mdia = findBox(data, trak.offset + 8, trakEnd, "mdia");
  if (!mdia) {
    return {
      injected: false,
      addedBytes: 0,
      reason: "no mdia box inside trak",
      buffer: data,
    };
  }
  const minf = findBox(data, mdia.offset + 8, mdia.offset + mdia.size, "minf");
  if (!minf) {
    return { injected: false, addedBytes: 0, reason: "no minf box", buffer: data };
  }
  const stbl = findBox(data, minf.offset + 8, minf.offset + minf.size, "stbl");
  if (!stbl) {
    return { injected: false, addedBytes: 0, reason: "no stbl box", buffer: data };
  }
  const stsd = findBox(data, stbl.offset + 8, stbl.offset + stbl.size, "stsd");
  if (!stsd) {
    return { injected: false, addedBytes: 0, reason: "no stsd box", buffer: data };
  }

  // stsd is a FullBox: 8 (header) + 4 (version+flags) + 4 (entry_count)
  // = 16 bytes before the first sample entry.
  const stsdEntriesStart = stsd.offset + 16;
  const stsdEnd = stsd.offset + stsd.size;
  let sampleEntry = findBox(data, stsdEntriesStart, stsdEnd, "hvc1");
  if (!sampleEntry) {
    sampleEntry = findBox(data, stsdEntriesStart, stsdEnd, "hev1");
  }
  if (!sampleEntry) {
    return {
      injected: false,
      addedBytes: 0,
      reason: "no hvc1/hev1 sample entry",
      buffer: data,
    };
  }

  // VisualSampleEntry: 8 (box header) + 78 bytes (reserved + dataRef +
  // pre_defined + reserved + width + height + horiz/vert resolution +
  // reserved + frame_count + compressorname + depth + pre_defined).
  // Children boxes start at offset 86 inside the sample entry.
  const sampleEntryChildrenStart = sampleEntry.offset + 86;
  const sampleEntryEnd = sampleEntry.offset + sampleEntry.size;

  // Idempotence — don't double-inject. If both boxes are already present,
  // just no-op so calling this on an already-tagged file is safe.
  const existingMdcv = findBox(data, sampleEntryChildrenStart, sampleEntryEnd, "mdcv");
  const existingClli = findBox(data, sampleEntryChildrenStart, sampleEntryEnd, "clli");
  if (existingMdcv && existingClli) {
    return {
      injected: false,
      addedBytes: 0,
      reason: "mdcv + clli already present",
      buffer: data,
    };
  }

  // Insert AFTER colr if present (sits with the other color-properties boxes).
  // Otherwise after hvcC (the codec config box, always present).
  const colr = findBox(data, sampleEntryChildrenStart, sampleEntryEnd, "colr");
  const hvcC = colr ? null : findBox(data, sampleEntryChildrenStart, sampleEntryEnd, "hvcC");
  const anchor = colr ?? hvcC;
  if (!anchor) {
    return {
      injected: false,
      addedBytes: 0,
      reason: "no colr or hvcC anchor inside sample entry",
      buffer: data,
    };
  }
  const insertPos = anchor.offset + anchor.size;

  const mdcvBox = existingMdcv ? Buffer.alloc(0) : buildMdcvBox(masteringParsed);
  const clliBox = existingClli ? Buffer.alloc(0) : buildClliBox(maxCllParsed);
  const newBoxes = Buffer.concat([mdcvBox, clliBox]);
  const delta = newBoxes.length;
  if (delta === 0) {
    return {
      injected: false,
      addedBytes: 0,
      reason: "boxes already present (partial)",
      buffer: data,
    };
  }

  const out = Buffer.alloc(data.length + delta);
  data.copy(out, 0, 0, insertPos);
  newBoxes.copy(out, insertPos);
  data.copy(out, insertPos + delta, insertPos);

  // Bump every parent box's size field. Each ancestor wraps the inserted
  // bytes, so each grows by exactly `delta`. Order doesn't matter — they're
  // all independent uint32 fields.
  bumpBoxSize(out, sampleEntry.offset, delta);
  bumpBoxSize(out, stsd.offset, delta);
  bumpBoxSize(out, stbl.offset, delta);
  bumpBoxSize(out, minf.offset, delta);
  bumpBoxSize(out, mdia.offset, delta);
  bumpBoxSize(out, trak.offset, delta);
  bumpBoxSize(out, moov.offset, delta);

  // Bump chunk offsets for every track. Crucial subtlety: only offsets that
  // point PAST the insertion site need to shift. With `moov`-before-`mdat`
  // (faststart layout), all chunk offsets are >= insertPos and all shift.
  // With `mdat`-before-`moov` (default ffmpeg layout), all chunk offsets
  // are < insertPos and none shift. Mixed layouts (e.g. some chunks in a
  // pre-moov mdat and others in a post-moov mdat) get the right answer
  // per-chunk. This is what makes the function safe across muxers.
  shiftChunkOffsetsAfter(out, moov.offset, insertPos, delta);

  return { injected: true, addedBytes: delta, buffer: out };
}

function bumpBoxSize(buf: Buffer, boxOffset: number, delta: number): void {
  const cur = buf.readUInt32BE(boxOffset);
  if (cur === 1) {
    // 64-bit largesize: increment the low 32 bits, carrying into the high
    // word if needed. Practical files won't overflow but we'd rather not
    // silently corrupt them if they do.
    const high = buf.readUInt32BE(boxOffset + 8);
    const low = buf.readUInt32BE(boxOffset + 12);
    const total = high * 0x1_0000_0000 + low + delta;
    buf.writeUInt32BE(Math.floor(total / 0x1_0000_0000), boxOffset + 8);
    buf.writeUInt32BE(total >>> 0, boxOffset + 12);
    return;
  }
  buf.writeUInt32BE(cur + delta, boxOffset);
}

/**
 * Walk every `trak` inside `moov` and shift `stco`/`co64` offsets past
 * `insertPos` by `delta`. Exported for tests.
 */
export function shiftChunkOffsetsAfter(
  buf: Buffer,
  moovStart: number,
  insertPos: number,
  delta: number,
): void {
  const moovSize = readBoxAt(buf, moovStart).size;
  const moovEnd = moovStart + moovSize;

  let pos = moovStart + 8;
  while (pos < moovEnd) {
    const { type, size } = readBoxAt(buf, pos);
    if (type === "trak") {
      shiftChunkOffsetsInTrak(buf, pos + 8, pos + size, insertPos, delta);
    }
    pos += size;
  }
}

function shiftChunkOffsetsInTrak(
  buf: Buffer,
  start: number,
  end: number,
  insertPos: number,
  delta: number,
): void {
  // DFS for stco/co64 within mdia → minf → stbl. Recursion via an explicit
  // stack avoids exhausting the Node call stack on pathological boxes.
  const stack: Array<[number, number]> = [[start, end]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    let p = s;
    while (p < e) {
      const { type, size, headerSize } = readBoxAt(buf, p);
      if (type === "stco") {
        // FullBox: 4 bytes version+flags, 4 bytes entry_count, then count×u32.
        const entryCount = buf.readUInt32BE(p + headerSize + 4);
        let entryPos = p + headerSize + 8;
        for (let i = 0; i < entryCount; i++) {
          const cur = buf.readUInt32BE(entryPos);
          if (cur >= insertPos) buf.writeUInt32BE(cur + delta, entryPos);
          entryPos += 4;
        }
      } else if (type === "co64") {
        const entryCount = buf.readUInt32BE(p + headerSize + 4);
        let entryPos = p + headerSize + 8;
        for (let i = 0; i < entryCount; i++) {
          const high = buf.readUInt32BE(entryPos);
          const low = buf.readUInt32BE(entryPos + 4);
          const cur = high * 0x1_0000_0000 + low;
          if (cur >= insertPos) {
            const next = cur + delta;
            buf.writeUInt32BE(Math.floor(next / 0x1_0000_0000), entryPos);
            buf.writeUInt32BE(next >>> 0, entryPos + 4);
          }
          entryPos += 8;
        }
      } else if (type === "mdia" || type === "minf" || type === "stbl" || type === "edts") {
        stack.push([p + headerSize, p + size]);
      }
      p += size;
    }
  }
}
