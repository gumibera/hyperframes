import { parseHTML } from "linkedom";
import { CANONICAL_FONTS, FONT_ALIASES, GENERIC_FAMILIES } from "./catalog.js";
import { FONT_DATA } from "./generated/font-data.js";

/**
 * Build a lookup from importName → FontMeta for fast access.
 */
const FONT_BY_IMPORT_NAME = new Map(CANONICAL_FONTS.map((f) => [f.importName, f]));

function normalizeFamilyName(family: string): string {
  return family
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .trim()
    .toLowerCase();
}

function extractExistingFontFaces(html: string): Set<string> {
  const families = new Set<string>();
  const fontFaceRegex = /@font-face\s*\{[\s\S]*?font-family\s*:\s*([^;]+);[\s\S]*?\}/gi;
  for (const match of html.matchAll(fontFaceRegex)) {
    const raw = match[1] || "";
    const normalized = normalizeFamilyName(raw);
    if (normalized) {
      families.add(normalized);
    }
  }
  return families;
}

function extractRequestedFontFamilies(html: string): Map<string, string> {
  const requested = new Map<string, string>();
  const addFamilyList = (value: string) => {
    for (const family of value.split(",")) {
      const originalCase = family
        .trim()
        .replace(/^['"]|['"]$/g, "")
        .trim();
      const normalized = originalCase.toLowerCase();
      if (!normalized || GENERIC_FAMILIES.has(normalized)) {
        continue;
      }
      if (!requested.has(normalized)) {
        requested.set(normalized, originalCase);
      }
    }
  };

  const fontFamilyRegex = /font-family\s*:\s*([^;}{]+)[;}]?/gi;
  for (const match of html.matchAll(fontFamilyRegex)) {
    addFamilyList(match[1] || "");
  }

  const dataFontFamilyRegex = /data-font-family=["']([^"']+)["']/gi;
  for (const match of html.matchAll(dataFontFamilyRegex)) {
    addFamilyList(match[1] || "");
  }

  return requested;
}

function fontDataUri(importName: string, weight: number): string | undefined {
  const key = `${importName}:${weight}`;
  return FONT_DATA[key];
}

function buildFontFaceCss(requestedFamilies: Map<string, string>): {
  css: string;
  unresolved: string[];
} {
  const rules: string[] = [];
  const unresolved: string[] = [];

  for (const [normalizedFamily, originalCaseFamily] of requestedFamilies) {
    const canonicalKey = FONT_ALIASES[normalizedFamily];
    if (!canonicalKey) {
      unresolved.push(originalCaseFamily);
      continue;
    }

    const canonical = FONT_BY_IMPORT_NAME.get(canonicalKey);
    if (!canonical) continue;

    for (const weight of canonical.weights) {
      const src = fontDataUri(canonical.importName, weight);
      if (!src) continue;

      rules.push(
        [
          "@font-face {",
          `  font-family: "${originalCaseFamily}";`,
          `  src: url("${src}") format("woff2");`,
          `  font-style: normal;`,
          `  font-weight: ${weight};`,
          "  font-display: block;",
          "}",
        ].join("\n"),
      );
    }
  }

  return {
    css: rules.join("\n\n").trim(),
    unresolved: unresolved.sort(),
  };
}

export function injectDeterministicFontFaces(html: string): string {
  const existingFaces = extractExistingFontFaces(html);
  const requestedFamilies = extractRequestedFontFamilies(html);
  const pendingFamilies = new Map<string, string>();

  for (const [normalizedFamily, originalCaseFamily] of requestedFamilies) {
    if (!existingFaces.has(normalizedFamily)) {
      pendingFamilies.set(normalizedFamily, originalCaseFamily);
    }
  }

  if (pendingFamilies.size === 0) {
    return html;
  }

  const { css, unresolved } = buildFontFaceCss(pendingFamilies);
  if (!css) {
    if (unresolved.length > 0) {
      console.warn(`[Compiler] No deterministic font mapping for: ${unresolved.join(", ")}`);
    }
    return html;
  }

  const { document } = parseHTML(html);
  const head = document.querySelector("head");
  if (!head) {
    return html;
  }

  const styleEl = document.createElement("style");
  styleEl.setAttribute("data-hyperframes-deterministic-fonts", "true");
  styleEl.textContent = css;
  head.insertBefore(styleEl, head.firstChild);

  console.log(
    `[Compiler] Injected deterministic @font-face rules for ${pendingFamilies.size - unresolved.length} requested font families`,
  );
  if (unresolved.length > 0) {
    console.warn(`[Compiler] Unresolved font families left dynamic: ${unresolved.join(", ")}`);
  }

  return document.toString();
}
