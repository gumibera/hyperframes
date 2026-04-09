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

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractHtml } from "./htmlExtractor.js";
// captureScreenshots removed — full-page screenshot replaces per-section shots
import { extractTokens } from "./tokenExtractor.js";
import { downloadAssets, downloadAndRewriteFonts } from "./assetDownloader.js";
// briefGenerator.ts, visual-style, capture-summary removed — DESIGN.md replaces them
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
  if (!opts.skipSplit) {
    mkdirSync(join(outputDir, "compositions"), { recursive: true });
  }

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
    const fullPageScreenshot = await captureFullPageScreenshot(page1, outputDir, url);
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

    // Detect JS libraries via globals and script URLs (Wappalyzer-style)
    let detectedLibraries: string[] = [];
    try {
      detectedLibraries = (await page1.evaluate(`(() => {
        var libs = [];
        if (typeof window.gsap !== 'undefined' || typeof window.TweenMax !== 'undefined') libs.push('GSAP');
        if (typeof window.ScrollTrigger !== 'undefined' || typeof window.gsap?.plugins?.scrollTrigger !== 'undefined') libs.push('ScrollTrigger');
        if (typeof window.THREE !== 'undefined') libs.push('Three.js');
        if (typeof window.PIXI !== 'undefined') libs.push('PixiJS');
        if (typeof window.BABYLON !== 'undefined') libs.push('Babylon.js');
        if (typeof window.Lottie !== 'undefined' || typeof window.lottie !== 'undefined') libs.push('Lottie');
        if (typeof window.__NEXT_DATA__ !== 'undefined') libs.push('Next.js');
        if (typeof window.__NUXT__ !== 'undefined') libs.push('Nuxt');
        // Also check script src URLs
        document.querySelectorAll('script[src]').forEach(function(s) {
          var src = s.src.toLowerCase();
          if (src.includes('gsap') || src.includes('tweenmax')) { if (libs.indexOf('GSAP') === -1) libs.push('GSAP'); }
          if (src.includes('scrolltrigger')) { if (libs.indexOf('ScrollTrigger') === -1) libs.push('ScrollTrigger'); }
          if (src.includes('three')) { if (libs.indexOf('Three.js') === -1) libs.push('Three.js'); }
          if (src.includes('pixi')) { if (libs.indexOf('PixiJS') === -1) libs.push('PixiJS'); }
          if (src.includes('lottie')) { if (libs.indexOf('Lottie') === -1) libs.push('Lottie'); }
          if (src.includes('framer-motion') || src.includes('motion')) { if (libs.indexOf('Framer Motion') === -1) libs.push('Framer Motion'); }
        });
        return libs;
      })()`)) as string[];
    } catch {
      // Non-blocking
    }

    // Extract all visible text in DOM order
    let visibleTextContent = "";
    try {
      visibleTextContent = (await page1.evaluate(`(() => {
        var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
        var texts = [];
        var node;
        while (node = walker.nextNode()) {
          var text = (node.textContent || '').trim();
          if (text.length < 3) continue;
          var el = node.parentElement;
          if (!el) continue;
          var style = getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;
          var tag = el.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;
          texts.push(text);
        }
        return texts.join('\\n');
      })()`)) as string;
      // Truncate to ~30K chars to avoid blowing up the prompt
      if (visibleTextContent.length > 30000) {
        visibleTextContent = visibleTextContent.slice(0, 30000) + "\n[...truncated]";
      }
    } catch {
      // Non-blocking
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

    // Collect font file paths (used by DESIGN.md generator)
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

    // Save visible text content for AI agent to use
    if (visibleTextContent) {
      writeFileSync(join(outputDir, "extracted", "visible-text.txt"), visibleTextContent, "utf-8");
    }

    // Save cataloged assets as JSON for AI agent
    if (catalogedAssets.length > 0) {
      writeFileSync(
        join(outputDir, "extracted", "assets-catalog.json"),
        JSON.stringify(catalogedAssets, null, 2),
        "utf-8",
      );
    }

    // Save detected libraries
    if (detectedLibraries.length > 0) {
      writeFileSync(
        join(outputDir, "extracted", "detected-libraries.json"),
        JSON.stringify(detectedLibraries, null, 2),
        "utf-8",
      );
    }

    // AI-powered generation (optional — only when API keys are set)
    const hasAiKey =
      process.env.ANTHROPIC_API_KEY ||
      process.env.CLAUDE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY;

    if (hasAiKey) {
      // Generate DESIGN.md via AI
      progress("design", "Generating DESIGN.md via AI...");
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
    } else {
      progress("design", "No AI API key — DESIGN.md will be generated by your AI agent");
      progress("design", "Open this folder in Claude Code or Cursor to get started");
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

    // Ensure capture output is a valid HyperFrames project (index.html + meta.json)
    const indexPath = join(outputDir, "index.html");
    const metaPath = join(outputDir, "meta.json");
    if (!existsSync(indexPath)) {
      writeFileSync(
        indexPath,
        `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #000; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="15" data-width="1920" data-height="1080">
      <!-- Add your compositions here -->
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`,
        "utf-8",
      );
    }
    if (!existsSync(metaPath)) {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      writeFileSync(
        metaPath,
        JSON.stringify({ id: hostname + "-video", name: tokens.title || hostname }, null, 2),
        "utf-8",
      );
    }

    // Generate CLAUDE.md + .cursorrules (AI agent instructions — always, regardless of API keys)
    try {
      const { generateAgentPrompt } = await import("./agentPromptGenerator.js");
      generateAgentPrompt(
        outputDir,
        url,
        tokens,
        animationCatalog,
        !!fullPageScreenshot,
        !!hasAiKey,
      );
      progress("agent", "CLAUDE.md generated");
    } catch (err) {
      warnings.push(`CLAUDE.md generation failed: ${err}`);
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

// visual-style.md and capture-summary.md generators removed — DESIGN.md replaces them
