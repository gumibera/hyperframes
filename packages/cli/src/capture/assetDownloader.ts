/**
 * Download assets (SVGs, images, favicon, video posters) from extracted tokens + asset catalog.
 *
 * Single-pass approach: uses the asset catalog (which already deduplicates srcset variants
 * and keeps the highest resolution) as the primary source for images. This avoids downloading
 * the same image twice at different resolutions.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import type { DesignTokens, DownloadedAsset } from "./types.js";
import type { CatalogedAsset } from "./assetCataloger.js";

export async function downloadAssets(
  tokens: DesignTokens,
  outputDir: string,
  catalogedAssets?: CatalogedAsset[],
): Promise<DownloadedAsset[]> {
  const assetsDir = join(outputDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const assets: DownloadedAsset[] = [];
  const downloadedUrls = new Set<string>();

  // 1. ALL inline SVGs — save as files (logos get priority naming)
  mkdirSync(join(outputDir, "assets", "svgs"), { recursive: true });
  for (let i = 0; i < tokens.svgs.length && i < 30; i++) {
    const svg = tokens.svgs[i]!;
    if (!svg.outerHTML || svg.outerHTML.length < 50) continue;
    const label = svg.label?.replace(/[^a-zA-Z0-9-_ ]/g, "").trim();
    const name = label ? slugify(label) + ".svg" : svg.isLogo ? `logo-${i}.svg` : `icon-${i}.svg`;
    const localPath = `assets/svgs/${name}`;
    try {
      writeFileSync(join(outputDir, localPath), svg.outerHTML, "utf-8");
      assets.push({ url: "", localPath, type: "svg" });
    } catch {
      /* skip */
    }
  }

  // 2. Favicon
  for (const icon of tokens.icons) {
    if (!icon.href) continue;
    try {
      const ext = extname(new URL(icon.href).pathname) || ".ico";
      const name = `favicon${ext}`;
      const localPath = `assets/${name}`;
      const buffer = await fetchBuffer(icon.href);
      if (buffer) {
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url: icon.href, localPath, type: "favicon" });
        break;
      }
    } catch {
      /* skip */
    }
  }

  // 3. Images — use the catalog as the single source of truth (highest resolution, deduplicated)
  //    If no catalog available, fall back to tokens.images
  const imageUrls: { url: string; isPoster: boolean }[] = [];

  if (catalogedAssets && catalogedAssets.length > 0) {
    // Use catalog — already deduplicated with highest-res srcset variants
    for (const a of catalogedAssets) {
      if (a.type !== "Image") continue;
      if (!a.url.startsWith("http")) continue;
      // Skip junk
      if (a.url.includes("pixel") || a.url.includes("beacon") || a.url.includes("analytics"))
        continue;
      if (a.url.includes("/favicon")) continue;
      // Only download images from meaningful contexts
      const hasGoodContext = a.contexts.some(
        (c) =>
          c === "img[src]" ||
          c === "img[srcset]" ||
          c === "video[poster]" ||
          c === "source[srcset]" ||
          c === "data-src",
      );
      if (!hasGoodContext) continue;
      const isPoster = a.contexts.includes("video[poster]");
      imageUrls.push({ url: a.url, isPoster });
    }
  } else {
    // Fallback: use tokens.images
    for (const img of tokens.images) {
      if (img.width > 200 && img.src.startsWith("http")) {
        imageUrls.push({ url: img.src, isPoster: false });
      }
    }
  }

  // Download up to 25 images in parallel batches, skipping duplicates and tiny files
  // Pre-filter to deduplicate and cap before downloading
  const toDownload: { url: string; isPoster: boolean; normalized: string }[] = [];
  for (const { url, isPoster } of imageUrls) {
    if (toDownload.length >= 25) break;
    const normalized = normalizeUrl(url);
    if (downloadedUrls.has(normalized)) continue;
    downloadedUrls.add(normalized); // Reserve to prevent duplicates in parallel batches
    toDownload.push({ url, isPoster, normalized });
  }

  // Download in parallel batches of 5
  const BATCH_SIZE = 5;
  let imgIdx = 0;
  for (let i = 0; i < toDownload.length; i += BATCH_SIZE) {
    const batch = toDownload.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async ({ url, isPoster }) => {
        const parsedUrl = new URL(url);
        const pathExt = extname(parsedUrl.pathname);
        const ext = pathExt && pathExt.length <= 5 ? pathExt : ".jpg";
        const buffer = await fetchBuffer(url);
        if (!buffer || buffer.length < 10000) return null;
        return { url, isPoster, parsedUrl, ext, buffer };
      }),
    );
    for (const result of results) {
      if (result.status !== "fulfilled" || !result.value) continue;
      const { url, isPoster, parsedUrl, ext, buffer } = result.value;
      try {
        const prefix = isPoster ? "poster" : "image";
        const rawName =
          parsedUrl.pathname
            .split("/")
            .pop()
            ?.replace(/\.[^.]+$/, "") || "";
        const isMeaningful =
          rawName.length > 2 &&
          rawName.length < 50 &&
          !/^[a-f0-9]{8,}$/i.test(rawName) &&
          !/^\d+$/.test(rawName) &&
          !rawName.includes("_next") &&
          !rawName.includes("?");
        const slug = isMeaningful ? slugify(rawName) : `${prefix}-${imgIdx}`;
        const name = `${slug}${ext}`;
        const localPath = `assets/${name}`;
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url, localPath, type: "image" });
        imgIdx++;
      } catch {
        /* skip */
      }
    }
  }

  // 4. OG image (if not already downloaded)
  if (tokens.ogImage && !downloadedUrls.has(normalizeUrl(tokens.ogImage))) {
    try {
      const ext = extname(new URL(tokens.ogImage).pathname) || ".jpg";
      const localPath = `assets/og-image${ext}`;
      const buffer = await fetchBuffer(tokens.ogImage);
      if (buffer && buffer.length > 5000) {
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url: tokens.ogImage, localPath, type: "image" });
      }
    } catch {
      /* skip */
    }
  }

  return assets;
}

/** Normalize URL for deduplication — unwrap Next.js image proxy, strip w/q params */
function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    if (parsed.pathname.includes("_next/image") && parsed.searchParams.has("url")) {
      return decodeURIComponent(parsed.searchParams.get("url")!);
    }
    parsed.searchParams.delete("w");
    parsed.searchParams.delete("q");
    parsed.searchParams.delete("dpr");
    return parsed.toString();
  } catch {
    return u;
  }
}

/**
 * Download fonts referenced in CSS and rewrite URLs to local paths.
 * Returns the modified CSS string with local font paths.
 */
export async function downloadAndRewriteFonts(css: string, outputDir: string): Promise<string> {
  const assetsDir = join(outputDir, "assets", "fonts");
  mkdirSync(assetsDir, { recursive: true });

  const fontUrlRegex = /url\(['"]?(https?:\/\/[^'")\s]+\.(?:woff2?|ttf|otf)[^'")\s]*?)['"]?\)/g;
  const fontUrls = new Set<string>();
  let match;
  while ((match = fontUrlRegex.exec(css)) !== null) {
    if (match[1]) fontUrls.add(match[1]);
  }

  if (fontUrls.size === 0) return css;

  let rewritten = css;
  let count = 0;

  for (const fontUrl of fontUrls) {
    try {
      const urlObj = new URL(fontUrl);
      const filename = urlObj.pathname.split("/").pop() || `font-${count}.woff2`;
      const localPath = join(assetsDir, filename);
      const relativePath = `assets/fonts/${filename}`;

      const buffer = await fetchBuffer(fontUrl);
      if (buffer) {
        writeFileSync(localPath, buffer);
        rewritten = rewritten.split(fontUrl).join(relativePath);
        count++;
      }
    } catch {
      /* skip */
    }
  }

  return rewritten;
}

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { "User-Agent": "HyperFrames/1.0" },
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}
