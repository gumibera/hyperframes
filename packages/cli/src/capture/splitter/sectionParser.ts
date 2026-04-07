/**
 * Parse body HTML into semantic sections.
 *
 * Identifies section boundaries using:
 * 1. <section> elements
 * 2. Direct children of <main>
 * 3. <header>, <footer>, <nav> elements
 * 4. Detected sections from the token extractor (with Y positions)
 */

import { parseHTML } from "linkedom";
import type { DesignTokens } from "../types.js";

export interface ParsedSection {
  /** Unique identifier (kebab-case) */
  id: string;
  /** Section type from token detection */
  type: string;
  /** Heading text (if any) */
  heading: string;
  /** The section's outerHTML */
  html: string;
  /** Approximate Y position on original page */
  y: number;
  /** Section height */
  height: number;
  /** Y offset of parent element (for sub-sections split from a larger parent) */
  parentY?: number;
  /** All class names used in this section (for CSS subsetting) */
  classNames: Set<string>;
  /** All IDs used in this section */
  elementIds: Set<string>;
  /** All tag names used */
  tagNames: Set<string>;
  /** Computed background color */
  backgroundColor: string;
}

export function parseSections(
  bodyHtml: string,
  tokenSections: DesignTokens["sections"],
  maxSections: number = 12,
): ParsedSection[] {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
  const body = document.body;

  // Strategy: find top-level semantic containers
  const candidates: Element[] = [];

  // 1. <section> elements (direct or one level deep)
  body.querySelectorAll("section").forEach((el: Element) => {
    candidates.push(el);
  });

  // 2. <header>, <nav>, <footer>
  body.querySelectorAll("header, nav, footer").forEach((el: Element) => {
    if (!candidates.includes(el)) candidates.push(el);
  });

  // 3. Direct children of <main>
  const main = body.querySelector("main");
  if (main) {
    Array.from(main.children).forEach((child) => {
      if (child.tagName !== "SCRIPT" && child.tagName !== "STYLE" && !candidates.includes(child)) {
        candidates.push(child);
      }
    });
  }

  // 4. If we found very few candidates, try direct body children
  if (candidates.length < 3) {
    Array.from(body.children).forEach((child) => {
      if (
        child.tagName !== "SCRIPT" &&
        child.tagName !== "STYLE" &&
        child.tagName !== "NOSCRIPT" &&
        child.innerHTML.length > 200 &&
        !candidates.includes(child)
      ) {
        candidates.push(child);
      }
    });
  }

  // Deduplicate: remove children of other candidates
  const filtered = candidates.filter((el) => {
    return !candidates.some((other) => other !== el && other.contains(el));
  });

  // Expand oversized sections: returns {el, token?} pairs where token override
  // is set for sub-sections split from a large parent.
  const expanded = expandOversizedSections(filtered, tokenSections, document);

  // Build sections from candidates
  const sections: ParsedSection[] = [];
  let sectionIndex = 0;

  for (const entry of expanded) {
    if (sections.length >= maxSections) break;

    const el = entry.el;
    const html = el.outerHTML;
    if (html.length < 100) continue;

    // Use token override if provided (for split sub-sections), else detect from DOM
    let heading: string;
    let type: string;
    let y: number;
    let height: number;
    let backgroundColor: string;

    // For sub-sections split from a parent, find the parent's Y by looking at the
    // first entry that shares this same element.
    let parentY: number | undefined;
    if (entry.token) {
      heading = entry.token.heading;
      type = entry.token.type;
      y = entry.token.y;
      height = entry.token.height;
      backgroundColor = entry.token.backgroundColor || "#ffffff";
      // Find the parent Y (first token for this element)
      const firstForEl = expanded.find((e) => e.el === el);
      if (firstForEl?.token && firstForEl.token.y !== y) {
        parentY = firstForEl.token.y;
      }
    } else {
      const headingEl = el.querySelector("h1, h2, h3, h4");
      heading = headingEl?.textContent?.trim().slice(0, 80) || "";

      const tokenMatch = tokenSections.find((ts) => {
        if (heading && ts.heading) {
          return (
            heading.includes(ts.heading.slice(0, 30)) || ts.heading.includes(heading.slice(0, 30))
          );
        }
        return false;
      });

      type = tokenMatch?.type || classifyElement(el);
      y = tokenMatch?.y || 0;
      height = tokenMatch?.height || 0;
      backgroundColor = tokenMatch?.backgroundColor || "#ffffff";
    }

    const classNames = new Set<string>();
    const elementIds = new Set<string>();
    const tagNames = new Set<string>();
    collectSelectors(el, classNames, elementIds, tagNames);

    const id = generateSectionId(type, heading, sectionIndex);
    sectionIndex++;

    sections.push({
      id,
      type,
      heading,
      html,
      y,
      height,
      parentY,
      classNames,
      elementIds,
      tagNames,
      backgroundColor,
    });
  }

  return sections;
}

type ExpandedEntry = { el: Element; token?: DesignTokens["sections"][0] };

/**
 * If a DOM section is large and contains multiple token-identified sub-sections,
 * return the SAME parent element once per sub-section with different token overrides.
 * compositionGen uses the token's Y offset to "scroll" to the right part of the HTML.
 */
function expandOversizedSections(
  elements: Element[],
  tokenSections: DesignTokens["sections"],
  _document: Document,
): ExpandedEntry[] {
  const result: ExpandedEntry[] = [];

  for (const el of elements) {
    const headingEl = el.querySelector("h1, h2, h3, h4");
    const heading = headingEl?.textContent?.trim().slice(0, 80) || "";

    const matchingTokens = tokenSections.filter((ts) => {
      if (!ts.heading) return false;
      return heading.includes(ts.heading.slice(0, 30)) || ts.heading.includes(heading.slice(0, 30));
    });

    const myToken = matchingTokens[0];
    if (!myToken) {
      result.push({ el });
      continue;
    }

    // Find token sections that are INSIDE this element's Y range but don't match its heading
    const containedTokens = tokenSections.filter((ts) => {
      if (!ts.heading || ts.heading === myToken.heading) return false;
      return ts.y >= myToken.y && ts.y < myToken.y + myToken.height;
    });

    if (containedTokens.length < 2) {
      result.push({ el });
      continue;
    }

    // Build the full list sorted by Y, then fix heights so each sub-section
    // only covers its own portion (not the entire parent).
    const allTokens = [myToken, ...containedTokens].sort((a, b) => a.y - b.y);
    for (let i = 0; i < allTokens.length; i++) {
      const t = allTokens[i]!;
      const nextY = i + 1 < allTokens.length ? allTokens[i + 1]!.y : myToken.y + myToken.height;
      result.push({ el, token: { ...t, height: nextY - t.y } });
    }
  }

  return result;
}

function classifyElement(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const classes = (el.className || "").toString().toLowerCase();

  if (tag === "header" || tag === "nav") return "header";
  if (tag === "footer") return "footer";
  if (classes.includes("hero")) return "hero";
  if (classes.includes("feature") || classes.includes("bento")) return "features";
  if (classes.includes("testimonial") || classes.includes("quote")) return "testimonials";
  if (classes.includes("logo") || classes.includes("customer")) return "logos";
  if (classes.includes("cta") || classes.includes("pricing")) return "cta";
  return "content";
}

function generateSectionId(type: string, heading: string, index: number): string {
  if (heading) {
    const slug = heading
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 30);
    return `section-${slug}`;
  }
  return `section-${type}-${index}`;
}

function collectSelectors(
  el: Element,
  classNames: Set<string>,
  elementIds: Set<string>,
  tagNames: Set<string>,
): void {
  tagNames.add(el.tagName.toLowerCase());

  if (el.id) elementIds.add(el.id);

  if (el.className && typeof el.className === "string") {
    el.className.split(/\s+/).forEach((cls: string) => {
      if (cls) classNames.add(cls);
    });
  }

  // Recurse into children (limit depth to avoid performance issues)
  const children = el.children;
  for (let i = 0; i < children.length && i < 500; i++) {
    const child = children[i];
    if (child) collectSelectors(child, classNames, elementIds, tagNames);
  }
}
