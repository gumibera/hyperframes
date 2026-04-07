/**
 * AI-powered DESIGN.md generator.
 *
 * Feeds captured website data (tokens, animations, screenshots, structure)
 * to Claude and lets the LLM write a rich, opinionated design system document
 * — the same way Aura.build / Google Stitch produce DESIGN.md files.
 */

import type { DesignTokens, DownloadedAsset } from "./types.js";
import type { AnimationCatalog } from "./animationCataloger.js";
import type { CatalogedAsset } from "./assetCataloger.js";
import { readFileSync } from "node:fs";

export async function generateDesignMd(
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  screenshots: string[],
  assets: DownloadedAsset[],
  fontPaths: string[],
  outputDir: string,
  fullPageScreenshot?: string,
  catalogedAssets?: CatalogedAsset[],
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;

  if (!apiKey) {
    return generateFallbackDesignMd(
      url,
      tokens,
      animations,
      assets,
      fontPaths,
      screenshots,
      fullPageScreenshot,
    );
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { join } = await import("node:path");
  const client = new Anthropic({ apiKey });

  const context = buildContext(
    url,
    tokens,
    animations,
    assets,
    fontPaths,
    screenshots,
    fullPageScreenshot,
  );

  // Build message content with screenshots as vision input
  const contentParts: Array<
    | {
        type: "text";
        text: string;
      }
    | {
        type: "image";
        source: {
          type: "base64";
          media_type: "image/png";
          data: string;
        };
      }
  > = [];

  // Send the full-page screenshot if available, otherwise first 4 section screenshots
  const screenshotsToSend = fullPageScreenshot ? [fullPageScreenshot] : screenshots.slice(0, 4);

  for (const screenshotPath of screenshotsToSend) {
    try {
      const absPath = join(outputDir, screenshotPath);
      const imgData = readFileSync(absPath);
      if (imgData.length > 5 * 1024 * 1024) continue;
      const base64 = imgData.toString("base64");
      contentParts.push({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/png" as const,
          data: base64,
        },
      });
    } catch {
      // Screenshot not readable, skip
    }
  }

  contentParts.push({
    type: "text" as const,
    text: context,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: contentParts,
      },
    ],
    system: SYSTEM_PROMPT,
  });

  // Extract text from response
  let aiText = "";
  for (const block of response.content) {
    if (block.type === "text") {
      aiText += block.text;
    }
  }

  if (!aiText) {
    return generateFallbackDesignMd(
      url,
      tokens,
      animations,
      assets,
      fontPaths,
      screenshots,
      fullPageScreenshot,
    );
  }

  // Append programmatic Assets section
  const { formatAssetCatalog } = await import("./assetCataloger.js");
  const assetsSection =
    catalogedAssets && catalogedAssets.length > 0
      ? formatAssetCatalog(catalogedAssets)
      : assets.map((a) => `- **${a.type}**: ${a.localPath}`).join("\n") + "\n";

  return aiText + "\n\n## Assets\n" + assetsSection;
}

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You produce DESIGN.md files from website data. A DESIGN.md encodes a complete visual design system so AI agents can generate on-brand output.

You will receive:
- Screenshots of the website (viewport sections or full-page)
- Extracted data: colors, fonts, headings, CTAs, CSS variables, page sections, animations

You produce ONLY the following sections. The Assets section will be appended programmatically — do NOT generate it.

# Design System

## Overview
3-4 sentences. Describe the visual identity factually. Look at the screenshots and identify:
- Named layout patterns visible (e.g., "Bento grid" if cards are in modular grid, "Logo Wall" if company logos are scrolling)
- Brand mascots or character illustrations visible in the screenshots (name them if recognizable)
- Color strategy (e.g., "predominantly monochrome with functional color pops")
- Typography tone (e.g., "sophisticated yet approachable")
Be precise and factual, not poetic.

## Colors
### Brand & Neutral
Use standard color naming (Gray 200, Gray 600, Primary Black — not creative names like "Deep Space Navy"). List 5-7 key colors with hex values and their actual UI usage:
- **Role Name**: \`#hex\` (Where it's used in the UI)

### Semantic Palette (Themed Sections)
If the site uses color to differentiate product areas or features, list each theme color with what it maps to.

## Typography
List each font family with its design role, available weights, and usage:
- **Primary Sans-Serif**: \`FontName\`, \`fallback\`. Weights: 400, 500, 600, 700. Used for headings, body, and UI.
- **Serif Accent**: \`FontName\`. Used for blockquotes and editorial headers.
- **Monospace**: \`FontName\`. Used for technical callouts.
- **Stylized Accent**: \`FontName\`. Used for annotations (if detected).

Include a Sizing Hierarchy subsection with the actual sizes found in the data.

## Elevation
Describe the depth strategy factually: Does the site use borders, shadows, glassmorphism, or flat color shifts? Reference specific CSS tokens if provided (e.g., border-radius values, shadow values).

## Components
Look at the screenshots and data to identify the actual UI components. Name them specifically (e.g., "Bento Grid" not "Cards", "Pricing Calculator" not "Form", "Logo Wall" not "Images", "Featured Testimonial" not "Quote"). For each component, describe its structure, border-radius, spacing, and any distinctive visual treatment. Reference CSS token names when available.

## Do's and Don'ts
- **Do**: 3-5 rules derived from what the site actually does (reference specific design patterns)
- **Don't**: 3-5 rules derived from what the site avoids (reference specific anti-patterns observed)

RULES:
- Be FACTUAL, not creative. Describe what you see, don't invent narratives.
- Use the EXACT hex values, font names, and pixel sizes from the data.
- Name components by their actual names found in class names or content.
- Reference real content (heading text, CTA text, company names in testimonials).
- Do NOT include an Assets section — it will be appended programmatically.
- Keep it under 2000 words.
- Output ONLY the markdown — no preamble, no explanation.`;

// ── Context builder ──────────────────────────────────────────────────────────

function buildContext(
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  assets: DownloadedAsset[],
  fontPaths: string[],
  screenshots: string[],
  fullPageScreenshot?: string,
): string {
  const sections = tokens.sections;

  let ctx = `Generate a DESIGN.md for this website.

URL: ${url}
Title: ${tokens.title}
Description: ${tokens.description}

COLORS (extracted from page):
${tokens.colors
  .slice(0, 15)
  .map((c) => `  ${c}`)
  .join("\n")}

SECTION BACKGROUNDS:
${sections.map((s) => `  ${s.type}: ${s.heading || "(no heading)"} — bg: ${s.backgroundColor || "none"}`).join("\n")}

FONTS (from computed styles):
${tokens.fonts.join(", ") || "system fonts"}

FONT FAMILIES (from @font-face CSS rules — you MUST mention ALL of these in Typography):
${
  [
    ...new Set(
      fontPaths
        .map((p) => {
          const name = p.split("/").pop() || "";
          return name
            .replace(
              /-(Regular|Bold|Medium|SemiBold|Italic|BoldItalic|MediumItalic|SemiBoldItalic|i18n|Light).*$/i,
              "",
            )
            .replace(/\./g, "");
        })
        .filter(Boolean),
    ),
  ].join(", ") || "none"
}
NOTE: "permanent-marker" = "Permanent Marker" (handwritten/annotation font). Include it as a Stylized Accent font.

FONT FILES (local):
${fontPaths.length > 0 ? fontPaths.join("\n") : "none"}

HEADINGS:
${tokens.headings.map((h) => `  h${h.level}: "${h.text}" — ${h.fontSize} ${h.fontWeight} ${h.color}`).join("\n")}

CTAs:
${tokens.ctas.map((c) => `  "${c.text}"${c.href ? ` → ${c.href}` : ""}`).join("\n")}

PAGE SECTIONS (${sections.length} total):
${sections.map((s, i) => `  ${i + 1}. [${s.type}] "${s.heading}" at y=${s.y} (${s.height}px) — bg: ${s.backgroundColor || "none"}`).join("\n")}

CSS CUSTOM PROPERTIES (${Object.keys(tokens.cssVariables).length} total — showing all color/font/spacing/radius/shadow tokens):
${Object.entries(tokens.cssVariables)
  .filter(([k]) => /color|font|spacing|radius|shadow|border|gap|padding|margin|size/i.test(k))
  .slice(0, 100)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join("\n")}
`;

  // Animation data
  if (animations?.summary) {
    ctx += `
ANIMATIONS:
  Web Animations: ${animations.summary.webAnimations}
  CSS Declarations: ${animations.summary.cssDeclarations}
  Scroll Targets: ${animations.summary.scrollTargets}
  CDP Animations: ${animations.summary.cdpAnimations}
  Canvases: ${animations.summary.canvases}
`;
  }

  if (animations?.webAnimations && animations.webAnimations.length > 0) {
    const sample = animations.webAnimations.slice(0, 5);
    ctx += `\nSAMPLE WEB ANIMATIONS:\n`;
    sample.forEach((a) => {
      const easing = a.timing?.easing || "?";
      const duration = a.timing?.duration || "?";
      ctx += `  ${a.targetSelector || "element"}: easing=${easing}, duration=${duration}ms\n`;
    });
  }

  // Assets
  ctx += `\nASSETS:\n`;
  assets.forEach((a) => {
    ctx += `  ${a.localPath} (${a.type})\n`;
  });

  // Screenshots
  if (fullPageScreenshot) {
    ctx += `\nFULL-PAGE SCREENSHOT: ${fullPageScreenshot} (attached as image above — USE THIS as your primary visual reference)\n`;
  }
  if (screenshots.length > 0) {
    ctx += `\nSECTION SCREENSHOTS:\n`;
    screenshots.forEach((s) => (ctx += `  ${s}\n`));
  }

  // Paragraphs (sample)
  if (tokens.paragraphs.length > 0) {
    ctx += `\nSAMPLE PARAGRAPHS:\n`;
    tokens.paragraphs.slice(0, 5).forEach((p) => {
      ctx += `  "${p.slice(0, 150)}"\n`;
    });
  }

  // Distinctive CSS class name patterns (helps identify named components)
  // Extract from CSS variable names that hint at component architecture
  const allVarNames = Object.keys(tokens.cssVariables);
  const componentHints = allVarNames
    .filter((k) => /--([\w]+-[\w]+)/.test(k))
    .map((k) => k.replace(/^--/, "").split("-").slice(0, 2).join("-"))
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 30);
  if (componentHints.length > 0) {
    ctx += `\nCSS DESIGN TOKEN PREFIXES (hint at component naming):\n  ${componentHints.join(", ")}\n`;
  }

  // SVG labels (often reveal brand characters and icons)
  if (tokens.svgs.length > 0) {
    const svgLabels = tokens.svgs
      .filter((s) => s.label)
      .map((s) => s.label)
      .slice(0, 10);
    if (svgLabels.length > 0) {
      ctx += `\nSVG LABELS (icons and brand elements):\n  ${svgLabels.join(", ")}\n`;
    }
  }

  return ctx;
}

// ── Fallback (no API key) ────────────────────────────────────────────────────

function generateFallbackDesignMd(
  url: string,
  tokens: DesignTokens,
  _animations: AnimationCatalog | undefined,
  assets: DownloadedAsset[],
  fontPaths: string[],
  screenshots: string[],
  fullPageScreenshot?: string,
): string {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const sections = tokens.sections.filter((s) => s.heading);

  return `# Design System

## Overview
Design system extracted from ${tokens.title} (${hostname}). Set ANTHROPIC_API_KEY to generate a rich, AI-written design system analysis.

${tokens.description}

## Colors
${tokens.colors
  .slice(0, 10)
  .map((c, i) => `- **Color ${i}**: \`${c}\``)
  .join("\n")}

## Typography
${tokens.fonts.map((f, i) => `- **${f}** — ${i === 0 ? "Primary" : "Secondary"} font`).join("\n")}

### Hierarchy
${tokens.headings
  .slice(0, 6)
  .map((h) => `- h${h.level}: ${h.fontSize}/${h.fontWeight} — "${h.text.slice(0, 50)}"`)
  .join("\n")}

${fontPaths.length > 0 ? `### Local Font Files\n${fontPaths.map((p) => `- \`${p}\``).join("\n")}` : ""}

## Assets
${fullPageScreenshot ? `### Full-Page Screenshot\n- \`${fullPageScreenshot}\`\n` : ""}
### Section Screenshots
${screenshots.map((s) => `- \`${s}\``).join("\n")}

### Downloaded
${assets.map((a) => `- \`${a.localPath}\` (${a.type})`).join("\n")}

## HyperFrames-Specific
### Composition Templates
- **15s Social Ad**: ${sections
    .slice(0, 4)
    .map((s) => s.heading.slice(0, 25) || s.type)
    .join(" → ")}
- **Full Showcase (${sections.length * 5}s)**: All ${sections.length} sections × 5s each

---
*Set ANTHROPIC_API_KEY environment variable to generate a full AI-written design system analysis.*
`;
}
