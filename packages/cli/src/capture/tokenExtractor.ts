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

  // 4. Colors — hybrid: DOM computed styles + visual pixel sampling
  var colorSet = {};
  function addColor(c, weight) {
    if (!c || c === "rgba(0, 0, 0, 0)" || c === "transparent" || c === "inherit" || c === "initial" || c === "currentcolor") return;
    var hex = rgbToHex(c);
    if (hex) colorSet[hex] = (colorSet[hex] || 0) + (weight || 1);
  }
  function rgbToHex(color) {
    if (!color) return null;
    if (color.startsWith('#')) return (color.length === 4
      ? '#' + color[1]+color[1] + color[2]+color[2] + color[3]+color[3]
      : color).toUpperCase();
    var m = color.match(/rgba?\\(\\s*(\\d+)\\s*,\\s*(\\d+)\\s*,\\s*(\\d+)/);
    if (!m) {
      // Handle color(srgb ...) format
      var cm = color.match(/color\\(srgb\\s+([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)/);
      if (cm) {
        m = [null, Math.round(parseFloat(cm[1])*255), Math.round(parseFloat(cm[2])*255), Math.round(parseFloat(cm[3])*255)];
      } else {
        // Handle modern color functions (oklch, oklab, lch, lab, hsl, color-mix)
        // Use a 1x1 canvas to resolve ANY CSS color to RGB — this works even when
        // getComputedStyle returns the color in its original color space (Chrome 131+)
        if (/oklch|oklab|lch|lab|hsla?|color-mix|color\\(/.test(color)) {
          try {
            var cvs = document.createElement('canvas');
            cvs.width = 1; cvs.height = 1;
            var ctx2d = cvs.getContext('2d');
            if (ctx2d) {
              ctx2d.fillStyle = color;
              ctx2d.fillRect(0, 0, 1, 1);
              var px = ctx2d.getImageData(0, 0, 1, 1).data;
              if (px[3] > 0) return '#' + ((1<<24) + (px[0]<<16) + (px[1]<<8) + px[2]).toString(16).slice(1).toUpperCase();
            }
          } catch(e2) {}
          // Fallback: temp element approach
          var tmp = document.createElement('div');
          tmp.style.color = color;
          document.body.appendChild(tmp);
          var resolved = getComputedStyle(tmp).color;
          document.body.removeChild(tmp);
          if (resolved !== color) return rgbToHex(resolved);
          return null;
        }
        return null;
      }
    }
    return '#' + ((1<<24) + (parseInt(m[1])<<16) + (parseInt(m[2])<<8) + parseInt(m[3])).toString(16).slice(1).toUpperCase();
  }

  // 4a. Sample DOM elements (text colors, borders, branded elements)
  var colorCandidates = Array.from(document.querySelectorAll(
    "body, header, nav, main, footer, section, " +
    "h1, h2, h3, h4, h5, h6, " +
    "a, button, [role='button'], " +
    "[class*='hero'], [class*='cta'], [class*='btn'], [class*='card'], " +
    "[class*='badge'], [class*='tag'], [class*='accent'], [class*='highlight']"
  )).slice(0, 200);
  for (var ci = 0; ci < colorCandidates.length; ci++) {
    try {
      var cs = getComputedStyle(colorCandidates[ci]);
      addColor(cs.backgroundColor);
      addColor(cs.color);
      addColor(cs.borderColor);
      addColor(cs.outlineColor);
      // Extract colors from gradients in background-image
      var bgImg = cs.backgroundImage;
      if (bgImg && bgImg !== 'none') {
        var gradColors = bgImg.match(/(?:#[0-9a-fA-F]{3,8}|rgba?\\([^)]+\\)|oklch\\([^)]+\\)|oklab\\([^)]+\\)|hsla?\\([^)]+\\)|lab\\([^)]+\\))/g);
        if (gradColors) gradColors.forEach(function(gc) { addColor(gc); });
      }
      // Extract colors from box-shadow
      var shadow = cs.boxShadow;
      if (shadow && shadow !== 'none') {
        var shadowColors = shadow.match(/(?:#[0-9a-fA-F]{3,8}|rgba?\\([^)]+\\))/g);
        if (shadowColors) shadowColors.forEach(function(sc) { addColor(sc); });
      }
    } catch(e) {}
  }

  // 4b. Explicitly sample html/body backgrounds (the dominant canvas color)
  // These often define the site's light/dark character
  try {
    var htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    var bodyBg = getComputedStyle(document.body).backgroundColor;
    addColor(htmlBg, 10);
    addColor(bodyBg, 10);
    // Also check the background shorthand which may contain gradients
    var bodyBgFull = getComputedStyle(document.body).background;
    var gradColors = bodyBgFull.match(/(?:#[0-9a-fA-F]{3,8}|rgba?\\([^)]+\\)|oklch\\([^)]+\\)|hsla?\\([^)]+\\))/g);
    if (gradColors) gradColors.forEach(function(gc) { addColor(gc, 8); });
  } catch(e) {}

  // 4c. Visual pixel sampling — sample what the user actually SEES
  // Walk a grid of points across the viewport and read background + text color
  var vpW = window.innerWidth;
  var vpH = window.innerHeight;
  var gridCols = 6;
  var gridRows = 5;
  for (var gy = 0; gy < gridRows; gy++) {
    for (var gx = 0; gx < gridCols; gx++) {
      try {
        var px = Math.round((gx + 0.5) * vpW / gridCols);
        var py = Math.round((gy + 0.5) * vpH / gridRows);
        var elAt = document.elementFromPoint(px, py);
        if (elAt) {
          var elStyle = getComputedStyle(elAt);
          addColor(elStyle.color, 2);
          var bgc = elStyle.backgroundColor;
          // Walk up parents until we find a non-transparent background
          var bgWalker = elAt;
          while (bgWalker && (!bgc || bgc === "rgba(0, 0, 0, 0)" || bgc === "transparent")) {
            bgWalker = bgWalker.parentElement;
            if (bgWalker) bgc = getComputedStyle(bgWalker).backgroundColor;
          }
          addColor(bgc, 3);
        }
      } catch(e) {}
    }
  }

  // 4c2. Broad sweep — find ANY element with a non-white/non-transparent background
  // This catches colored blocks that the grid might miss (code blocks, banners, cards)
  var allEls = document.querySelectorAll('*');
  var colorSweepCount = 0;
  for (var si = 0; si < allEls.length && colorSweepCount < 500; si++) {
    try {
      var elCs = getComputedStyle(allEls[si]);
      var elBg = elCs.backgroundColor;
      if (elBg && elBg !== "rgba(0, 0, 0, 0)" && elBg !== "transparent") {
        var hex = rgbToHex(elBg);
        if (hex && hex !== "#FFFFFF" && hex !== "#000000") {
          addColor(elBg, 1);
        }
      }
      colorSweepCount++;
    } catch(e) {}
  }

  // 4d. Resolve CSS custom properties from :root to actual color values
  var rootStyle = getComputedStyle(document.documentElement);
  var rootProps = Object.keys(cssVariables);
  for (var ri = 0; ri < rootProps.length; ri++) {
    var val = rootStyle.getPropertyValue(rootProps[ri]).trim();
    if (val && /^(#|rgb|hsl|oklch|oklab|lch|lab|color)/.test(val)) {
      addColor(val);
    }
  }

  // 5. Headings
  var headingEls = Array.from(document.querySelectorAll("h1, h2, h3, h4")).slice(0, 20);
  var headings = headingEls.filter(isVisible).map(function(h) {
    var s = getComputedStyle(h);
    return { level: parseInt(h.tagName[1]), text: (h.innerText || h.textContent || "").trim().replace(/\\s+/g, ' ').slice(0, 200), fontSize: s.fontSize, fontWeight: s.fontWeight, color: rgbToHex(s.color) || s.color };
  });

  // 6. Paragraphs
  var paragraphs = Array.from(document.querySelectorAll("p")).slice(0, 10).map(function(p) { return (p.textContent || "").trim().slice(0, 300); }).filter(function(t) { return t.length > 20; });

  // 7. CTAs — match by class AND by text content patterns
  // Conservative class selectors (avoid nav links with "action" or "start" in class)
  var ctaSelectors = 'a[class*="btn"], a[class*="button"], a[class*="cta"], button[class*="primary"], button[class*="cta"], [role="button"]';
  var ctaEls = Array.from(document.querySelectorAll(ctaSelectors));
  // Filter out nav links (common false positives)
  ctaEls = ctaEls.filter(function(el) {
    return !el.closest('nav, [role="navigation"], [class*="nav"], [class*="menu"], [class*="dropdown"]');
  });
  // Also find links/buttons by text content (catches CTAs without class hints)
  // Require short text (real CTAs are concise) and exclude nav context
  var ctaTextPatterns = /^(get started|sign up|start free|try (it )?free|start (a )?trial|book a demo|request (a )?demo|contact (us|sales)|start for free|create account|register now)$/i;
  var allButtons = Array.from(document.querySelectorAll('a, button'));
  for (var bi = 0; bi < allButtons.length && ctaEls.length < 20; bi++) {
    var btnText = (allButtons[bi].textContent || "").trim();
    if (btnText.length > 30) continue;
    if (allButtons[bi].closest('nav, [role="navigation"], [class*="nav"], [class*="menu"]')) continue;
    if (ctaTextPatterns.test(btnText) && ctaEls.indexOf(allButtons[bi]) === -1) {
      ctaEls.push(allButtons[bi]);
    }
  }
  ctaEls = ctaEls.slice(0, 10);
  var ctas = ctaEls.filter(isVisible).map(function(c) { return { text: (c.textContent || "").trim().slice(0, 60), href: c.href || undefined }; }).filter(function(c) { return c.text.length > 1; });

  // 8. SVGs
  var svgEls = Array.from(document.querySelectorAll("svg"));
  var svgs = svgEls.map(function(svg) {
    var label = svg.getAttribute("aria-label") || svg.getAttribute("title") || svg.getAttribute("alt");
    var w = svg.getAttribute("width");
    // Keep SVGs that have a label OR are at least 16px wide OR are inside a logo/brand context
    var inLogoContext = svg.closest('[class*="logo"], [class*="brand"], [class*="partner"], [class*="customer"], [class*="marquee"]') !== null;
    if (!label && !inLogoContext && (!w || parseInt(w) < 16)) return null;
    return {
      label: label || undefined,
      viewBox: svg.getAttribute("viewBox") || undefined,
      outerHTML: svg.outerHTML.slice(0, 10000),
      isLogo: (label && label.toLowerCase().indexOf("logo") !== -1) || svg.closest('[class*="logo"], [class*="brand"], [class*="home"], [class*="marquee"], [class*="partner"], [class*="customer"]') !== null
    };
  }).filter(Boolean).slice(0, 50);

  // 9. Images
  var imgEls = Array.from(document.querySelectorAll("img[src]")).filter(function(img) { return img.naturalWidth > 200 && isVisible(img); }).slice(0, 15);
  var images = imgEls.map(function(img) { return { src: img.src, alt: img.alt || "", width: img.naturalWidth, height: img.naturalHeight }; });

  // 10. Icons
  var iconEls = Array.from(document.querySelectorAll('link[rel*="icon"], link[rel="apple-touch-icon"]'));
  var icons = iconEls.map(function(l) { return { rel: l.rel, href: l.href }; });

  // 11. Sections — find large visual blocks regardless of HTML tag
  var sectionResults = [];
  // Start with semantic elements, then fall back to large direct children of body/main
  var candidates = Array.from(document.querySelectorAll(
    'section, main > div, main > section, article, ' +
    'body > div > div, body > main > div, body > div, ' +
    '[class*="hero"], [class*="Hero"], [class*="section"], [class*="Section"], ' +
    '[class*="container"], [class*="wrapper"], [class*="block"], ' +
    '[id*="section"], [id*="hero"], footer, [role="region"], [role="banner"]'
  ));
  // Deduplicate (a div can match multiple selectors)
  var seenEls = new Set();
  candidates = candidates.filter(function(el) {
    if (seenEls.has(el)) return false;
    seenEls.add(el);
    return true;
  });
  for (var si = 0; si < candidates.length; si++) {
    var el = candidates[si];
    var rect = el.getBoundingClientRect();
    if (rect.height < 200 || rect.width < 400 || !isVisible(el)) continue;
    // Skip page-level wrappers (a single div wrapping the entire page is not a section)
    var pageHeight = document.body.scrollHeight || document.documentElement.scrollHeight;
    if (rect.height > pageHeight * 0.8) continue;
    var y = rect.top + window.scrollY;
    var heading = el.querySelector("h1, h2, h3, h4");
    var headingText = heading ? (heading.innerText || heading.textContent || "").trim().replace(/\\s+/g, ' ').slice(0, 80) : "";
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
    // Walk up DOM to find nearest non-transparent background (don't default to white)
    if (!sectionBg || sectionBg === "rgba(0, 0, 0, 0)" || sectionBg === "transparent") {
      var bgWalker = el.parentElement;
      while (bgWalker) {
        var parentBg = getComputedStyle(bgWalker).backgroundColor;
        if (parentBg && parentBg !== "rgba(0, 0, 0, 0)" && parentBg !== "transparent") {
          sectionBg = parentBg;
          break;
        }
        bgWalker = bgWalker.parentElement;
      }
      if (!sectionBg || sectionBg === "rgba(0, 0, 0, 0)" || sectionBg === "transparent") sectionBg = "#FFFFFF";
    }
    sectionBg = rgbToHex(sectionBg) || sectionBg;
    sectionResults.push({ selector: selector, type: type, y: Math.round(y), height: Math.round(rect.height), heading: headingText, backgroundColor: sectionBg });
  }
  sectionResults.sort(function(a, b) { return a.y - b.y; });
  var filtered = sectionResults.filter(function(s, i) { return i === 0 || Math.abs(s.y - sectionResults[i-1].y) > 100; });

  return {
    title: title, description: description, ogImage: ogImage,
    cssVariables: cssVariables, fonts: Object.keys(fontSet), colors: Object.keys(colorSet).sort(function(a,b) { return colorSet[b] - colorSet[a]; }).slice(0, 20),
    headings: headings, paragraphs: paragraphs, ctas: ctas,
    svgs: svgs, images: images, icons: icons, sections: filtered
  };
})()`;

export async function extractTokens(page: Page): Promise<DesignTokens> {
  return page.evaluate(EXTRACT_SCRIPT) as Promise<DesignTokens>;
}
