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

  // Load .env file from repo root if it exists (for GEMINI_API_KEY, etc.)
  try {
    const { readFileSync: readEnv } = await import("node:fs");
    const { resolve: resolvePath } = await import("node:path");
    // Walk up from outputDir to find .env in repo root
    let dir = resolvePath(outputDir);
    for (let i = 0; i < 5; i++) {
      const envPath = resolvePath(dir, ".env");
      try {
        const envContent = readEnv(envPath, "utf-8");
        for (const line of envContent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          const eq = trimmed.indexOf("=");
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
          if (!process.env[key]) process.env[key] = val;
        }
        break;
      } catch {
        dir = resolvePath(dir, "..");
      }
    }
  } catch {
    /* .env loading is best-effort */
  }

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

    // Check if the page loaded real content or an anti-bot challenge
    const pageContentCheck = (await page1.evaluate(`(() => {
      var text = (document.body.innerText || "").trim();
      var title = document.title || "";
      var isChallenged = /cloudflare|just a moment|checking your browser|access denied|blocked|captcha|verify you are human/i.test(text + " " + title);
      return { textLength: text.length, title: title, isChallenged: isChallenged };
    })()`)) as { textLength: number; title: string; isChallenged: boolean };

    if (pageContentCheck.isChallenged || pageContentCheck.textLength < 200) {
      const reason = pageContentCheck.isChallenged
        ? "Anti-bot protection detected (Cloudflare challenge or similar)"
        : "Page has very little text content (" +
          pageContentCheck.textLength +
          " chars) — may be blocked or a client-rendered SPA that needs more time";
      warnings.push(reason);
      progress("warn", reason);
      // Write a BLOCKED.md file so the user/agent knows what happened
      writeFileSync(
        join(outputDir, "BLOCKED.md"),
        `# Capture Warning\n\n${reason}\n\nThe page at ${url} may not have been captured correctly.\n\n## What to try\n\n- Re-run with a longer timeout: \`--timeout 60000\`\n- The site may require authentication or block headless browsers\n- Try capturing from a different URL on the same domain\n`,
        "utf-8",
      );
    }

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
var a=lottie.loadAnimation({container:document.getElementById('c'),renderer:'svg',loop:false,autoplay:false,animationData:${animJson.replace(/</g, "\\u003c")}});
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

    // Capture scroll-position viewport screenshots (1920x1080 at 10 scroll depths)
    // These show the page in its natural state — sticky headers, scroll animations fired.
    progress("screenshots", "Capturing scroll screenshots...");
    const { captureScrollScreenshots } = await import("./screenshotCapture.js");
    const screenshots = await captureScrollScreenshots(page1, outputDir);
    progress("screenshots", `${screenshots.length} scroll screenshots captured`);

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

    // Generate video manifest — screenshot each <video> element + extract surrounding context
    // so Claude Code can SEE what each video shows and WHERE it was used on the page.
    try {
      const videoElements = (await page1.evaluate(`(() => {
        var videos = Array.from(document.querySelectorAll('video'));
        return videos.map(function(v) {
          var src = v.src || v.currentSrc || (v.querySelector('source') ? v.querySelector('source').src : '');
          if (!src || !src.startsWith('http')) return null;

          // Get bounding box for screenshot
          var rect = v.getBoundingClientRect();
          if (rect.width < 10 || rect.height < 10) return null;

          // Nearest heading above the video
          var heading = '';
          var el = v;
          for (var i = 0; i < 8; i++) {
            el = el.parentElement;
            if (!el) break;
            var h = el.querySelector('h1,h2,h3,h4');
            if (h) { heading = h.textContent.trim().slice(0, 100); break; }
          }

          // Nearest paragraph/caption text
          var caption = '';
          el = v;
          for (var j = 0; j < 5; j++) {
            el = el.parentElement;
            if (!el) break;
            var p = el.querySelector('p,figcaption,[class*="caption"],[class*="desc"]');
            if (p) { caption = p.textContent.trim().slice(0, 200); break; }
          }

          // aria-label on video or wrapper
          var ariaLabel = v.getAttribute('aria-label') || v.getAttribute('title') || '';
          var wrapper = v.parentElement;
          if (!ariaLabel && wrapper) ariaLabel = wrapper.getAttribute('aria-label') || '';

          return {
            src: src,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            heading: heading,
            caption: caption,
            ariaLabel: ariaLabel,
            filename: src.split('/').pop().split('?')[0],
          };
        }).filter(Boolean);
      })`)) as Array<{
        src: string;
        width: number;
        height: number;
        top: number;
        left: number;
        heading: string;
        caption: string;
        ariaLabel: string;
        filename: string;
      }>;

      // Deduplicate by src
      const seenSrcs = new Set<string>();
      const uniqueVideos = videoElements.filter((v) => {
        if (seenSrcs.has(v.src)) return false;
        seenSrcs.add(v.src);
        return true;
      });

      if (uniqueVideos.length > 0) {
        const videoManifestDir = join(outputDir, "assets", "videos");
        mkdirSync(videoManifestDir, { recursive: true });
        const previewDir = join(videoManifestDir, "previews");
        mkdirSync(previewDir, { recursive: true });

        const videoManifest: Array<{
          index: number;
          url: string;
          filename: string;
          width: number;
          height: number;
          heading: string;
          caption: string;
          ariaLabel: string;
          preview: string;
        }> = [];

        for (let vi = 0; vi < uniqueVideos.length && vi < 20; vi++) {
          const v = uniqueVideos[vi]!;
          const previewName = `video-${vi}-preview.png`;
          const previewPath = join(previewDir, previewName);

          // Screenshot the video element to get a visible frame
          try {
            // Scroll to the video element so it's in the viewport
            await page1.evaluate(`window.scrollTo(0, ${Math.max(0, v.top - 100)})`);
            await new Promise((r) => setTimeout(r, 300));
            // Re-measure position after scroll (layout may have shifted)
            const rect = (await page1.evaluate((fn) => {
              const vid = [...document.querySelectorAll("video")].find((x) =>
                (x.src || x.currentSrc || "").includes(fn),
              );
              if (!vid) return null;
              // Seek to 0.1s and wait for a frame to decode
              vid.currentTime = 0.1;
              return vid.getBoundingClientRect().toJSON();
            }, v.filename)) as { x: number; y: number; width: number; height: number } | null;
            if (!rect || rect.width < 10) continue;
            await new Promise((r) => setTimeout(r, 200)); // let decoder settle
            await page1.screenshot({
              path: previewPath,
              clip: {
                x: Math.max(0, rect.x),
                y: Math.max(0, rect.y),
                width: Math.min(rect.width, 1920),
                height: Math.min(rect.height, 1080),
              },
            });
          } catch {
            /* preview failed — non-critical */
          }

          videoManifest.push({
            index: vi,
            url: v.src,
            filename: v.filename,
            width: v.width,
            height: v.height,
            heading: v.heading,
            caption: v.caption,
            ariaLabel: v.ariaLabel,
            preview: `assets/videos/previews/${previewName}`,
          });
        }

        if (videoManifest.length > 0) {
          writeFileSync(
            join(outputDir, "extracted", "video-manifest.json"),
            JSON.stringify(videoManifest, null, 2),
            "utf-8",
          );
          progress("design", `${videoManifest.length} video previews captured`);
        }
      }
    } catch {
      /* non-blocking — video manifest is best-effort */
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

    // AI-powered image captioning via Gemini (optional — enriches asset descriptions)
    const geminiCaptions: Record<string, string> = {};
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (geminiKey) {
      progress("design", "Captioning images with Gemini vision...");
      try {
        const { GoogleGenAI } = await import("@google/genai");
        const { readFileSync: readAssetFile, readdirSync: listAssetDir } = await import("node:fs");
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const imageFiles = listAssetDir(join(outputDir, "assets")).filter((f: string) =>
          /\.(png|jpg|jpeg|webp|gif)$/i.test(f),
        );

        // Caption in parallel batches via Gemini vision API.
        // Rate limits vary by tier: free = 5 RPM, paid = 1000+ RPM.
        // We batch 5 at a time with a 12s pause — safe for free tier, fast for paid.
        const model = "gemini-2.5-flash";
        const BATCH_SIZE = 5;
        for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
          const batch = imageFiles.slice(i, i + BATCH_SIZE);
          const results = await Promise.allSettled(
            batch.map(async (file: string) => {
              const filePath = join(outputDir, "assets", file);
              const buffer = readAssetFile(filePath);
              const base64 = buffer.toString("base64");
              const ext = file.split(".").pop()?.toLowerCase() || "png";
              const mimeType = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
              const response = await ai.models.generateContent({
                model,
                contents: [
                  {
                    role: "user",
                    parts: [
                      { inlineData: { mimeType, data: base64 } },
                      {
                        text: "Describe this website image in ONE short sentence for a video storyboard. Focus on: what it shows, dominant colors, whether background is light or dark. Be factual, not creative.",
                      },
                    ],
                  },
                ],
                config: { maxOutputTokens: 300 },
              });
              return { file, caption: response.text?.trim() || "" };
            }),
          );
          for (const result of results) {
            if (result.status === "fulfilled" && result.value.caption) {
              geminiCaptions[result.value.file] = result.value.caption;
            }
          }
          // Pace requests to stay under free tier rate limits (5 RPM for gemini-2.5-flash)
          if (i + BATCH_SIZE < imageFiles.length) {
            await new Promise((r) => setTimeout(r, 12000)); // 12s between batches of 5 ≈ 25 RPM (safe for free tier)
          }
          progress(
            "design",
            `Captioned ${Math.min(i + BATCH_SIZE, imageFiles.length)}/${imageFiles.length} images...`,
          );
        }
        progress("design", `${Object.keys(geminiCaptions).length} images captioned with Gemini`);
      } catch (err) {
        warnings.push(`Gemini captioning failed: ${err}`);
      }
    }

    // Generate asset descriptions for the AI agent
    progress("design", "Generating asset descriptions...");
    try {
      const { readdirSync, statSync } = await import("node:fs");
      const lines: string[] = [];

      // Describe downloaded images
      const assetsPath = join(outputDir, "assets");
      try {
        for (const file of readdirSync(assetsPath)) {
          if (file === "svgs" || file === "fonts" || file === "lottie" || file === "videos")
            continue;
          const filePath = join(assetsPath, file);
          const stat = statSync(filePath);
          if (!stat.isFile()) continue;
          const sizeKb = Math.round(stat.size / 1024);
          // Find context from cataloged assets
          const catalogMatch = catalogedAssets.find(
            (a) =>
              a.url && file.includes(a.url.split("/").pop()?.split("?")[0]?.slice(0, 20) || "___"),
          );
          // Build rich description from catalog context
          const desc = catalogMatch?.description || catalogMatch?.notes || "";
          const heading = catalogMatch?.nearestHeading || "";
          const section = catalogMatch?.sectionClasses || "";
          const aboveFold = catalogMatch?.aboveFold ? "above fold" : "";
          // No brightness analysis — Gemini captions handle this when available
          // Gemini vision caption (highest quality — available when GEMINI_API_KEY is set)
          const geminiCaption = geminiCaptions[file];
          // Derive a meaningful name from the filename
          const cleanName = file.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
          const parts = [`${file} — ${sizeKb}KB`];
          if (geminiCaption) {
            // Gemini gives the best description — use it as primary
            parts.push(geminiCaption);
          } else {
            // Fallback: DOM context
            if (desc) parts.push(`"${desc.slice(0, 80)}"`);
            if (heading) parts.push(`section: "${heading.slice(0, 60)}"`);
            else if (section) parts.push(`in: ${section.split(" ").slice(0, 3).join(" ")}`);
            if (aboveFold) parts.push(aboveFold);
            if (!desc && !heading) parts.push(cleanName);
          }
          lines.push(parts.join(", "));
        }
      } catch {
        /* no assets dir */
      }

      // Describe SVGs
      try {
        const svgsPath = join(assetsPath, "svgs");
        for (const file of readdirSync(svgsPath)) {
          if (!file.endsWith(".svg")) continue;
          const svgMatch = tokens.svgs.find(
            (s) =>
              s.label &&
              file.includes(
                s.label
                  .toLowerCase()
                  .replace(/[^a-z0-9]/g, "-")
                  .slice(0, 15),
              ),
          );
          const label = svgMatch?.label || file.replace(".svg", "").replace(/-/g, " ");
          const isLogo = svgMatch?.isLogo || file.includes("logo");
          lines.push(`svgs/${file} — ${isLogo ? "logo: " : "icon: "}${label}`);
        }
      } catch {
        /* no svgs dir */
      }

      // Describe fonts
      try {
        const fontsPath = join(assetsPath, "fonts");
        for (const file of readdirSync(fontsPath)) {
          lines.push(`fonts/${file} — font file`);
        }
      } catch {
        /* no fonts dir */
      }

      if (lines.length > 0) {
        writeFileSync(
          join(outputDir, "extracted", "asset-descriptions.md"),
          "# Asset Descriptions\n\nOne line per file. Read this instead of opening every image individually.\n\n" +
            lines.map((l) => "- " + l).join("\n") +
            "\n",
          "utf-8",
        );
        progress("design", `${lines.length} asset descriptions written`);
      }
    } catch {
      /* non-critical */
    }

    progress("design", "DESIGN.md will be created by your AI agent");

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
    <!-- Root composition wrapper — AGENT: update data-duration to match total video length -->
    <div data-composition-id="main" data-width="1920" data-height="1080" data-start="0" data-duration="28">

      <!-- SCENE SLOTS — AGENT: adjust count, durations, and IDs to match your scene plan -->
      <div id="scene-1" data-composition-src="compositions/scene-1.html" data-start="0" data-duration="7" data-track-index="1" data-width="1920" data-height="1080"></div>
      <div id="scene-2" data-composition-src="compositions/scene-2.html" data-start="7" data-duration="7" data-track-index="1" data-width="1920" data-height="1080"></div>
      <div id="scene-3" data-composition-src="compositions/scene-3.html" data-start="14" data-duration="7" data-track-index="1" data-width="1920" data-height="1080"></div>
      <div id="scene-4" data-composition-src="compositions/scene-4.html" data-start="21" data-duration="7" data-track-index="1" data-width="1920" data-height="1080"></div>

      <!-- NARRATION — AGENT: update src after generating TTS -->
      <audio id="narration" data-start="0" data-duration="28" data-track-index="0" data-volume="1" src="narration.wav"></audio>

      <!-- CAPTIONS (optional — only add if user requests captions/subtitles) -->

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
        screenshots.length > 0,
        discoveredLotties.length > 0,
        existsSync(join(outputDir, "extracted", "shaders.json")),
        catalogedAssets,
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
