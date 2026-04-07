/**
 * Download assets (SVGs, images, favicon) from extracted tokens.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, extname } from "node:path";
import type { DesignTokens, DownloadedAsset } from "./types.js";

export async function downloadAssets(
  tokens: DesignTokens,
  outputDir: string,
): Promise<DownloadedAsset[]> {
  const assetsDir = join(outputDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const assets: DownloadedAsset[] = [];

  // 1. SVG logos — save as files
  const logoSvgs = tokens.svgs.filter((s) => s.isLogo);
  for (let i = 0; i < logoSvgs.length && i < 5; i++) {
    const svg = logoSvgs[i];
    const name = svg.label ? slugify(svg.label) + ".svg" : `logo-${i}.svg`;
    const localPath = `assets/${name}`;
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
        break; // Only need one favicon
      }
    } catch {
      /* skip */
    }
  }

  // 3. Key images (hero, large product images) — download first 5
  const importantImages = tokens.images
    .filter((img) => img.width > 400 && img.src.startsWith("http"))
    .slice(0, 5);

  for (let i = 0; i < importantImages.length; i++) {
    const img = importantImages[i];
    try {
      const url = new URL(img.src);
      const ext = extname(url.pathname) || ".jpg";
      const name = `image-${i}${ext}`;
      const localPath = `assets/${name}`;
      const buffer = await fetchBuffer(img.src);
      if (buffer) {
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url: img.src, localPath, type: "image" });
      }
    } catch {
      /* skip */
    }
  }

  // 4. OG image
  if (tokens.ogImage) {
    try {
      const ext = extname(new URL(tokens.ogImage).pathname) || ".jpg";
      const localPath = `assets/og-image${ext}`;
      const buffer = await fetchBuffer(tokens.ogImage);
      if (buffer) {
        writeFileSync(join(outputDir, localPath), buffer);
        assets.push({ url: tokens.ogImage, localPath, type: "image" });
      }
    } catch {
      /* skip */
    }
  }

  return assets;
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
    fontUrls.add(match[1]);
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
