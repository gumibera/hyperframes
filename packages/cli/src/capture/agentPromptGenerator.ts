/**
 * Generate CLAUDE.md (and .cursorrules) for captured website projects.
 *
 * This file generates a DATA INVENTORY that tells the AI agent what files
 * exist and what they contain. The actual workflow lives in the
 * /website-to-hyperframes skill — this file points agents there.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesignTokens } from "./types.js";
import type { AnimationCatalog } from "./animationCataloger.js";
import type { CatalogedAsset } from "./assetCataloger.js";

export function generateAgentPrompt(
  outputDir: string,
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  hasScreenshot: boolean,
  hasLottie?: boolean,
  hasShaders?: boolean,
  catalogedAssets?: CatalogedAsset[],
): void {
  const prompt = buildPrompt(
    url,
    tokens,
    animations,
    hasScreenshot,
    hasLottie,
    hasShaders,
    catalogedAssets,
  );
  writeFileSync(join(outputDir, "CLAUDE.md"), prompt, "utf-8");
  writeFileSync(join(outputDir, ".cursorrules"), prompt, "utf-8");
}

function buildPrompt(
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  hasScreenshot: boolean,
  hasLottie?: boolean,
  hasShaders?: boolean,
  catalogedAssets?: CatalogedAsset[],
): string {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const title = tokens.title || hostname;
  const cues = detectImplementationCues(tokens, animations);

  const colorSummary = tokens.colors.slice(0, 10).join(", ");
  const fontSummary = tokens.fonts.join(", ") || "none detected";
  const sectionCount = tokens.sections?.length ?? 0;
  const headingCount = tokens.headings?.length ?? 0;
  const ctaCount = tokens.ctas?.length ?? 0;

  const videoUrls = catalogedAssets
    ? catalogedAssets
        .filter((a) => a.type === "Video" && a.url.startsWith("http"))
        .map((a) => a.url)
        .filter((u, i, arr) => arr.indexOf(u) === i) // deduplicate
    : [];

  return `# ${title} — Captured Website

Source: ${url}

## How to Create a Video

Invoke the \`/website-to-hyperframes\` skill. It walks you through the full workflow: read data → create DESIGN.md → plan video → build compositions → lint/validate/preview.

If you don't have the skill installed, run: \`npx skills add heygen-com/hyperframes\`

## What's in This Capture

| File | Contents |
|------|----------|
${hasScreenshot ? "| `screenshots/scroll-*.png` | Viewport screenshots covering the full page (1920x1080 each, 30% overlap). **View scroll-000.png FIRST** (hero section), then scan through the rest to understand the full page. |" : ""}
| \`extracted/tokens.json\` | Design tokens: ${tokens.colors.length} colors, ${tokens.fonts.length} fonts, ${headingCount} headings, ${ctaCount} CTAs, ${sectionCount} sections |
| \`extracted/visible-text.txt\` | All visible text content in DOM order — use exact strings, never paraphrase |
| \`extracted/assets-catalog.json\` | Every asset URL (images, fonts, videos, icons) with HTML context |
| \`extracted/animations.json\` | Animation catalog: ${animations?.summary?.webAnimations ?? 0} web animations, ${animations?.summary?.scrollTargets ?? 0} scroll triggers, ${animations?.summary?.canvases ?? 0} canvases |
| \`assets/svgs/\` | Extracted inline SVGs (logos, icons, illustrations) |
| \`assets/\` | Downloaded images and font files — **Read every image file to see what it contains** |
${hasLottie ? "| `extracted/lottie-manifest.json` | Lottie animations found on this site — read this to see what animations are available (name, dimensions, duration). Embed via `lottie.loadAnimation({ path: 'assets/lottie/animation-0.json' })`. Do NOT read the raw JSON files — they are machine data. |" : ""}
${videoUrls.length > 0 ? "| `extracted/video-manifest.json` | Video manifest: every `<video>` element with its URL, surrounding heading/caption context, and a preview screenshot. **Read this + view each preview image** to understand what each video shows before using it. |" : ""}
${hasShaders ? "| `extracted/shaders.json` | Captured WebGL shader source code (GLSL vertex + fragment shaders) |" : ""}
| \`extracted/asset-descriptions.md\` | One-line description of every downloaded asset — read this first |

> **DESIGN.md does not exist yet.** It will be created when you run the \`/website-to-hyperframes\` workflow. Do not write compositions without it.

## Brand Summary

- **Colors**: ${colorSummary || "see tokens.json"}
- **Fonts**: ${fontSummary}
- **Sections**: ${sectionCount} page sections detected
- **Headings**: ${headingCount} headings extracted
- **CTAs**: ${ctaCount} calls-to-action found
${
  cues.length > 0
    ? `
## Source Patterns Detected

${cues.map((c) => `- ${c}`).join("\n")}
`
    : ""
}
## Example Prompts

Try asking:

- "Make me a 15-second social ad from this capture"
- "Create a 30-second product tour video"
- "Turn this into a vertical Instagram reel"
- "Build a feature announcement video highlighting the top 3 features"
`;
}

function detectImplementationCues(
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
): string[] {
  const cues: string[] = [];

  if (Object.keys(tokens.cssVariables).length > 10) {
    cues.push(
      "CSS custom properties used extensively — preserve design tokens for colors, spacing, and typography.",
    );
  }

  if (tokens.fonts.length > 0) {
    cues.push(
      `Typography: ${tokens.fonts.join(", ")}. Match these exact font families and weights.`,
    );
  }

  if (animations?.summary) {
    if (animations.summary.scrollTargets > 20) {
      cues.push(`${animations.summary.scrollTargets} scroll-triggered animations detected.`);
    }
    if (animations.summary.webAnimations > 5) {
      cues.push(`${animations.summary.webAnimations} active Web Animations detected.`);
    }
    if (animations.summary.canvases > 0) {
      cues.push(`${animations.summary.canvases} Canvas/WebGL elements detected.`);
    }
  }

  const hasMarquee = animations?.cssDeclarations?.some(
    (d) =>
      d.animation?.name?.toLowerCase().includes("marquee") ||
      d.animation?.name?.toLowerCase().includes("scroll"),
  );
  if (hasMarquee) {
    cues.push("Marquee/ticker animation present — preserve continuous scrolling behavior.");
  }

  return cues;
}
