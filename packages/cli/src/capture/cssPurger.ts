/**
 * Purge unused CSS from captured HyperFrames compositions.
 *
 * Captured sections carry the source site's entire CSS framework,
 * but each section only uses a fraction. This strips unused rules
 * via PurgeCSS (two-pass: selectors first, then variables) to produce
 * files small enough for AI agents to read and edit.
 */

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export interface PurgeResult {
  file: string;
  originalBytes: number;
  purgedBytes: number;
}

export async function purgeCompositionCss(
  compositionsDir: string,
  onProgress?: (detail: string) => void,
): Promise<PurgeResult[]> {
  let PurgeCSS: typeof import("purgecss").PurgeCSS;
  try {
    const mod = await import("purgecss");
    PurgeCSS = mod.PurgeCSS;
  } catch {
    onProgress?.("purgecss not installed, skipping CSS purge");
    return [];
  }

  const files = readdirSync(compositionsDir).filter(
    (f) => f.startsWith("section-") && f.endsWith(".html"),
  );

  if (files.length === 0) return [];

  const results: PurgeResult[] = [];

  for (const file of files) {
    const filePath = join(compositionsDir, file);
    const html = readFileSync(filePath, "utf-8");
    const originalBytes = Buffer.byteLength(html, "utf-8");

    const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
    let allCss = "";
    let match;
    while ((match = styleRegex.exec(html)) !== null) {
      allCss += match[1] + "\n";
    }

    if (!allCss.trim()) {
      results.push({ file, originalBytes, purgedBytes: originalBytes });
      continue;
    }

    const htmlContent = html.replace(styleRegex, "");

    // Pass 1: Remove unused selectors, keep all CSS variables
    const pass1 = await new PurgeCSS().purge({
      content: [{ raw: htmlContent, extension: "html" }],
      css: [{ raw: allCss }],
      variables: false,
      keyframes: true,
      fontFace: true,
      safelist: { greedy: [/^data-/] },
    });

    const css1 = pass1[0]?.css || "";

    // Pass 2: Purge CSS variables not referenced by surviving rules
    const pass2 = await new PurgeCSS().purge({
      content: [{ raw: htmlContent + "\n" + css1, extension: "html" }],
      css: [{ raw: css1 }],
      variables: true,
      keyframes: false,
      fontFace: false,
    });

    let purgedCss = pass2[0]?.css || "";

    for (let i = 0; i < 5; i++) {
      purgedCss = purgedCss
        .replace(/@layer\s+[\w-]+\s*\{\s*\}/g, "")
        .replace(/@media[^{]*\{\s*\}/g, "")
        .replace(/@supports[^{]*\{\s*\}/g, "")
        .replace(/:root\s*\{\s*\}/g, "")
        .replace(/\n{3,}/g, "\n\n");
    }

    const firstStyleStart = html.search(/<style[^>]*>/i);
    const lastStyleEnd = html.lastIndexOf("</style>") + "</style>".length;

    const beforeStyles = html.substring(0, firstStyleStart);
    const afterStyles = html.substring(lastStyleEnd);

    let purgedHtml = beforeStyles + "<style>\n" + purgedCss + "\n</style>" + afterStyles;

    // Prettify HTML so AI agents can read/navigate individual elements
    try {
      const prettier = await import("prettier");
      purgedHtml = await prettier.format(purgedHtml, {
        parser: "html",
        printWidth: 120,
        tabWidth: 2,
        htmlWhitespaceSensitivity: "ignore",
      });
    } catch {
      // prettier not installed — still write the purged (unprettified) version
    }

    const purgedBytes = Buffer.byteLength(purgedHtml, "utf-8");

    writeFileSync(filePath, purgedHtml);

    const reduction = (((originalBytes - purgedBytes) / originalBytes) * 100).toFixed(0);
    onProgress?.(
      `Purged ${file} (${(originalBytes / 1024).toFixed(0)} KB -> ${(purgedBytes / 1024).toFixed(0)} KB, -${reduction}%)`,
    );

    results.push({ file, originalBytes, purgedBytes });
  }

  return results;
}
