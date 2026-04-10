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

    // Hook WebGL to capture shader source code (GLSL)
    // Captured shaders inform Claude Code about the site's visual effects
    // and enable reliable library detection (Three.js/PixiJS/Babylon.js uniforms survive bundling)
    await page1.evaluateOnNewDocument(`
      var origGetContext = HTMLCanvasElement.prototype.getContext;
      window.__capturedShaders = [];
      HTMLCanvasElement.prototype.getContext = function(type, attrs) {
        var ctx = origGetContext.call(this, type, attrs);
        if (ctx && (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl')) {
          if (ctx.shaderSource && !ctx.__hfHooked) {
            var origShaderSource = ctx.shaderSource.bind(ctx);
            ctx.shaderSource = function(shader, source) {
              try {
                var shaderType = ctx.getShaderParameter(shader, ctx.SHADER_TYPE);
                window.__capturedShaders.push({
                  type: shaderType === ctx.VERTEX_SHADER ? 'vertex' : 'fragment',
                  source: source.slice(0, 5000)
                });
              } catch(e) {}
              return origShaderSource(shader, source);
            };
            ctx.__hfHooked = true;
          }
        }
        return ctx;
      };
    `);

    // Intercept network responses to detect Lottie JSON files
    const discoveredLotties: Array<{
      url: string;
      data?: unknown;
      dimensions?: { w: number; h: number };
      frameRate?: number;
    }> = [];
    page1.on("response", async (response) => {
      try {
        const responseUrl = response.url();
        const contentType = response.headers()["content-type"] || "";
        const isJsonUrl = responseUrl.endsWith(".json");
        const isLottieUrl = responseUrl.endsWith(".lottie");
        const isJson =
          contentType.includes("application/json") || contentType.includes("text/plain");

        if (isLottieUrl) {
          discoveredLotties.push({ url: responseUrl });
          return;
        }

        if (isJsonUrl || isJson) {
          const buffer = await response.buffer();
          if (buffer.length < 100 || buffer.length > 5_000_000) return; // Skip tiny or huge
          const text = buffer.toString("utf-8");
          const json = JSON.parse(text);
          // Validate Lottie structure: must have version, in/out points, layers, dimensions, framerate
          if (
            json &&
            typeof json === "object" &&
            ["v", "ip", "op", "layers", "w", "h", "fr"].every((k: string) => k in json)
          ) {
            discoveredLotties.push({
              url: responseUrl,
              data: json,
              dimensions: { w: json.w, h: json.h },
              frameRate: json.fr,
            });
          }
        }
      } catch {
        /* not JSON or parse error — skip */
      }
    });

    await page1.goto(url, { waitUntil: "networkidle0", timeout });
    await new Promise((r) => setTimeout(r, settleTime));

    // Scroll through page to trigger lazy-loaded images and Lottie animations
    await page1.evaluate(`(async () => {
      var h = document.body.scrollHeight;
      for (var y = 0; y < h; y += window.innerHeight * 0.7) {
        window.scrollTo(0, y);
        await new Promise(function(r) { setTimeout(r, 300); });
      }
      window.scrollTo(0, 0);
      await new Promise(function(r) { setTimeout(r, 500); });
    })()`);

    await page1.evaluate(`window.scrollTo(0, 0)`);
    await new Promise((r) => setTimeout(r, 300));

    // Save discovered Lottie animations
    // Also scan DOM for Lottie web components not caught by network interception
    try {
      const domLotties = await page1.evaluate(`(() => {
        var urls = [];
        document.querySelectorAll('dotlottie-wc, lottie-player, dotlottie-player').forEach(function(el) {
          var src = el.getAttribute('src');
          if (src) urls.push(src);
        });
        // Also check lottie-web registered animations
        if (window.lottie && window.lottie.getRegisteredAnimations) {
          window.lottie.getRegisteredAnimations().forEach(function(anim) {
            if (anim.path) urls.push(anim.path);
          });
        }
        return urls;
      })()`);
      if (Array.isArray(domLotties)) {
        for (const lottieUrl of domLotties) {
          if (
            typeof lottieUrl === "string" &&
            !discoveredLotties.some((l) => l.url === lottieUrl)
          ) {
            discoveredLotties.push({ url: lottieUrl });
          }
        }
      }
    } catch {
      /* DOM scan failed — non-critical */
    }

    if (discoveredLotties.length > 0) {
      const lottieDir = join(outputDir, "assets", "lottie");
      mkdirSync(lottieDir, { recursive: true });
      let savedCount = 0;
      const savedHashes = new Set<string>(); // Deduplicate by content

      for (let li = 0; li < discoveredLotties.length && li < 10; li++) {
        const lottieItem = discoveredLotties[li]!;
        try {
          let jsonData: string | undefined;

          if (lottieItem.data) {
            // Already have the JSON data from network interception
            jsonData = JSON.stringify(lottieItem.data);
          } else if (lottieItem.url) {
            // Download the file
            const res = await fetch(lottieItem.url, {
              signal: AbortSignal.timeout(10000),
              headers: { "User-Agent": "HyperFrames/1.0" },
            });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());

            if (lottieItem.url.endsWith(".lottie")) {
              // dotLottie is a ZIP — extract the animation JSON
              try {
                const AdmZip = (await import("adm-zip")).default;
                const zip = new AdmZip(buf);
                const entries = zip.getEntries();
                // Look for animation JSON in both v1 (animations/) and v2 (a/) paths
                const animEntry = entries.find(
                  (e) =>
                    (e.entryName.startsWith("a/") || e.entryName.startsWith("animations/")) &&
                    e.entryName.endsWith(".json"),
                );
                if (animEntry) {
                  jsonData = animEntry.getData().toString("utf-8");
                }
              } catch {
                // adm-zip not available or extraction failed — save raw .lottie
                const hash = buf.toString("base64").slice(0, 100);
                if (savedHashes.has(hash)) continue;
                savedHashes.add(hash);
                writeFileSync(join(lottieDir, `animation-${savedCount}.lottie`), buf);
                savedCount++;
                continue;
              }
            } else {
              // Plain JSON file
              jsonData = buf.toString("utf-8");
            }
          }

          if (jsonData) {
            // Deduplicate by content hash (first 100 chars of stringified JSON)
            const hash = jsonData.slice(0, 200);
            if (savedHashes.has(hash)) continue;
            savedHashes.add(hash);

            // Validate it's actually Lottie
            try {
              const parsed = JSON.parse(jsonData);
              if (!parsed.layers || !parsed.w) continue;
            } catch {
              continue;
            }

            writeFileSync(join(lottieDir, `animation-${savedCount}.json`), jsonData, "utf-8");
            savedCount++;
          }
        } catch {
          /* skip */
        }
      }
      // Generate manifest + preview thumbnails so the agent can SEE what each animation is
      if (savedCount > 0) {
        const manifest: Array<{
          file: string;
          preview: string;
          name: string;
          width: number;
          height: number;
          duration: number;
          frameRate: number;
          layers: number;
        }> = [];
        const { readdirSync, readFileSync: readFs } = await import("node:fs");
        const previewDir = join(lottieDir, "previews");
        mkdirSync(previewDir, { recursive: true });

        for (const file of readdirSync(lottieDir)) {
          if (!file.endsWith(".json")) continue;
          try {
            const raw = JSON.parse(readFs(join(lottieDir, file), "utf-8"));
            const fr = raw.fr || 30;
            const dur = ((raw.op || 0) - (raw.ip || 0)) / fr;
            const previewName = file.replace(".json", "-preview.png");

            // Render a mid-frame thumbnail using Puppeteer + lottie-web
            try {
              const previewPage = await chromeBrowser.newPage();
              await previewPage.setViewport({ width: 400, height: 400 });
              const animJson = readFs(join(lottieDir, file), "utf-8");
              const midFrame = Math.floor(((raw.op || 0) - (raw.ip || 0)) * 0.3);
              await previewPage.setContent(
                `<!DOCTYPE html>
<html><head>
<script src="https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie.min.js"></script>
<style>*{margin:0;padding:0;background:transparent}#c{width:400px;height:400px}</style>
</head><body><div id="c"></div><script>
var a=lottie.loadAnimation({container:document.getElementById('c'),renderer:'svg',loop:false,autoplay:false,animationData:${animJson}});
a.addEventListener('DOMLoaded',function(){a.goToAndStop(${midFrame},true);window.__READY=true});
</script></body></html>`,
                { waitUntil: "networkidle0", timeout: 10000 },
              );
              await previewPage
                .waitForFunction(() => (window as any).__READY === true, { timeout: 5000 })
                .catch(() => {});
              await previewPage.screenshot({
                path: join(previewDir, previewName),
                type: "png",
                omitBackground: true,
              });
              await previewPage.close();
            } catch {
              /* preview rendering failed — non-critical */
            }

            manifest.push({
              file: `assets/lottie/${file}`,
              preview: `assets/lottie/previews/${previewName}`,
              name: raw.nm || file,
              width: raw.w || 0,
              height: raw.h || 0,
              duration: Math.round(dur * 10) / 10,
              frameRate: fr,
              layers: (raw.layers || []).length,
            });
          } catch {
            /* skip */
          }
        }
        if (manifest.length > 0) {
          writeFileSync(
            join(outputDir, "extracted", "lottie-manifest.json"),
            JSON.stringify(manifest, null, 2),
            "utf-8",
          );
        }
        progress("lottie", `${savedCount} Lottie animation(s) saved`);
      }
    }

    // Save captured WebGL shaders (useful context for shader transitions + library detection)
    try {
      const shaders = await page1.evaluate(`window.__capturedShaders || []`);
      if (Array.isArray(shaders) && shaders.length > 0) {
        const seen = new Set<string>();
        const unique = (shaders as Array<{ type: string; source: string }>).filter((s) => {
          if (seen.has(s.source)) return false;
          seen.add(s.source);
          return true;
        });
        writeFileSync(
          join(outputDir, "extracted", "shaders.json"),
          JSON.stringify(unique, null, 2),
          "utf-8",
        );
        progress("shaders", `${unique.length} WebGL shader(s) captured`);
      }
    } catch {
      /* shader extraction failed — non-critical */
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

    // Detect JS libraries via globals, DOM fingerprints, and script URLs
    let detectedLibraries: string[] = [];
    try {
      detectedLibraries = (await page1.evaluate(`(() => {
        var libs = [];
        function add(name) { if (libs.indexOf(name) === -1) libs.push(name); }

        // 1. Window globals (works for CDN-loaded / non-bundled libraries)
        if (typeof window.gsap !== 'undefined' || typeof window.TweenMax !== 'undefined') add('GSAP');
        if (typeof window.ScrollTrigger !== 'undefined') add('GSAP ScrollTrigger');
        if (typeof window.THREE !== 'undefined') add('Three.js');
        if (typeof window.PIXI !== 'undefined') add('PixiJS');
        if (typeof window.BABYLON !== 'undefined') add('Babylon.js');
        if (typeof window.Lottie !== 'undefined' || typeof window.lottie !== 'undefined') add('Lottie');
        if (typeof window.__NEXT_DATA__ !== 'undefined') add('Next.js');
        if (typeof window.__NUXT__ !== 'undefined') add('Nuxt');
        if (typeof window.Webflow !== 'undefined') add('Webflow');

        // 2. DOM fingerprints (survive bundling — most reliable for modern sites)
        // Three.js sets data-engine on every canvas it creates
        var threeCanvas = document.querySelector('canvas[data-engine*="three"]');
        if (threeCanvas) add('Three.js (' + (threeCanvas.getAttribute('data-engine') || '') + ')');
        // Babylon.js also sets data-engine
        var babylonCanvas = document.querySelector('canvas[data-engine*="Babylon"]');
        if (babylonCanvas) add('Babylon.js');
        // Lottie web components
        if (document.querySelector('dotlottie-wc, lottie-player, dotlottie-player')) add('Lottie');
        // Rive
        if (document.querySelector('canvas[class*="rive"], rive-canvas')) add('Rive');
        // React/Next.js
        if (document.getElementById('__next')) add('Next.js');
        if (document.getElementById('__nuxt')) add('Nuxt');
        if (document.querySelector('[data-reactroot], [data-react-helmet]')) add('React');
        // Svelte
        if (document.querySelector('[class*="svelte-"]')) add('Svelte');
        // Tailwind (utility class detection)
        if (document.querySelector('[class*="flex "], [class*="grid "], [class*="px-"], [class*="py-"]')) add('Tailwind CSS');
        // Framer Motion
        if (document.querySelector('[style*="--framer-"], [data-framer-component-type]')) add('Framer Motion');

        // 3. Script URL patterns
        document.querySelectorAll('script[src]').forEach(function(s) {
          var src = s.src.toLowerCase();
          if (src.includes('gsap') || src.includes('tweenmax') || src.includes('greensock')) add('GSAP');
          if (src.includes('scrolltrigger')) add('GSAP ScrollTrigger');
          if (src.includes('three.module') || src.includes('three.min')) add('Three.js');
          if (src.includes('pixi')) add('PixiJS');
          if (src.includes('lottie') || src.includes('bodymovin')) add('Lottie');
          if (src.includes('framer-motion')) add('Framer Motion');
          if (src.includes('anime.min') || src.includes('animejs')) add('Anime.js');
          if (src.includes('matter.min') || src.includes('matter-js')) add('Matter.js');
          if (src.includes('lenis')) add('Lenis (smooth scroll)');
        });

        return libs;
      })()`)) as string[];
    } catch {
      // Non-blocking
    }

    // 4. Shader fingerprinting — infer WebGL framework from captured GLSL
    try {
      const capturedShaders = await page1.evaluate(`window.__capturedShaders || []`);
      if (Array.isArray(capturedShaders) && capturedShaders.length > 0) {
        const allSource = (capturedShaders as Array<{ source: string }>)
          .map((s) => s.source)
          .join("\n");
        const add = (name: string) => {
          if (!detectedLibraries.includes(name)) detectedLibraries.push(name);
        };
        add("WebGL");
        // Three.js shader fingerprints (built-in uniforms that survive bundling)
        if (allSource.includes("modelViewMatrix") && allSource.includes("projectionMatrix"))
          add("Three.js (confirmed via shaders)");
        // PixiJS shader fingerprints
        else if (
          allSource.includes("vTextureCoord") &&
          allSource.includes("uSampler") &&
          !allSource.includes("modelViewMatrix")
        )
          add("PixiJS (confirmed via shaders)");
        // Babylon.js shader fingerprints
        else if (allSource.includes("viewProjection") && allSource.includes("world"))
          add("Babylon.js (confirmed via shaders)");
      }
    } catch {
      /* non-blocking */
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

    // Save extracted data (full HTML/CSS only needed for --split; skip to keep capture folder clean)
    if (!opts.skipSplit) {
      writeFileSync(join(outputDir, "extracted", "full-head.html"), extracted.headHtml, "utf-8");
      writeFileSync(join(outputDir, "extracted", "full-body.html"), extracted.bodyHtml, "utf-8");
      writeFileSync(join(outputDir, "extracted", "cssom.css"), extracted.cssomRules, "utf-8");
    }

    // Save animation catalog — lean version for the agent (not 745 raw CSS declarations)
    if (animationCatalog) {
      // Extract just what's useful: counts, named animations, a few representative keyframed entries
      const uniqueAnimNames = new Set<string>();
      for (const d of animationCatalog.cssDeclarations || []) {
        if (d.animation?.name) uniqueAnimNames.add(d.animation.name);
      }

      // Keep up to 10 Web Animations that have actual keyframe data (most useful for recreation)
      const representativeAnims = (animationCatalog.webAnimations || [])
        .filter((a) => a.keyframes && a.keyframes.length > 0)
        .slice(0, 10);

      const leanCatalog = {
        summary: animationCatalog.summary,
        namedAnimations: Array.from(uniqueAnimNames),
        scrollTriggeredElements: (animationCatalog.scrollTargets || []).length,
        representativeAnimations: representativeAnims,
      };

      writeFileSync(
        join(outputDir, "extracted", "animations.json"),
        JSON.stringify(leanCatalog, null, 2),
        "utf-8",
      );

      // Full raw catalog only when --split is used
      if (!opts.skipSplit) {
        writeFileSync(
          join(outputDir, "extracted", "animations-raw.json"),
          JSON.stringify(animationCatalog, null, 2),
          "utf-8",
        );
      }
    }

    // Download assets — single pass using the catalog for best image quality
    let assets: CaptureResult["assets"] = [];
    if (!skipAssets) {
      progress("assets", "Downloading assets...");
      assets = await downloadAssets(tokens, outputDir, catalogedAssets);
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
        discoveredLotties.length > 0,
        existsSync(join(outputDir, "extracted", "shaders.json")),
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
