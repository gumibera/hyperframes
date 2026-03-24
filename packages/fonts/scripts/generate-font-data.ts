#!/usr/bin/env tsx
/**
 * Build-time script that reads woff2 font files from @fontsource/* packages,
 * base64-encodes them, and writes a generated TypeScript module with data URIs.
 *
 * Usage:
 *   tsx scripts/generate-font-data.ts
 *   pnpm generate
 */

import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Import the canonical fonts catalog from source
import { CANONICAL_FONTS } from "../src/catalog.js";

const require = createRequire(import.meta.url);
const scriptDir = dirname(fileURLToPath(import.meta.url));
const generatedDir = join(scriptDir, "..", "src", "generated");

function resolvePackageRoot(packageName: string): string {
  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`);
    return dirname(packageJsonPath);
  } catch {
    throw new Error(
      `Could not resolve ${packageName}. Make sure it is installed (run "bun install" or "pnpm install").`,
    );
  }
}

function resolveWoff2File(packageName: string, slug: string, weight: number): string {
  const root = resolvePackageRoot(packageName);
  const filesDir = join(root, "files");

  let files: string[];
  try {
    files = readdirSync(filesDir);
  } catch {
    throw new Error(`Could not read files directory for ${packageName} at ${filesDir}`);
  }

  // Try exact match first
  const exact = `${slug}-latin-${weight}-normal.woff2`;
  if (files.includes(exact)) {
    return join(filesDir, exact);
  }

  // Relaxed match: any file containing "-latin-" and ending with the weight pattern
  const relaxed = files.find(
    (file) => file.endsWith(`-${weight}-normal.woff2`) && file.includes("-latin-"),
  );
  if (relaxed) {
    return join(filesDir, relaxed);
  }

  throw new Error(
    `No woff2 font file found for ${packageName} weight=${weight}. ` +
      `Looked for "${exact}" in ${filesDir}. ` +
      `Available files: ${files.filter((f) => f.endsWith(".woff2")).join(", ")}`,
  );
}

function main() {
  console.log("[generate-font-data] Starting font data generation...");

  const entries: Array<{ key: string; dataUri: string }> = [];
  let totalBytes = 0;

  for (const font of CANONICAL_FONTS) {
    const slug = font.fontsourcePackage.replace("@fontsource/", "");

    for (const weight of font.weights) {
      const filePath = resolveWoff2File(font.fontsourcePackage, slug, weight);
      const content = readFileSync(filePath);
      const dataUri = `data:font/woff2;base64,${content.toString("base64")}`;
      const key = `${font.importName}:${weight}`;

      entries.push({ key, dataUri });
      totalBytes += content.byteLength;

      console.log(`  ${key} → ${(content.byteLength / 1024).toFixed(1)} KB`);
    }
  }

  // Build the output file
  const lines = [
    "/**",
    " * AUTO-GENERATED — do not edit manually.",
    " * Run `pnpm generate` (or `tsx scripts/generate-font-data.ts`) to regenerate.",
    " */",
    "export const FONT_DATA: Record<string, string> = {",
  ];

  for (const { key, dataUri } of entries) {
    lines.push(`  "${key}": "${dataUri}",`);
  }

  lines.push("};");
  lines.push("");

  mkdirSync(generatedDir, { recursive: true });
  const outputPath = join(generatedDir, "font-data.ts");
  writeFileSync(outputPath, lines.join("\n"), "utf-8");

  console.log(
    `[generate-font-data] Wrote ${entries.length} font entries ` +
      `(${(totalBytes / 1024 / 1024).toFixed(2)} MB total) → ${outputPath}`,
  );
}

main();
