/**
 * Alpha Blit — in-memory PNG decode + alpha compositing over rgb48le HDR frames.
 *
 * Replaces per-frame FFmpeg spawns for the two-pass HDR compositing path.
 * Uses only Node.js built-ins (zlib) — no additional dependencies.
 */

import { inflateSync } from "zlib";

// ── PNG decoder ───────────────────────────────────────────────────────────────

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Shared PNG chunk parsing + filter reconstruction.
 *
 * Verifies the PNG signature, iterates chunks to collect IHDR metadata and IDAT
 * payloads, decompresses with zlib, and reconstructs all 5 PNG filter types.
 *
 * Returns the defiltered pixel bytes (no filter-type prefix bytes) along with
 * IHDR fields so callers can convert to their target pixel format.
 */
function decodePngRaw(
  buf: Buffer,
  caller: string,
): { width: number; height: number; bitDepth: number; colorType: number; rawPixels: Buffer } {
  // Verify PNG signature
  if (
    buf[0] !== 137 ||
    buf[1] !== 80 ||
    buf[2] !== 78 ||
    buf[3] !== 71 ||
    buf[4] !== 13 ||
    buf[5] !== 10 ||
    buf[6] !== 26 ||
    buf[7] !== 10
  ) {
    throw new Error(`${caller}: not a PNG file`);
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let sawIhdr = false;
  const idatChunks: Buffer[] = [];

  while (pos + 12 <= buf.length) {
    const chunkLen = buf.readUInt32BE(pos);
    const chunkType = buf.toString("ascii", pos + 4, pos + 8);
    const chunkData = buf.subarray(pos + 8, pos + 8 + chunkLen);

    if (chunkType === "IHDR") {
      width = chunkData.readUInt32BE(0);
      height = chunkData.readUInt32BE(4);
      bitDepth = chunkData[8] ?? 0;
      colorType = chunkData[9] ?? 0;
      interlace = chunkData[12] ?? 0;
      sawIhdr = true;
    } else if (chunkType === "IDAT") {
      idatChunks.push(Buffer.from(chunkData));
    } else if (chunkType === "IEND") {
      break;
    }

    pos += 12 + chunkLen; // length(4) + type(4) + data(chunkLen) + crc(4)
  }

  if (!sawIhdr) {
    throw new Error(`${caller}: PNG missing IHDR chunk`);
  }
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`${caller}: unsupported color type ${colorType} (expected 2=RGB or 6=RGBA)`);
  }
  if (interlace !== 0) {
    throw new Error(
      `${caller}: Adam7-interlaced PNGs are not supported (interlace method ${interlace})`,
    );
  }

  // Bytes per pixel: channels x bytes-per-channel
  const channels = colorType === 6 ? 4 : 3;
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;

  const compressed = Buffer.concat(idatChunks);
  const decompressed = inflateSync(compressed);

  // Reconstruct filtered rows into a flat pixel buffer (no filter bytes)
  const rawPixels = Buffer.allocUnsafe(height * stride);
  const prevRow = new Uint8Array(stride);
  const currRow = new Uint8Array(stride);

  let srcPos = 0;

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[srcPos++] ?? 0;
    const rawRow = decompressed.subarray(srcPos, srcPos + stride);
    srcPos += stride;

    switch (filterType) {
      case 0: // None
        currRow.set(rawRow);
        break;
      case 1: // Sub
        for (let x = 0; x < stride; x++) {
          currRow[x] = ((rawRow[x] ?? 0) + (x >= bpp ? (currRow[x - bpp] ?? 0) : 0)) & 0xff;
        }
        break;
      case 2: // Up
        for (let x = 0; x < stride; x++) {
          currRow[x] = ((rawRow[x] ?? 0) + (prevRow[x] ?? 0)) & 0xff;
        }
        break;
      case 3: // Average
        for (let x = 0; x < stride; x++) {
          const left = x >= bpp ? (currRow[x - bpp] ?? 0) : 0;
          const up = prevRow[x] ?? 0;
          currRow[x] = ((rawRow[x] ?? 0) + Math.floor((left + up) / 2)) & 0xff;
        }
        break;
      case 4: // Paeth
        for (let x = 0; x < stride; x++) {
          const left = x >= bpp ? (currRow[x - bpp] ?? 0) : 0;
          const up = prevRow[x] ?? 0;
          const upLeft = x >= bpp ? (prevRow[x - bpp] ?? 0) : 0;
          currRow[x] = ((rawRow[x] ?? 0) + paeth(left, up, upLeft)) & 0xff;
        }
        break;
      default:
        throw new Error(`${caller}: unknown filter type ${filterType} at row ${y}`);
    }

    rawPixels.set(currRow, y * stride);
    prevRow.set(currRow);
  }

  return { width, height, bitDepth, colorType, rawPixels };
}

/**
 * Decode a PNG buffer to raw RGBA pixel data (8-bit per channel).
 *
 * Supports color type 6 (RGBA) and color type 2 (RGB) at 8-bit depth,
 * non-interlaced. Chrome's Page.captureScreenshot always emits this format.
 *
 * Returns a Uint8Array of width*height*4 bytes in RGBA order.
 */
export function decodePng(buf: Buffer): { width: number; height: number; data: Uint8Array } {
  const { width, height, bitDepth, colorType, rawPixels } = decodePngRaw(buf, "decodePng");

  if (bitDepth !== 8) {
    throw new Error(`decodePng: unsupported bit depth ${bitDepth} (expected 8)`);
  }

  const output = new Uint8Array(width * height * 4);

  if (colorType === 6) {
    // RGBA — copy directly
    output.set(rawPixels);
  } else {
    // RGB → RGBA: set alpha to 255
    for (let i = 0; i < width * height; i++) {
      output[i * 4 + 0] = rawPixels[i * 3 + 0] ?? 0;
      output[i * 4 + 1] = rawPixels[i * 3 + 1] ?? 0;
      output[i * 4 + 2] = rawPixels[i * 3 + 2] ?? 0;
      output[i * 4 + 3] = 255;
    }
  }

  return { width, height, data: output };
}

// ── 16-bit PNG decoder ────────────────────────────────────────────────────────

/**
 * Decode a 16-bit RGB PNG (from FFmpeg) to an rgb48le Buffer.
 *
 * FFmpeg's `-pix_fmt rgb48le -c:v png` produces 16-bit RGB PNGs.
 * PNG stores 16-bit values in big-endian; this function swaps to little-endian
 * for the streaming encoder's rgb48le input format.
 *
 * Supports colorType 2 (RGB) and 6 (RGBA) at 16-bit depth, non-interlaced.
 */
export function decodePngToRgb48le(buf: Buffer): { width: number; height: number; data: Buffer } {
  const { width, height, bitDepth, colorType, rawPixels } = decodePngRaw(buf, "decodePngToRgb48le");

  if (bitDepth !== 16) {
    throw new Error(`decodePngToRgb48le: unsupported bit depth ${bitDepth} (expected 16)`);
  }

  // 16-bit: 2 bytes per channel. RGB=6 bytes/pixel, RGBA=8 bytes/pixel
  const bpp = colorType === 6 ? 8 : 6;

  // Output: rgb48le = 3 channels x 2 bytes (LE) = 6 bytes/pixel
  const output = Buffer.allocUnsafe(width * height * 6);

  for (let y = 0; y < height; y++) {
    const dstBase = y * width * 6;
    const srcRowBase = y * width * bpp;
    for (let x = 0; x < width; x++) {
      const srcBase = srcRowBase + x * bpp;
      // PNG stores 16-bit as big-endian: [high, low]. Swap to little-endian: [low, high].
      output[dstBase + x * 6 + 0] = rawPixels[srcBase + 1] ?? 0; // R low
      output[dstBase + x * 6 + 1] = rawPixels[srcBase + 0] ?? 0; // R high
      output[dstBase + x * 6 + 2] = rawPixels[srcBase + 3] ?? 0; // G low
      output[dstBase + x * 6 + 3] = rawPixels[srcBase + 2] ?? 0; // G high
      output[dstBase + x * 6 + 4] = rawPixels[srcBase + 5] ?? 0; // B low
      output[dstBase + x * 6 + 5] = rawPixels[srcBase + 4] ?? 0; // B high
    }
  }

  return { width, height, data: output };
}

// ── sRGB → HDR color conversion ───────────────────────────────────────────────
//
// Pipeline per pixel:
//   sRGB 8-bit  →  linear BT.709 (sRGB EOTF, 256-entry LUT)
//                →  linear BT.2020 (3×3 primary matrix)
//                →  HDR signal 16-bit (HLG/PQ OETF, 4096-entry LUT)
//
// ## Why both transfer AND primaries
//
// HLG and PQ HDR video is encoded in the BT.2020 color volume, which has
// substantially wider primaries than sRGB/BT.709. Skipping the primary
// conversion and treating sRGB R/G/B values as if they were already BT.2020
// makes saturated colors *look more saturated than the source intended* —
// e.g. sRGB pure blue (0, 0, 255) lands on BT.2020 blue, which is far more
// vivid than what the designer specified.
//
// For grayscale content (R = G = B) the matrix is the identity (each row of
// the BT.709→BT.2020 matrix sums to 1.0), so neutral text/UI is unaffected.
// For chromatic content (icons, progress bars, accent colors) the conversion
// is essential for color-accurate compositing.
//
// ## Conventions
//
// "Linear" means **scene-referred light in [0, 1] relative to SDR reference
// white** (not absolute nits). The HLG branch applies the OETF directly — no
// OOTF (no scene→display 1.2 gamma). DOM overlays are composited ON TOP of
// HLG video pixels which already live in HLG signal space, so we need the
// overlay to live in the same space; applying the OOTF here would
// double-apply it.
//
// For PQ, SDR white is placed at 203 nits per ITU-R BT.2408 ("SDR white"
// reference level) and normalized against the 10,000-nit PQ peak. This lets
// SDR text/UI sit at the conventional SDR-white brightness within a PQ frame
// rather than at peak brightness.

// BT.709 → BT.2020 primary conversion matrix (linear light).
// Source: ITU-R BT.2087-0, Annex 2. Each row sums to 1.0 so neutrals
// (R = G = B) are invariant — only chromatic content gets remapped.
const M709_TO_2020 = [
  [0.6274039, 0.3292832, 0.0433128],
  [0.0690973, 0.9195403, 0.0113624],
  [0.0163914, 0.088013, 0.8955953],
] as const;

/** sRGB 8-bit signal → linear scene light in [0, 1]. Exact (256 entries). */
const SRGB_TO_LINEAR: Float32Array = (() => {
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    lut[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  }
  return lut;
})();

// Linear-light → HDR signal LUTs.
//
// We use a 4096-entry table indexed by `Math.round(linear * 4095)`. This
// trades a tiny amount of precision in the highlights for a 16× smaller
// memory footprint vs. a 65536-entry LUT. The OETF is steepest near zero
// (where dense sampling matters most), and at the dark end 1 / 4095 ≈ 0.024%
// of full-scale — far below visible threshold for compositing 8-bit overlays.
const HDR_LUT_SIZE = 4096;
const HDR_LUT_MAX = HDR_LUT_SIZE - 1;

function buildLinearToHdrLut(transfer: "hlg" | "pq"): Uint16Array {
  const lut = new Uint16Array(HDR_LUT_SIZE);

  // HLG OETF constants (Rec. 2100)
  const hlgA = 0.17883277;
  const hlgB = 1 - 4 * hlgA;
  const hlgC = 0.5 - hlgA * Math.log(4 * hlgA);

  // PQ (SMPTE 2084) OETF constants
  const pqM1 = 0.1593017578125;
  const pqM2 = 78.84375;
  const pqC1 = 0.8359375;
  const pqC2 = 18.8515625;
  const pqC3 = 18.6875;
  const pqMaxNits = 10000.0;
  const sdrNits = 203.0;

  for (let i = 0; i < HDR_LUT_SIZE; i++) {
    const linear = i / HDR_LUT_MAX;
    let signal: number;
    if (transfer === "hlg") {
      signal =
        linear <= 1 / 12 ? Math.sqrt(3 * linear) : hlgA * Math.log(12 * linear - hlgB) + hlgC;
    } else {
      // PQ: scale linear (relative to SDR white) into absolute PQ light
      // before applying the OETF, so SDR white lands at 203 nits.
      const Lp = Math.max(0, (linear * sdrNits) / pqMaxNits);
      const Lm1 = Math.pow(Lp, pqM1);
      signal = Math.pow((pqC1 + pqC2 * Lm1) / (1.0 + pqC3 * Lm1), pqM2);
    }
    lut[i] = Math.min(65535, Math.round(signal * 65535));
  }

  return lut;
}

const LINEAR_TO_HLG = buildLinearToHdrLut("hlg");
const LINEAR_TO_PQ = buildLinearToHdrLut("pq");

function selectLinearToHdrLut(transfer: "hlg" | "pq"): Uint16Array {
  return transfer === "pq" ? LINEAR_TO_PQ : LINEAR_TO_HLG;
}

/**
 * Convert one sRGB 8-bit pixel to an HDR 16-bit pixel via the full pipeline:
 * sRGB EOTF → BT.709→BT.2020 primary matrix → HDR OETF.
 *
 * Writes the result into `out` at offset 0/1/2.
 */
function srgbToHdr16(
  r8: number,
  g8: number,
  b8: number,
  hdrLut: Uint16Array,
  out: { r: number; g: number; b: number },
): void {
  const lr = SRGB_TO_LINEAR[r8] ?? 0;
  const lg = SRGB_TO_LINEAR[g8] ?? 0;
  const lb = SRGB_TO_LINEAR[b8] ?? 0;

  // Matrix indices match the ITU-R BT.2087-0 layout above.
  const m0 = M709_TO_2020[0]!;
  const m1 = M709_TO_2020[1]!;
  const m2 = M709_TO_2020[2]!;

  let r2 = m0[0]! * lr + m0[1]! * lg + m0[2]! * lb;
  let g2 = m1[0]! * lr + m1[1]! * lg + m1[2]! * lb;
  let b2 = m2[0]! * lr + m2[1]! * lg + m2[2]! * lb;

  // For in-gamut sRGB inputs (which is everything we get from an 8-bit
  // canvas), each row sums to 1.0 with non-negative coefficients, so outputs
  // are guaranteed in [0, 1]. The clamps guard against fp drift only.
  if (r2 < 0) r2 = 0;
  else if (r2 > 1) r2 = 1;
  if (g2 < 0) g2 = 0;
  else if (g2 > 1) g2 = 1;
  if (b2 < 0) b2 = 0;
  else if (b2 > 1) b2 = 1;

  out.r = hdrLut[Math.round(r2 * HDR_LUT_MAX)] ?? 0;
  out.g = hdrLut[Math.round(g2 * HDR_LUT_MAX)] ?? 0;
  out.b = hdrLut[Math.round(b2 * HDR_LUT_MAX)] ?? 0;
}

// ── Alpha compositing ─────────────────────────────────────────────────────────

/**
 * Alpha-composite a DOM RGBA overlay (8-bit sRGB) onto an HDR canvas
 * (rgb48le) in-place.
 *
 * DOM pixels are converted from sRGB to the target HDR signal space (HLG or
 * PQ) via a full sRGB EOTF → BT.709→BT.2020 primary matrix → HDR OETF
 * pipeline, then alpha-blended against the existing HDR canvas in HDR signal
 * space. Without the primary conversion, saturated sRGB colors (UI accents,
 * icons) over-saturate when interpreted as BT.2020.
 *
 * Alpha blending is intentionally performed in HDR signal space (not linear
 * light) to match the existing GPU compositing path. Since text/UI overlays
 * are usually fully opaque, this only affects soft edges where the difference
 * is imperceptible.
 *
 * @param domRgba   Raw RGBA pixel data from decodePng() — width*height*4 bytes
 * @param canvas    HDR canvas in rgb48le format — width*height*6 bytes, mutated in-place
 * @param width     Canvas width in pixels
 * @param height    Canvas height in pixels
 * @param transfer  HDR transfer function — selects PQ or HLG OETF
 */
export function blitRgba8OverRgb48le(
  domRgba: Uint8Array,
  canvas: Buffer,
  width: number,
  height: number,
  transfer: "hlg" | "pq" = "hlg",
): void {
  const pixelCount = width * height;
  const hdrLut = selectLinearToHdrLut(transfer);
  const out = { r: 0, g: 0, b: 0 };

  for (let i = 0; i < pixelCount; i++) {
    const da = domRgba[i * 4 + 3] ?? 0;
    if (da === 0) continue;

    srgbToHdr16(
      domRgba[i * 4 + 0] ?? 0,
      domRgba[i * 4 + 1] ?? 0,
      domRgba[i * 4 + 2] ?? 0,
      hdrLut,
      out,
    );

    if (da === 255) {
      canvas.writeUInt16LE(out.r, i * 6);
      canvas.writeUInt16LE(out.g, i * 6 + 2);
      canvas.writeUInt16LE(out.b, i * 6 + 4);
    } else {
      const alpha = da / 255;
      const invAlpha = 1 - alpha;

      const hdrR = (canvas[i * 6 + 0] ?? 0) | ((canvas[i * 6 + 1] ?? 0) << 8);
      const hdrG = (canvas[i * 6 + 2] ?? 0) | ((canvas[i * 6 + 3] ?? 0) << 8);
      const hdrB = (canvas[i * 6 + 4] ?? 0) | ((canvas[i * 6 + 5] ?? 0) << 8);

      canvas.writeUInt16LE(Math.round(out.r * alpha + hdrR * invAlpha), i * 6);
      canvas.writeUInt16LE(Math.round(out.g * alpha + hdrG * invAlpha), i * 6 + 2);
      canvas.writeUInt16LE(Math.round(out.b * alpha + hdrB * invAlpha), i * 6 + 4);
    }
  }
}

// ── Rounded-rectangle mask ───────────────────────────────────────────────────

/** Anti-aliased alpha for a point at distance `dist` from a corner circle of radius `r`. */
function cornerAlpha(px: number, py: number, cx: number, cy: number, r: number): number {
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > r + 0.5) return 0;
  if (dist > r - 0.5) return r + 0.5 - dist;
  return 1;
}

/**
 * Compute the alpha (0.0–1.0) for a point inside a rounded rectangle.
 * Returns 1.0 for interior pixels, 0.0 for exterior, and a smooth
 * transition at the corner edges (1px anti-aliasing).
 *
 * @param px     X coordinate (continuous, e.g. pixel center or subpixel)
 * @param py     Y coordinate
 * @param w      Rectangle width
 * @param h      Rectangle height
 * @param radii  Corner radii [topLeft, topRight, bottomRight, bottomLeft]
 */
export function roundedRectAlpha(
  px: number,
  py: number,
  w: number,
  h: number,
  radii: [number, number, number, number],
): number {
  const [tl, tr, br, bl] = radii;
  if (px < tl && py < tl) return cornerAlpha(px, py, tl, tl, tl);
  if (px >= w - tr && py < tr) return cornerAlpha(px, py, w - tr, tr, tr);
  if (px >= w - br && py >= h - br) return cornerAlpha(px, py, w - br, h - br, br);
  if (px < bl && py >= h - bl) return cornerAlpha(px, py, bl, h - bl, bl);
  return 1;
}

// ── Positioned HDR region copy ────────────────────────────────────────────────

/**
 * Copy a rectangular region of an rgb48le source onto an rgb48le canvas
 * at position (dx, dy). Clips to canvas bounds. Optional opacity blending
 * (0.0–1.0) over existing canvas content.
 *
 * @param canvas       Destination rgb48le buffer (canvasWidth * canvasHeight * 6 bytes)
 * @param source       Source rgb48le buffer (sw * sh * 6 bytes)
 * @param dx           Destination X offset on canvas
 * @param dy           Destination Y offset on canvas
 * @param sw           Source width in pixels
 * @param sh           Source height in pixels
 * @param canvasWidth  Canvas width in pixels (needed for stride calculation)
 * @param canvasHeight Canvas height in pixels (used to clip the destination region)
 * @param opacity      Optional opacity 0.0–1.0 (default 1.0 = fully opaque copy)
 */
export function blitRgb48leRegion(
  canvas: Buffer,
  source: Buffer,
  dx: number,
  dy: number,
  sw: number,
  sh: number,
  canvasWidth: number,
  canvasHeight: number,
  opacity?: number,
  borderRadius?: [number, number, number, number],
): void {
  if (sw <= 0 || sh <= 0) return;

  const op = opacity ?? 1.0;

  const x0 = Math.max(0, dx);
  const y0 = Math.max(0, dy);
  const x1 = Math.min(canvasWidth, dx + sw);
  const y1 = Math.min(canvasHeight, dy + sh);
  if (x0 >= x1 || y0 >= y1) return;

  const clippedW = x1 - x0;
  const srcOffsetX = x0 - dx;
  const srcOffsetY = y0 - dy;

  const hasMask = borderRadius !== undefined;

  if (op >= 0.999 && !hasMask) {
    for (let y = 0; y < y1 - y0; y++) {
      const srcRowOff = ((srcOffsetY + y) * sw + srcOffsetX) * 6;
      const dstRowOff = ((y0 + y) * canvasWidth + x0) * 6;
      source.copy(canvas, dstRowOff, srcRowOff, srcRowOff + clippedW * 6);
    }
  } else {
    for (let y = 0; y < y1 - y0; y++) {
      for (let x = 0; x < clippedW; x++) {
        let effectiveOp = op;
        if (hasMask) {
          const ma = roundedRectAlpha(srcOffsetX + x, srcOffsetY + y, sw, sh, borderRadius);
          if (ma <= 0) continue;
          effectiveOp *= ma;
        }

        const srcOff = ((srcOffsetY + y) * sw + srcOffsetX + x) * 6;
        const dstOff = ((y0 + y) * canvasWidth + x0 + x) * 6;

        if (effectiveOp >= 0.999) {
          source.copy(canvas, dstOff, srcOff, srcOff + 6);
        } else {
          const invEff = 1 - effectiveOp;
          const sr = source.readUInt16LE(srcOff);
          const sg = source.readUInt16LE(srcOff + 2);
          const sb = source.readUInt16LE(srcOff + 4);
          const dr = canvas.readUInt16LE(dstOff);
          const dg = canvas.readUInt16LE(dstOff + 2);
          const db = canvas.readUInt16LE(dstOff + 4);
          canvas.writeUInt16LE(Math.round(sr * effectiveOp + dr * invEff), dstOff);
          canvas.writeUInt16LE(Math.round(sg * effectiveOp + dg * invEff), dstOff + 2);
          canvas.writeUInt16LE(Math.round(sb * effectiveOp + db * invEff), dstOff + 4);
        }
      }
    }
  }
}

/**
 * Apply a 2D affine transform to an rgb48le source and composite onto a canvas.
 *
 * For each destination pixel, the inverse transform maps back to source coordinates.
 * Bilinear interpolation samples the 4 nearest source pixels for smooth scaling/rotation.
 *
 * @param canvas     Destination rgb48le buffer, mutated in-place
 * @param source     Source rgb48le buffer (srcW * srcH * 6 bytes)
 * @param matrix     CSS transform matrix [a, b, c, d, tx, ty]
 * @param srcW       Source width in pixels
 * @param srcH       Source height in pixels
 * @param canvasW    Canvas width in pixels
 * @param canvasH    Canvas height in pixels
 * @param opacity    Optional opacity 0.0–1.0 (default 1.0)
 */
export function blitRgb48leAffine(
  canvas: Buffer,
  source: Buffer,
  matrix: number[],
  srcW: number,
  srcH: number,
  canvasW: number,
  canvasH: number,
  opacity?: number,
  borderRadius?: [number, number, number, number],
): void {
  const a = matrix[0];
  const b = matrix[1];
  const c = matrix[2];
  const d = matrix[3];
  const tx = matrix[4];
  const ty = matrix[5];
  if (
    a === undefined ||
    b === undefined ||
    c === undefined ||
    d === undefined ||
    tx === undefined ||
    ty === undefined
  )
    return;

  // Invert the 2x2 part of the affine matrix
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-10) return; // degenerate matrix

  const invA = d / det;
  const invB = -b / det;
  const invC = -c / det;
  const invD = a / det;
  const invTx = -(invA * tx + invC * ty);
  const invTy = -(invB * tx + invD * ty);

  const op = opacity ?? 1.0;

  const hasMask = borderRadius !== undefined;

  // Compute bounding box of transformed source on canvas
  const corners = [
    [tx, ty],
    [a * srcW + tx, b * srcW + ty],
    [c * srcH + tx, d * srcH + ty],
    [a * srcW + c * srcH + tx, b * srcW + d * srcH + ty],
  ];
  let minX = canvasW,
    maxX = 0,
    minY = canvasH,
    maxY = 0;
  for (const corner of corners) {
    const cx = corner[0] ?? 0;
    const cy = corner[1] ?? 0;
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  const startX = Math.max(0, Math.floor(minX));
  const endX = Math.min(canvasW, Math.ceil(maxX));
  const startY = Math.max(0, Math.floor(minY));
  const endY = Math.min(canvasH, Math.ceil(maxY));

  for (let dy = startY; dy < endY; dy++) {
    for (let dx = startX; dx < endX; dx++) {
      const sx = invA * dx + invC * dy + invTx;
      const sy = invB * dx + invD * dy + invTy;

      if (sx < 0 || sy < 0 || sx >= srcW || sy >= srcH) continue;

      // Apply rounded-rect mask in source coordinates
      let effectiveOp = op;
      if (hasMask) {
        const ma = roundedRectAlpha(sx, sy, srcW, srcH, borderRadius);
        if (ma <= 0) continue;
        effectiveOp *= ma;
      }

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      const x1 = Math.min(x0 + 1, srcW - 1);
      const y1 = Math.min(y0 + 1, srcH - 1);

      const off00 = (y0 * srcW + x0) * 6;
      const off10 = (y0 * srcW + x1) * 6;
      const off01 = (y1 * srcW + x0) * 6;
      const off11 = (y1 * srcW + x1) * 6;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const sr =
        source.readUInt16LE(off00) * w00 +
        source.readUInt16LE(off10) * w10 +
        source.readUInt16LE(off01) * w01 +
        source.readUInt16LE(off11) * w11;
      const sg =
        source.readUInt16LE(off00 + 2) * w00 +
        source.readUInt16LE(off10 + 2) * w10 +
        source.readUInt16LE(off01 + 2) * w01 +
        source.readUInt16LE(off11 + 2) * w11;
      const sb =
        source.readUInt16LE(off00 + 4) * w00 +
        source.readUInt16LE(off10 + 4) * w10 +
        source.readUInt16LE(off01 + 4) * w01 +
        source.readUInt16LE(off11 + 4) * w11;

      const dstOff = (dy * canvasW + dx) * 6;

      if (effectiveOp >= 0.999) {
        canvas.writeUInt16LE(Math.round(sr), dstOff);
        canvas.writeUInt16LE(Math.round(sg), dstOff + 2);
        canvas.writeUInt16LE(Math.round(sb), dstOff + 4);
      } else {
        const invEff = 1 - effectiveOp;
        const dr = canvas.readUInt16LE(dstOff);
        const dg = canvas.readUInt16LE(dstOff + 2);
        const db = canvas.readUInt16LE(dstOff + 4);
        canvas.writeUInt16LE(Math.round(sr * effectiveOp + dr * invEff), dstOff);
        canvas.writeUInt16LE(Math.round(sg * effectiveOp + dg * invEff), dstOff + 2);
        canvas.writeUInt16LE(Math.round(sb * effectiveOp + db * invEff), dstOff + 4);
      }
    }
  }
}

/**
 * Parse a CSS `matrix(a,b,c,d,e,f)` string into a 6-element array.
 * Returns null for "none", empty, or unsupported formats (matrix3d).
 *
 * The array maps to the CSS matrix: [a, b, c, d, tx, ty] where:
 *   | a  c  tx |     (a=scaleX, b=skewY, c=skewX, d=scaleY, tx/ty=translate)
 *   | b  d  ty |
 *   | 0  0  1  |
 */
export function parseTransformMatrix(css: string): number[] | null {
  if (!css || css === "none") return null;
  const match = css.match(
    /^matrix\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,)]+)\s*\)$/,
  );
  if (!match) return null;
  const values = match.slice(1, 7).map(Number);
  if (!values.every(Number.isFinite)) return null;
  return values;
}
