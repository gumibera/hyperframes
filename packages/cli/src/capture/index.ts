/**
 * Website capture orchestrator.
 *
 * Two-pass capture approach:
 * Pass 1: Full page load (all JS) → catalog animations + snapshot canvases
 * Pass 2: Framework scripts blocked → extract stable HTML/CSS
 *
 * This ensures we get both:
 * - Rich animation metadata for Claude Code to recreate
 * - Stable, renderable HTML that won't crash in Puppeteer
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractHtml } from "./htmlExtractor.js";
// captureScreenshots removed — full-page screenshot replaces per-section shots
import { extractTokens } from "./tokenExtractor.js";
import { downloadAssets, downloadAndRewriteFonts } from "./assetDownloader.js";
import { generateCaptureBrief } from "./briefGenerator.js";
import {
  setupAnimationCapture,
  startCdpAnimationCapture,
  collectAnimationCatalog,
} from "./animationCataloger.js";
import type { CaptureOptions, CaptureResult } from "./types.js";

export type { CaptureOptions, CaptureResult } from "./types.js";

export async function captureWebsite(
  opts: CaptureOptions,
  onProgress?: (stage: string, detail?: string) => void,
): Promise<CaptureResult> {
  const {
    url,
    outputDir,
    viewportWidth = 1920,
    viewportHeight = 1080,
    timeout = 30000,
    settleTime = 3000,
    maxScreenshots: _maxScreenshots = 24,
    skipAssets = false,
  } = opts;

  const warnings: string[] = [];
  const progress = (stage: string, detail?: string) => {
    onProgress?.(stage, detail);
  };

  // Create output directories
  mkdirSync(join(outputDir, "extracted"), { recursive: true });
  mkdirSync(join(outputDir, "screenshots"), { recursive: true });
  mkdirSync(join(outputDir, "assets"), { recursive: true });
  mkdirSync(join(outputDir, "compositions"), { recursive: true });

  // Launch browser
  progress("browser", "Launching headless Chrome...");
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const puppeteer = await import("puppeteer-core");
  const chromeBrowser = await puppeteer.default.launch({
    headless: true,
    executablePath: browser.executablePath,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-blink-features=AutomationControlled",
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      `--window-size=${viewportWidth},${viewportHeight}`,
    ],
  });

  let animationCatalog: CaptureResult["animationCatalog"];

  try {
    // ═══════════════════════════════════════════════════════════════
    // PASS 1: Full page load — all JS runs
    // Goal: Catalog animations + take screenshots (with JS rendering)
    // ═══════════════════════════════════════════════════════════════

    progress("animations", "Cataloging animations (full JS)...");

    const page1 = await chromeBrowser.newPage();
    await page1.setViewport({ width: viewportWidth, height: viewportHeight });
    await page1.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );

    // Set up hooks BEFORE navigation
    await setupAnimationCapture(page1);
    const { cdp, animations: cdpAnims } = await startCdpAnimationCapture(page1);

    // Patch WebGL to preserve drawing buffer — allows canvas.toDataURL() later
    await page1.evaluateOnNewDocument(`
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          attrs = Object.assign({}, attrs || {}, { preserveDrawingBuffer: true });
        }
        return origGetContext.call(this, type, attrs);
      };
    `);

    await page1.goto(url, { waitUntil: "networkidle0", timeout });
    await new Promise((r) => setTimeout(r, settleTime));

    // Screenshot canvas elements using CDP captureScreenshot with clip
    // This captures from the compositor surface (includes WebGL content)
    // Must scroll each canvas into view, wait for Three.js render, then clip-capture
    let canvasCount = 0;
    const cdpCapture = await page1.createCDPSession();

    // First, scroll through to trigger lazy-loaded canvases
    await page1.evaluate(`(async () => {
      var h = document.body.scrollHeight;
      for (var y = 0; y < h; y += window.innerHeight * 0.7) {
        window.scrollTo(0, y);
        await new Promise(function(r) { setTimeout(r, 300); });
      }
      window.scrollTo(0, 0);
      await new Promise(function(r) { setTimeout(r, 500); });
    })()`);

    // Now capture each canvas
    const canvasEls = await page1.$$("canvas");
    for (const handle of canvasEls) {
      try {
        const box = await handle.boundingBox();
        if (!box || box.width < 50 || box.height < 50) continue;

        // Scroll canvas into view and wait for render
        await handle.evaluate(`((el) => el.scrollIntoView({ block: "center" }))`);
        await new Promise((r) => setTimeout(r, 500));

        // Get updated bounding box after scroll
        const box2 = await handle.boundingBox();
        if (!box2) continue;

        // CDP screenshot with clip — captures WebGL compositor surface
        const result = await cdpCapture.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          clip: {
            x: box2.x,
            y: box2.y,
            width: box2.width,
            height: box2.height,
            scale: 1,
          },
        });
        const buffer = Buffer.from(result.data, "base64");
        if (buffer.length > 1000) {
          const filename = `canvas-${canvasCount}.png`;
          writeFileSync(join(outputDir, "assets", filename), buffer);
          canvasCount++;
        }
      } catch {
        /* not visible or capture failed */
      }
    }

    await cdpCapture.detach();
    await page1.evaluate(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 300));
    if (canvasCount > 0) {
      progress("canvas", `${canvasCount} canvas screenshots saved`);
    }

    // Extract HTML + CSS (this scrolls the page for lazy loading)
    progress("extract", "Extracting HTML & CSS...");
    const extracted = await extractHtml(page1, { settleTime: 1000 });

    // Extract design tokens
    progress("tokens", "Extracting design tokens...");
    const tokens = await extractTokens(page1);
    writeFileSync(
      join(outputDir, "extracted", "tokens.json"),
      JSON.stringify(tokens, null, 2),
      "utf-8",
    );

    // Collect animation catalog (scrolls through page — must be after HTML extraction)
    progress("animations", "Cataloging animations...");
    animationCatalog = await collectAnimationCatalog(page1, cdpAnims, cdp);

    // Capture full-page screenshot (scrolls to trigger lazy loading, neutralizes sticky elements)
    progress("screenshots", "Capturing full-page screenshot...");
    const { captureFullPageScreenshot } = await import("./screenshotCapture.js");
    const fullPageScreenshot = await captureFullPageScreenshot(page1, outputDir);
    const screenshots: string[] = [];
    if (fullPageScreenshot) {
      screenshots.push(fullPageScreenshot);
    }

    // Strip framework scripts from the extracted body — keep visual library scripts
    // IMPORTANT: Use non-greedy matching within individual script tags only
    extracted.bodyHtml = extracted.bodyHtml
      // Remove __NEXT_DATA__ (has its own ID so safe to target)
      .replace(/<script\s+id="__NEXT_DATA__"[^>]*>[\s\S]*?<\/script>/gi, "")
      // Remove React hydration markers
      .replace(/\s*data-reactroot="[^"]*"/g, "")
      .replace(/\s*data-reactroot/g, "");

    // Remove Next.js bootstrap scripts individually (match each script tag separately)
    extracted.bodyHtml = extracted.bodyHtml.replace(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
      (match: string, content: string) => {
        // Only remove if this specific script contains Next.js bootstrap code
        if (
          content.includes("__next_f") ||
          content.includes("self.__next_f") ||
          content.includes("__NEXT_LOADED_PAGES__") ||
          content.includes("_N_E") ||
          content.includes("__NEXT_P")
        ) {
          return "";
        }
        return match;
      },
    );

    // Strip framework script tags from head (keep styles + visual library scripts)
    const FRAMEWORK_SRC_PATTERNS = [
      /_next\/static\/chunks\/(main|framework|webpack|pages\/)/,
      /_next\/static\/chunks\/app\//,
      /_buildManifest\.js/,
      /_ssgManifest\.js/,
    ];
    extracted.headHtml = extracted.headHtml.replace(
      /<script[^>]*src="([^"]*)"[^>]*><\/script>/gi,
      (match: string, src: string) => {
        if (FRAMEWORK_SRC_PATTERNS.some((p) => p.test(src))) return "";
        return match;
      },
    );

    // Catalog all assets with HTML contexts (before closing page)
    progress("design", "Cataloging assets...");
    let catalogedAssets: import("./assetCataloger.js").CatalogedAsset[] = [];
    try {
      const { catalogAssets } = await import("./assetCataloger.js");
      catalogedAssets = await catalogAssets(page1);
      progress("design", `${catalogedAssets.length} assets cataloged`);
    } catch (err) {
      warnings.push(`Asset cataloging failed: ${err}`);
    }

    await page1.close();

    // Download fonts and rewrite URLs to local paths
    extracted.headHtml = await downloadAndRewriteFonts(extracted.headHtml, outputDir);

    // Save extracted data
    writeFileSync(join(outputDir, "extracted", "full-head.html"), extracted.headHtml, "utf-8");
    writeFileSync(join(outputDir, "extracted", "full-body.html"), extracted.bodyHtml, "utf-8");
    writeFileSync(join(outputDir, "extracted", "cssom.css"), extracted.cssomRules, "utf-8");

    // Save animation catalog
    writeFileSync(
      join(outputDir, "extracted", "animations.json"),
      JSON.stringify(animationCatalog, null, 2),
      "utf-8",
    );

    // Download assets
    let assets: CaptureResult["assets"] = [];
    if (!skipAssets) {
      progress("assets", "Downloading assets...");
      assets = await downloadAssets(tokens, outputDir);
    }

    // Generate visual-style.md
    progress("style", "Generating visual style...");
    const visualStyle = generateVisualStyle(tokens, url);
    writeFileSync(join(outputDir, "visual-style.md"), visualStyle, "utf-8");

    // Generate capture-summary.md
    const summary = generateCaptureSummary(
      url,
      tokens,
      screenshots,
      assets,
      extracted,
      animationCatalog,
    );
    writeFileSync(join(outputDir, "capture-summary.md"), summary, "utf-8");

    // Generate capture-brief.md (prompt-ready design brief for AI)
    progress("brief", "Generating design brief...");
    // Collect font file paths from assets/fonts/ (already downloaded by downloadAndRewriteFonts)
    const fontsDir = join(outputDir, "assets", "fonts");
    let fontPaths: string[] = [];
    try {
      const { readdirSync } = await import("node:fs");
      fontPaths = readdirSync(fontsDir)
        .filter((f: string) => /\.(woff2?|ttf|otf)$/i.test(f))
        .map((f: string) => `assets/fonts/${f}`);
    } catch {
      /* no fonts dir */
    }
    const brief = generateCaptureBrief(
      url,
      tokens,
      animationCatalog,
      screenshots,
      assets,
      fontPaths,
    );
    writeFileSync(join(outputDir, "capture-brief.md"), brief, "utf-8");

    // Generate DESIGN.md (AI-powered if ANTHROPIC_API_KEY is set)
    progress("design", "Generating DESIGN.md...");
    try {
      const { generateDesignMd } = await import("./designMdGenerator.js");
      const designMd = await generateDesignMd(
        url,
        tokens,
        animationCatalog,
        screenshots,
        assets,
        fontPaths,
        outputDir,
        fullPageScreenshot,
        catalogedAssets,
      );
      writeFileSync(join(outputDir, "DESIGN.md"), designMd, "utf-8");
      progress("design", "DESIGN.md generated");
    } catch (err) {
      warnings.push(`DESIGN.md generation failed: ${err}`);
    }

    // Split into sections (if not skipped)
    let sections: CaptureResult["sections"];
    if (!opts.skipSplit) {
      progress("split", "Splitting into sections...");
      const { splitCapture } = await import("./splitter/index.js");
      const captureForSplit: CaptureResult = {
        ok: true,
        projectDir: outputDir,
        url,
        title: tokens.title,
        extracted,
        screenshots,
        tokens,
        assets,
        animationCatalog,
        warnings,
      };
      sections = await splitCapture(captureForSplit, opts.maxSections);
      progress("split", `${sections.length} sections created`);

      // Verify sections (if not skipped)
      if (!opts.skipVerify && sections.length > 0) {
        progress("verify", "Verifying sections...");
        const { verifyCapture } = await import("./verify/index.js");
        const verifyResult = await verifyCapture({ ...captureForSplit, sections }, (detail) =>
          progress("verify", detail),
        );
        progress(
          "verify",
          `${verifyResult.summary.passed} passed, ${verifyResult.summary.failed} failed`,
        );
      }

      // Purge unused CSS from section compositions
      progress("purge", "Purging unused CSS...");
      const { purgeCompositionCss } = await import("./cssPurger.js");
      const purgeResults = await purgeCompositionCss(join(outputDir, "compositions"), (detail) =>
        progress("purge", detail),
      );
      if (purgeResults.length > 0) {
        const totalBefore = purgeResults.reduce((s, r) => s + r.originalBytes, 0);
        const totalAfter = purgeResults.reduce((s, r) => s + r.purgedBytes, 0);
        const pct = (((totalBefore - totalAfter) / totalBefore) * 100).toFixed(0);
        progress(
          "purge",
          `${purgeResults.length} files purged (${(totalBefore / 1024).toFixed(0)} KB -> ${(totalAfter / 1024).toFixed(0)} KB, -${pct}%)`,
        );
      }
    }

    // Generate CLAUDE.md + .cursorrules (AI agent instructions)
    try {
      const { generateAgentPrompt } = await import("./agentPromptGenerator.js");
      generateAgentPrompt(
        outputDir,
        url,
        tokens,
        animationCatalog,
        !!fullPageScreenshot,
        true, // DESIGN.md is always generated
      );
    } catch {
      // Non-blocking
    }

    progress("done", "Capture complete");

    return {
      ok: true,
      projectDir: outputDir,
      url,
      title: tokens.title,
      extracted,
      screenshots,
      tokens,
      assets,
      sections,
      animationCatalog,
      warnings,
    };
  } finally {
    await chromeBrowser.close();
  }
}

// ── Generators ──────────────────────────────────────────────────────────────

function generateVisualStyle(tokens: CaptureResult["tokens"], url: string): string {
  return `---
name: "${tokens.title}"
source_url: "${url}"

style_prompt_short: >
  Visual style extracted from ${tokens.title}.

colors:
${tokens.colors
  .slice(0, 8)
  .map((c, i) => `  - hex: "${c}"\n    role: "color-${i}"`)
  .join("\n")}

typography:
  fonts: [${tokens.fonts.map((f) => `"${f}"`).join(", ")}]

mood:
  keywords: ["extracted", "website-captured"]
---
`;
}

function generateCaptureSummary(
  url: string,
  tokens: CaptureResult["tokens"],
  screenshots: string[],
  assets: CaptureResult["assets"],
  extracted: CaptureResult["extracted"],
  animations?: CaptureResult["animationCatalog"],
): string {
  const svgLogos = tokens.svgs.filter((s) => s.isLogo);

  return `# Capture Summary: ${tokens.title}
Source: ${url}
Captured: ${new Date().toISOString().split("T")[0]}

## Brand Identity
- **Fonts:** ${tokens.fonts.join(", ") || "system-ui"}
- **Colors:** ${tokens.colors.slice(0, 6).join(", ")}
- **SVG Logos:** ${svgLogos.length} found
- **Favicon:** ${tokens.icons.length > 0 ? "Yes" : "No"}

## Content
- **Title:** ${tokens.title}
- **Description:** ${tokens.description}
- **Headings:** ${tokens.headings.length} extracted
- **CTAs:** ${tokens.ctas.map((c) => `"${c.text}"`).join(", ")}

## Extracted HTML
- **Head CSS + Scripts:** ${Math.round(extracted.headHtml.length / 1024)} KB
- **Body HTML:** ${Math.round(extracted.bodyHtml.length / 1024)} KB
- **CSSOM CSS:** ${Math.round(extracted.cssomRules.length / 1024)} KB
- **Page height:** ${extracted.fullPageHeight}px
- **Viewport:** ${extracted.viewportWidth}x${extracted.viewportHeight}

## Animations Catalog
${
  animations
    ? `- **Web Animations:** ${animations.summary.webAnimations} (with keyframes)
- **CSS Declarations:** ${animations.summary.cssDeclarations} (animation/transition)
- **Scroll Targets:** ${animations.summary.scrollTargets} (IntersectionObserver)
- **CDP Events:** ${animations.summary.cdpAnimations}
- **Canvases:** ${animations.summary.canvases}
- **See:** extracted/animations.json for full keyframe data`
    : "Not captured"
}

## Screenshots
${screenshots.map((s) => `- ${s}`).join("\n")}

## Assets
${assets.map((a) => `- ${a.localPath} (${a.type})`).join("\n") || "None downloaded"}

## Sections Detected
${tokens.sections.map((s) => `- **${s.type}** at y=${s.y}: "${s.heading}" (${s.height}px)`).join("\n")}
`;
}
