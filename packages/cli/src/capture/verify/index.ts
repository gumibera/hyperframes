/**
 * Verify each sub-composition renders correctly.
 *
 * For each composition:
 * 1. Load in headless Chrome
 * 2. Screenshot what renders
 * 3. Check for blank/broken output
 * 4. Write verification report
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import type { SectionResult, CaptureResult } from "../types.js";

interface VerifyResult {
  sections: SectionVerification[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    fallback: number;
  };
}

interface SectionVerification {
  id: string;
  compositionPath: string;
  status: "passed" | "failed" | "fallback";
  errors: string[];
  /** Screenshot of the rendered section (relative path) */
  renderedScreenshot?: string;
  /** Matching viewport screenshot from capture */
  sourceScreenshot?: string;
  /** If fallback was applied, what type */
  fallbackType?: "screenshot-bg" | "none";
}

export async function verifyCapture(
  captureResult: CaptureResult,
  onProgress?: (detail: string) => void,
): Promise<VerifyResult> {
  const { projectDir, sections, screenshots } = captureResult;

  if (!sections || sections.length === 0) {
    return {
      sections: [],
      summary: { total: 0, passed: 0, failed: 0, fallback: 0 },
    };
  }

  const progress = (msg: string) => onProgress?.(msg);

  // Launch browser for verification
  const { ensureBrowser } = await import("../../browser/manager.js");
  const browser = await ensureBrowser();
  const puppeteer = await import("puppeteer-core");
  const chromeBrowser = await puppeteer.default.launch({
    headless: true,
    executablePath: browser.executablePath,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
    ],
  });

  // Start a minimal file server for the project
  const { createServer } = await import("node:http");
  const { extname } = await import("node:path");

  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
  };
  const getMimeType = (p: string) =>
    mimeTypes[extname(p).toLowerCase()] || "application/octet-stream";

  const server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? "/");
    const filePath = join(projectDir, url === "/" ? "index.html" : url);
    const rel = relative(projectDir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (existsSync(filePath)) {
      let content = readFileSync(filePath);
      let contentType = getMimeType(filePath);

      // For composition HTML files: unwrap <template> for standalone rendering
      if (filePath.endsWith(".html") && filePath.includes("compositions")) {
        let html = content.toString("utf-8");
        // Replace <template id="..."> with <div> and </template> with </div>
        // so the content actually renders in the browser
        html = html.replace(/<template\s+id="[^"]*">/gi, "<div>");
        html = html.replace(/<\/template>/gi, "</div>");
        // Wrap in a basic HTML document
        html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;padding:0;background:#000;width:1920px;height:1080px;overflow:hidden">${html}</body></html>`;
        content = Buffer.from(html, "utf-8");
      }

      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const port = await new Promise<number>((resolvePort) => {
    server.listen(0, () => {
      const addr = server.address();
      resolvePort(typeof addr === "object" && addr ? addr.port : 0);
    });
  });

  const results: SectionVerification[] = [];

  try {
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      if (!section) continue;
      progress(`Verifying ${section.id} (${i + 1}/${sections.length})`);

      const verification = await verifySection(
        chromeBrowser,
        port,
        section,
        projectDir,
        screenshots,
        i,
      );
      results.push(verification);
    }
  } finally {
    await chromeBrowser.close();
    server.close();
  }

  const summary = {
    total: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    failed: results.filter((r) => r.status === "failed").length,
    fallback: results.filter((r) => r.status === "fallback").length,
  };

  // Write report
  const report: VerifyResult = { sections: results, summary };
  writeFileSync(join(projectDir, "capture-report.json"), JSON.stringify(report, null, 2), "utf-8");

  // Update section results with verification status
  for (const r of results) {
    const section = sections.find((s) => s.id === r.id);
    if (section) {
      section.verified = r.status === "passed";
      section.fallback = r.status === "fallback" ? "screenshot" : "none";
      section.screenshotPath = r.sourceScreenshot;
    }
  }

  return report;
}

async function verifySection(
  browser: any,
  port: number,
  section: SectionResult,
  projectDir: string,
  screenshots: string[],
  index: number,
): Promise<SectionVerification> {
  const errors: string[] = [];
  const compositionUrl = `http://127.0.0.1:${port}/${section.compositionPath}`;

  // Find the best matching source screenshot for this section
  const sourceScreenshot = screenshots[Math.min(index, screenshots.length - 1)];

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  // Collect console errors
  page.on("console", (msg: any) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("Failed to load resource")) {
        errors.push(text.slice(0, 200));
      }
    }
  });

  page.on("pageerror", (err: any) => {
    errors.push(String(err).slice(0, 200));
  });

  try {
    await page.goto(compositionUrl, {
      waitUntil: "domcontentloaded",
      timeout: 10000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Take screenshot of rendered section
    const renderedPath = `screenshots/verify-${section.id}.png`;
    await page.screenshot({
      path: join(projectDir, renderedPath),
      type: "png",
    });

    // Force all elements visible (composition starts with opacity:0 for GSAP)
    await page.evaluate(`(() => {
      document.querySelectorAll('*').forEach(function(el) {
        var s = getComputedStyle(el);
        if (s.opacity === '0') el.style.opacity = '1';
        if (s.visibility === 'hidden') el.style.visibility = 'visible';
      });
    })()`);
    await new Promise((r) => setTimeout(r, 500));

    // Re-take screenshot with elements visible
    await page.screenshot({
      path: join(projectDir, renderedPath),
      type: "png",
    });

    // Check if the screenshot has actual visual content (not just black/white)
    // Use a simple pixel sampling approach via CDP
    const cdpSession = await page.createCDPSession();
    const screenshotResult = await cdpSession.send("Page.captureScreenshot", {
      format: "jpeg",
      quality: 10, // Low quality for fast analysis
      fromSurface: true,
    });
    await cdpSession.detach();

    const imgBuffer = Buffer.from(screenshotResult.data, "base64");
    // A mostly-black or mostly-white image will be very small at low quality
    const isVisuallyEmpty = imgBuffer.length < 2000;

    // Also check DOM content as secondary signal
    const pageInfo = (await page.evaluate(`(() => {
      var body = document.body || document.documentElement;
      var text = (body.innerText || '').trim();
      var imgs = document.querySelectorAll('img[src]').length;
      var svgs = document.querySelectorAll('svg').length;
      return {
        textLength: text.length,
        imageCount: imgs,
        svgCount: svgs,
        hasContent: text.length > 20 || imgs > 0 || svgs > 0,
      };
    })()`)) as { textLength: number; imageCount: number; svgCount: number; hasContent: boolean };

    await page.close();

    // Determine status — must have BOTH DOM content AND visual pixels
    if (isVisuallyEmpty && !pageInfo.hasContent) {
      errors.push("Section appears visually empty");
      return {
        id: section.id,
        compositionPath: section.compositionPath,
        status: "failed",
        errors,
        renderedScreenshot: renderedPath,
        sourceScreenshot,
      };
    }

    if (isVisuallyEmpty) {
      errors.push("Section has DOM content but renders as blank (CSS issue)");
      return {
        id: section.id,
        compositionPath: section.compositionPath,
        status: "failed",
        errors,
        renderedScreenshot: renderedPath,
        sourceScreenshot,
      };
    }

    return {
      id: section.id,
      compositionPath: section.compositionPath,
      status: errors.length > 3 ? "failed" : "passed",
      errors,
      renderedScreenshot: renderedPath,
      sourceScreenshot,
    };
  } catch (err) {
    errors.push(`Load failed: ${err}`);
    await page.close().catch(() => {});
    return {
      id: section.id,
      compositionPath: section.compositionPath,
      status: "failed",
      errors,
      sourceScreenshot,
    };
  }
}
