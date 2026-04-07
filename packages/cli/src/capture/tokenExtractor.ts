/**
 * Extract design tokens from a rendered page.
 *
 * All page.evaluate() calls use string expressions to avoid
 * tsx/esbuild __name injection (see esbuild issue #1031).
 */

import type { Page } from "puppeteer-core";
import type { DesignTokens } from "./types.js";

// The entire extraction runs as a single string-based evaluate
// to avoid tsx __name injection into the browser context.
const EXTRACT_SCRIPT = `(() => {
  var isVisible = (el) => {
    var s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0" && el.getBoundingClientRect().height > 0;
  };

  // 1. CSS custom properties from :root
  var cssVariables = {};
  for (var i = 0; i < document.styleSheets.length; i++) {
    try {
      var rules = document.styleSheets[i].cssRules;
      for (var j = 0; j < rules.length; j++) {
        if (rules[j].selectorText === ":root") {
          for (var k = 0; k < rules[j].style.length; k++) {
            var prop = rules[j].style[k];
            if (prop.startsWith("--")) {
              cssVariables[prop] = rules[j].style.getPropertyValue(prop).trim();
            }
          }
        }
      }
    } catch(e) {}
  }

  // 2. Meta
  var title = document.title || "";
  var descEl = document.querySelector('meta[name="description"]') || document.querySelector('meta[property="og:description"]');
  var description = descEl ? descEl.content : "";
  var ogImgEl = document.querySelector('meta[property="og:image"]');
  var ogImage = ogImgEl ? ogImgEl.content : undefined;

  // 3. Fonts
  var fontSet = {};
  var fontSamples = [document.body, document.querySelector("h1"), document.querySelector("h2"), document.querySelector("p"), document.querySelector("button")].filter(Boolean);
  for (var fi = 0; fi < fontSamples.length; fi++) {
    var family = getComputedStyle(fontSamples[fi]).fontFamily.split(",")[0].replace(/['"]/g, "").trim();
    if (family && ["serif","sans-serif","monospace","cursive"].indexOf(family) === -1) fontSet[family] = true;
  }

  // 4. Colors
  var colorSet = {};
  var colorSamples = [document.body, document.querySelector("header"), document.querySelector("nav"), document.querySelector("main"), document.querySelector("h1"), document.querySelector("a"), document.querySelector("button")].filter(Boolean);
  for (var ci = 0; ci < colorSamples.length; ci++) {
    var cs = getComputedStyle(colorSamples[ci]);
    if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)" && cs.backgroundColor !== "transparent") colorSet[cs.backgroundColor] = true;
    if (cs.color) colorSet[cs.color] = true;
  }

  // 5. Headings
  var headingEls = Array.from(document.querySelectorAll("h1, h2, h3, h4")).slice(0, 20);
  var headings = headingEls.filter(isVisible).map(function(h) {
    var s = getComputedStyle(h);
    return { level: parseInt(h.tagName[1]), text: (h.textContent || "").trim().slice(0, 200), fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color };
  });

  // 6. Paragraphs
  var paragraphs = Array.from(document.querySelectorAll("p")).slice(0, 10).map(function(p) { return (p.textContent || "").trim().slice(0, 300); }).filter(function(t) { return t.length > 20; });

  // 7. CTAs
  var ctaEls = Array.from(document.querySelectorAll('a[class*="btn"], a[class*="button"], button[class*="primary"], [role="button"], a[class*="cta"]')).slice(0, 10);
  var ctas = ctaEls.filter(isVisible).map(function(c) { return { text: (c.textContent || "").trim().slice(0, 60), href: c.href || undefined }; }).filter(function(c) { return c.text.length > 1; });

  // 8. SVGs
  var svgEls = Array.from(document.querySelectorAll("svg"));
  var svgs = svgEls.map(function(svg) {
    var label = svg.getAttribute("aria-label");
    var w = svg.getAttribute("width");
    if (!label && (!w || parseInt(w) < 30)) return null;
    return {
      label: label || undefined,
      viewBox: svg.getAttribute("viewBox") || undefined,
      outerHTML: svg.outerHTML.slice(0, 3000),
      isLogo: (label && label.toLowerCase().indexOf("logo") !== -1) || svg.closest('[class*="logo"], [class*="brand"], [class*="home"]') !== null
    };
  }).filter(Boolean).slice(0, 20);

  // 9. Images
  var imgEls = Array.from(document.querySelectorAll("img[src]")).filter(function(img) { return img.naturalWidth > 200 && isVisible(img); }).slice(0, 15);
  var images = imgEls.map(function(img) { return { src: img.src, alt: img.alt || "", width: img.naturalWidth, height: img.naturalHeight }; });

  // 10. Icons
  var iconEls = Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]'));
  var icons = iconEls.map(function(l) { return { rel: l.rel, href: l.href }; });

  // 11. Sections
  var sectionResults = [];
  var seen = {};
  var candidates = Array.from(document.querySelectorAll('section, main > div, main > section, [class*="hero"], [class*="Hero"], footer'));
  for (var si = 0; si < candidates.length; si++) {
    var el = candidates[si];
    if (seen[si]) continue;
    var rect = el.getBoundingClientRect();
    if (rect.height < 200 || rect.width < 400 || !isVisible(el)) continue;
    var y = rect.top + window.scrollY;
    var heading = el.querySelector("h1, h2, h3, h4");
    var headingText = heading ? (heading.textContent || "").trim().slice(0, 80) : "";
    var classes = (el.className || "").toString().toLowerCase();
    var type = "content";
    if (y < 200 || classes.indexOf("hero") !== -1) type = "hero";
    else if (el.tagName === "FOOTER" || classes.indexOf("footer") !== -1) type = "footer";
    else if (classes.indexOf("cta") !== -1) type = "cta";
    else if (classes.indexOf("logo") !== -1 || classes.indexOf("customer") !== -1) type = "logos";
    else if (classes.indexOf("testimonial") !== -1 || classes.indexOf("quote") !== -1) type = "testimonials";
    else if (classes.indexOf("feature") !== -1 || classes.indexOf("section") !== -1) type = "features";
    var selector = el.id ? "#" + el.id : el.tagName.toLowerCase();
    var sectionBg = getComputedStyle(el).backgroundColor;
    if (!sectionBg || sectionBg === "rgba(0, 0, 0, 0)" || sectionBg === "transparent") sectionBg = "#ffffff";
    seen[si] = true;
    sectionResults.push({ selector: selector, type: type, y: Math.round(y), height: Math.round(rect.height), heading: headingText, backgroundColor: sectionBg });
  }
  sectionResults.sort(function(a, b) { return a.y - b.y; });
  var filtered = sectionResults.filter(function(s, i) { return i === 0 || Math.abs(s.y - sectionResults[i-1].y) > 100; });

  return {
    title: title, description: description, ogImage: ogImage,
    cssVariables: cssVariables, fonts: Object.keys(fontSet), colors: Object.keys(colorSet).slice(0, 12),
    headings: headings, paragraphs: paragraphs, ctas: ctas,
    svgs: svgs, images: images, icons: icons, sections: filtered
  };
})()`;

export async function extractTokens(page: Page): Promise<DesignTokens> {
  return page.evaluate(EXTRACT_SCRIPT) as Promise<DesignTokens>;
}
