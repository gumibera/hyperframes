/**
 * Compare real Notion page vs our capture — find what's missing.
 * Run: npx tsx packages/cli/src/capture/_test_notion_compare.ts
 */

import puppeteer from "puppeteer-core";
import { readFileSync } from "node:fs";

async function main() {
  const { ensureBrowser } = await import("../browser/manager.js");
  const browser = await ensureBrowser();
  const b = await puppeteer.launch({
    headless: true,
    executablePath: browser.executablePath,
    args: ["--no-sandbox"],
  });
  const page = await b.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log("Loading notion.com...");
  await page.goto("https://www.notion.com", {
    waitUntil: "networkidle0",
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 5000));

  // Scroll through to trigger lazy loading
  await page.evaluate(`(async () => {
    var h = document.body.scrollHeight;
    for (var y = 0; y < h + 1000; y += 500) {
      window.scrollTo(0, y);
      await new Promise(function(r) { setTimeout(r, 300); });
    }
    window.scrollTo(0, 0);
    await new Promise(function(r) { setTimeout(r, 1000); });
  })()`);

  // Get the REAL page structure
  const realPage = await page.evaluate(`(() => {
    var sections = [];

    // Find all major sections
    document.querySelectorAll("section, main > div, [class*='section']").forEach(function(el) {
      var rect = el.getBoundingClientRect();
      if (rect.height < 100) return;
      var h = el.querySelector("h1, h2, h3");
      var heading = h ? h.textContent.trim().slice(0, 60) : "";
      if (!heading) return;

      // Count images in this section
      var imgs = el.querySelectorAll("img");
      var visibleImgs = Array.from(imgs).filter(function(img) {
        return img.offsetWidth > 0 && img.naturalWidth > 0;
      });
      var brokenImgs = Array.from(imgs).filter(function(img) {
        return img.offsetWidth > 0 && img.naturalWidth === 0;
      });

      // Count SVGs
      var svgs = el.querySelectorAll("svg");

      // Count videos
      var videos = el.querySelectorAll("video");

      // Count iframes
      var iframes = el.querySelectorAll("iframe");

      // Check for background images
      var bgImgs = 0;
      el.querySelectorAll("*").forEach(function(child) {
        var bg = getComputedStyle(child).backgroundImage;
        if (bg && bg !== "none" && !bg.includes("gradient")) bgImgs++;
      });

      sections.push({
        heading: heading,
        y: Math.round(rect.top + window.scrollY),
        height: Math.round(rect.height),
        totalImgs: imgs.length,
        visibleImgs: visibleImgs.length,
        brokenImgs: brokenImgs.length,
        svgCount: svgs.length,
        videoCount: videos.length,
        iframeCount: iframes.length,
        bgImgCount: bgImgs,
        // Sample image srcs
        imgSrcs: Array.from(visibleImgs).slice(0, 3).map(function(img) {
          return { src: img.src.slice(0, 80), w: img.naturalWidth, h: img.naturalHeight };
        }),
      });
    });

    // Deduplicate by heading
    var seen = {};
    sections = sections.filter(function(s) {
      if (seen[s.heading]) return false;
      seen[s.heading] = true;
      return true;
    });

    return {
      totalSections: sections.length,
      pageHeight: document.body.scrollHeight,
      totalImages: document.querySelectorAll("img").length,
      totalSvgs: document.querySelectorAll("svg").length,
      totalVideos: document.querySelectorAll("video").length,
      sections: sections,
    };
  })()`);

  console.log("\n=== REAL NOTION PAGE ===");
  console.log(`Page height: ${realPage.pageHeight}px`);
  console.log(`Total images: ${realPage.totalImages}`);
  console.log(`Total SVGs: ${realPage.totalSvgs}`);
  console.log(`Total videos: ${realPage.totalVideos}`);
  console.log(`\nSections (${realPage.totalSections}):`);

  for (const s of realPage.sections) {
    console.log(`\n  "${s.heading}"`);
    console.log(`    y=${s.y} h=${s.height}`);
    console.log(`    imgs: ${s.visibleImgs} visible, ${s.brokenImgs} broken, ${s.totalImgs} total`);
    console.log(
      `    svgs: ${s.svgCount}, videos: ${s.videoCount}, iframes: ${s.iframeCount}, bgImgs: ${s.bgImgCount}`,
    );
    if (s.imgSrcs.length > 0) {
      for (const img of s.imgSrcs) {
        console.log(`    → ${img.src} (${img.w}x${img.h})`);
      }
    }
  }

  // Now compare with our capture
  console.log("\n\n=== OUR CAPTURE ===");
  try {
    const tokens = JSON.parse(readFileSync("/tmp/notion-capture5/extracted/tokens.json", "utf-8"));
    console.log(`Captured sections: ${tokens.sections.length}`);
    for (const s of tokens.sections) {
      console.log(`  ${s.type}: "${s.heading}" y=${s.y}`);
    }
  } catch {
    console.log("Could not read capture data");
  }

  await b.close();
}

main().catch(console.error);
