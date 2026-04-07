/**
 * Generate CLAUDE.md (and .cursorrules) for captured website projects.
 *
 * This is the equivalent of Aura.build's auto-generated prompt that tells
 * the AI agent how to use the DESIGN.md and screenshot to create output.
 *
 * The file is placed at the project root so AI agents read it automatically:
 * - Claude Code reads CLAUDE.md
 * - Cursor reads .cursorrules
 * - Other agents typically read README.md or project-root markdown
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DesignTokens } from "./types.js";
import type { AnimationCatalog } from "./animationCataloger.js";

export function generateAgentPrompt(
  outputDir: string,
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  hasScreenshot: boolean,
  hasDesignMd: boolean,
): void {
  const prompt = buildPrompt(url, tokens, animations, hasScreenshot, hasDesignMd);

  // Write CLAUDE.md (Claude Code reads this automatically)
  writeFileSync(join(outputDir, "CLAUDE.md"), prompt, "utf-8");

  // Write .cursorrules (Cursor reads this automatically)
  writeFileSync(join(outputDir, ".cursorrules"), prompt, "utf-8");
}

function buildPrompt(
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  hasScreenshot: boolean,
  hasDesignMd: boolean,
): string {
  const hostname = new URL(url).hostname.replace(/^www\./, "");

  // Detect implementation cues from the source
  const cues = detectImplementationCues(tokens, animations);

  const _screenshotRef = hasScreenshot ? "screenshots/full-page.png" : null;

  // Build the main instruction block
  let md = `# ${tokens.title || hostname} — Captured Website

This project was captured from [${url}](${url}) using \`hyperframes capture\`.

## What's in this project

${hasDesignMd ? `- **DESIGN.md** — Complete design system (colors, typography, elevation, components, do's/don'ts, and every asset URL with its HTML context). **READ THIS FIRST.**` : ""}
${hasScreenshot ? `- **screenshots/full-page.png** — Full-page screenshot of the live website. **READ THIS IMAGE** as your primary visual reference.` : ""}
- **compositions/** — Extracted page sections as editable HyperFrames HTML compositions (CSS-purged, prettified, AI-readable).
- **assets/** — Downloaded fonts, logos, images, and favicon.
- **extracted/** — Raw HTML, CSS, and animation data from the source page.

## How to use this capture

`;

  if (hasScreenshot && hasDesignMd) {
    // BOTH screenshot and DESIGN.md available (best case — like Aura's Notion capture)
    md += `Treat the **full-page screenshot** as the primary visual reference. Use the **DESIGN.md** as the design-system and asset inventory reference. Use the **compositions/** as ready-made building blocks that can be used as-is or remixed.

If DESIGN.md conflicts with the screenshot on colors, surfaces, layout, or composition, **follow the screenshot**. Use DESIGN.md to preserve exact font families, font weights, typographic tone, asset URLs, and design tokens.

`;
  } else if (hasDesignMd) {
    // Only DESIGN.md (screenshot failed — like Aura's Soulscape capture)
    md += `Screenshot capture was not available. Use the **DESIGN.md** as both the design-system reference and the structural guide. Use the **compositions/** as the primary structural reference for the page layout and content.

Use the DESIGN.md to preserve exact design-system choices, asset references, colors, typography, and component patterns. Do not invent new design patterns — follow what's documented.

`;
  } else {
    md += `Use the **compositions/** as the primary reference for design and structure. Reference **assets/** for fonts, logos, and images.

`;
  }

  // Common instructions
  md += `Match the original texts, names, numbers, and brand references from the source site. Do not replace the captured design with generic defaults or a different house style.

`;

  // Detected implementation cues
  if (cues.length > 0) {
    md += `## Detected source implementation cues

These patterns were detected in the source and should be preserved:

`;
    for (const cue of cues) {
      md += `- ${cue}\n`;
    }
    md += "\n";
  }

  // HyperFrames-specific instructions
  md += `## Creating video compositions

This capture is designed for use with **HyperFrames** — an HTML-to-video framework. When creating video compositions:

1. Use \`/hyperframes-compose\` skill before writing any composition HTML
2. Reference the DESIGN.md for exact colors, fonts, and component styling
3. Use compositions from \`compositions/\` as background footage or extract individual components to remix
4. Reference assets by their URLs from the DESIGN.md Assets section
5. After creating or editing compositions, run \`npx hyperframes lint\` and \`npx hyperframes validate\`

### Quick start prompts

**15-second social ad:**
> Create a 15s social ad video using this captured website's design system. Use the DESIGN.md for brand colors, typography, and component styling. Create 4 scenes: Hook (4s), Features (5s), Social Proof (3s), CTA (3s).

**30-second product tour:**
> Create a 30s product tour video. Walk through the main sections of the captured website, highlighting key features. Use the exact screenshots and component patterns from the capture.

**Component remix video:**
> Extract individual UI components from the captured compositions and remix them into a new narrative. Change the text, rearrange the layout, combine elements from different sections.
`;

  return md;
}

function detectImplementationCues(
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
): string[] {
  const cues: string[] = [];

  // CSS custom properties
  if (Object.keys(tokens.cssVariables).length > 10) {
    cues.push(
      "The source uses CSS custom properties extensively. Preserve these design tokens for backgrounds, text, buttons, and spacing instead of using hardcoded values.",
    );
  }

  // Typography
  if (tokens.fonts.length > 0) {
    cues.push(
      `Typography is explicitly defined in the source (${tokens.fonts.join(", ")}). Match the original font families, weights, and headline/body hierarchy instead of defaulting to a system stack.`,
    );
  }

  // Animations
  if (animations?.summary) {
    if (animations.summary.scrollTargets > 20) {
      cues.push(
        `Scroll-triggered animations are present in the source (${animations.summary.scrollTargets} IntersectionObserver targets). Preserve scroll reveal behavior.`,
      );
    }
    if (animations.summary.webAnimations > 5) {
      cues.push(
        `Web Animations API is used extensively (${animations.summary.webAnimations} active animations). Preserve entrance and interaction animations.`,
      );
    }
    if (animations.summary.canvases > 0) {
      cues.push(
        `Canvas/WebGL elements detected (${animations.summary.canvases}). The source may use shader effects or 3D rendering.`,
      );
    }
  }

  // Marquee detection (from CSS or animation data)
  const hasMarquee = animations?.cssDeclarations?.some(
    (d) =>
      d.animation?.name?.toLowerCase().includes("marquee") ||
      d.animation?.name?.toLowerCase().includes("scroll"),
  );
  if (hasMarquee) {
    cues.push(
      "Marquee-style motion is present in the source. Preserve continuous horizontal scrolling behavior instead of replacing with a static section.",
    );
  }

  return cues;
}
