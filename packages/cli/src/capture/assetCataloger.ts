/**
 * Comprehensive asset cataloger.
 *
 * Scans rendered HTML and CSS for every referenced asset (images, videos,
 * fonts, icons, stylesheets, backgrounds) and records the HTML context
 * where each was found (e.g., img[src], css url(), link[rel=preload]).
 *
 * This is the programmatic Part 1 of DESIGN.md generation — deterministic
 * extraction, no AI involved.
 */

import type { Page } from "puppeteer-core";

export interface CatalogedAsset {
  url: string;
  type: "Image" | "Video" | "Font" | "Icon" | "Background" | "Other";
  contexts: string[];
  notes?: string;
}

/**
 * Extract all referenced assets from the rendered page with their HTML contexts.
 */
export async function catalogAssets(page: Page): Promise<CatalogedAsset[]> {
  const assets = await page.evaluate(`(() => {
    var assetMap = {};

    function add(url, type, context, notes) {
      if (!url || url === '' || url.startsWith('data:') || url.startsWith('blob:') || url === 'about:blank') return;
      // Normalize URL
      try { url = new URL(url, document.baseURI).href; } catch(e) { return; }
      // Skip tiny inline data URIs but keep base64 SVGs
      if (url.length > 50000) return;
      // Filter tracking pixels and analytics
      var lurl = url.toLowerCase();
      if (lurl.indexOf('analytics.') > -1 || lurl.indexOf('adsct') > -1 || lurl.indexOf('pixel.') > -1 || lurl.indexOf('tracking.') > -1 || lurl.indexOf('pdscrb.') > -1 || lurl.indexOf('doubleclick') > -1 || lurl.indexOf('googlesyndication') > -1 || lurl.indexOf('facebook.com/tr') > -1 || lurl.indexOf('bat.bing') > -1 || lurl.indexOf('clarity.ms') > -1) return;
      if (lurl.indexOf('bci=') > -1 && lurl.indexOf('twpid=') > -1) return;
      if (lurl.indexOf('cachebust=') > -1 || lurl.indexOf('event_id=') > -1) return;
      // Filter CSS fragment references to SVG filter IDs (not real downloadable assets)
      // e.g., "page.css#hph-illustration-filter", "#linkedin-clip-1"
      if (url.indexOf('.css#') > -1) return;
      // Filter same-page fragment references like "https://site.com/#clip-1"
      try { var parsed = new URL(url); if (parsed.hash && parsed.pathname.length <= 1) return; } catch(e2) {}

      if (!assetMap[url]) {
        assetMap[url] = { url: url, type: type, contexts: [], notes: null };
      }
      var entry = assetMap[url];
      if (entry.contexts.indexOf(context) === -1) {
        entry.contexts.push(context);
      }
      if (notes && !entry.notes) {
        entry.notes = notes;
      }
    }

    // ── Images: <img src="..."> and <img srcset="..."> ──
    document.querySelectorAll('img[src]').forEach(function(img) {
      var notes = img.alt || img.getAttribute('aria-label') || null;
      add(img.src, 'Image', 'img[src]', notes);
      if (img.srcset) {
        img.srcset.split(',').forEach(function(entry) {
          var u = entry.trim().split(/\\s+/)[0];
          if (u) add(u, 'Image', 'img[srcset]', notes);
        });
      }
    });

    // ── Picture sources: <source srcset="..."> ──
    document.querySelectorAll('source[srcset]').forEach(function(src) {
      src.srcset.split(',').forEach(function(entry) {
        var u = entry.trim().split(/\\s+/)[0];
        if (u) add(u, 'Image', 'source[srcset]', null);
      });
    });

    // ── Videos: <video src="..."> and <video poster="..."> ──
    document.querySelectorAll('video[src]').forEach(function(v) {
      add(v.src, 'Video', 'video[src]', null);
    });
    document.querySelectorAll('video source[src]').forEach(function(s) {
      add(s.src, 'Video', 'video source[src]', null);
    });
    document.querySelectorAll('video[poster]').forEach(function(v) {
      add(v.poster, 'Image', 'video[poster]', null);
    });

    // ── Links: preload, icon, apple-touch-icon, stylesheet ──
    document.querySelectorAll('link[rel]').forEach(function(link) {
      var rel = link.rel.toLowerCase();
      var href = link.href;
      if (!href) return;

      if (rel.includes('preload')) {
        var asType = link.getAttribute('as') || '';
        if (asType === 'font') add(href, 'Font', 'link[rel="preload"]', null);
        else if (asType === 'image') add(href, 'Image', 'link[rel="preload"]', null);
        else if (asType === 'video') add(href, 'Video', 'link[rel="preload"]', null);
        else if (asType === 'style') add(href, 'Other', 'link[rel="preload"]', null);
        else add(href, 'Other', 'link[rel="preload"]', null);
      }
      if (rel.includes('icon')) add(href, 'Icon', 'link[rel="' + rel + '"]', null);
      if (rel === 'apple-touch-icon') add(href, 'Icon', 'link[rel="apple-touch-icon"]', null);
    });

    // ── Meta: og:image, twitter:image ──
    document.querySelectorAll('meta[property="og:image"], meta[content][name="twitter:image"]').forEach(function(m) {
      var content = m.getAttribute('content');
      if (content) {
        var prop = m.getAttribute('property') || m.getAttribute('name') || '';
        add(content, 'Image', 'meta[' + prop + ']', null);
      }
    });

    // ── CSS url() references from all stylesheets ──
    try {
      for (var i = 0; i < document.styleSheets.length; i++) {
        try {
          var sheet = document.styleSheets[i];
          var rules = sheet.cssRules || sheet.rules;
          if (!rules) continue;
          for (var j = 0; j < rules.length; j++) {
            var rule = rules[j];
            var cssText = rule.cssText || '';
            var urlMatches = cssText.match(/url\\(["']?([^"')]+)["']?\\)/g);
            if (urlMatches) {
              urlMatches.forEach(function(m) {
                var u = m.replace(/url\\(["']?/, '').replace(/["']?\\)/, '');
                if (u.startsWith('data:')) return;
                // Classify by file extension
                if (/\\.(woff2?|ttf|otf|eot)$/i.test(u)) {
                  add(u, 'Font', 'css url()', null);
                } else if (/\\.(png|jpg|jpeg|gif|webp|avif|svg)$/i.test(u)) {
                  add(u, 'Background', 'css url()', null);
                } else {
                  add(u, 'Other', 'css url()', null);
                }
              });
            }
          }
        } catch(e) { /* cross-origin stylesheet */ }
      }
    } catch(e) {}

    // ── Inline style url() references ──
    document.querySelectorAll('[style]').forEach(function(el) {
      var style = el.getAttribute('style') || '';
      var urlMatches = style.match(/url\\(["']?([^"')]+)["']?\\)/g);
      if (urlMatches) {
        urlMatches.forEach(function(m) {
          var u = m.replace(/url\\(["']?/, '').replace(/["']?\\)/, '');
          if (u.startsWith('data:')) return;
          if (/\\.(woff2?|ttf|otf|eot)$/i.test(u)) {
            add(u, 'Font', 'html inline style url()', null);
          } else {
            add(u, 'Other', 'html inline style url()', null);
          }
        });
      }
    });

    return Object.values(assetMap);
  })()`);

  const raw = (assets as CatalogedAsset[]) || [];

  // Deduplicate srcset resolution variants — keep highest resolution per base URL
  return deduplicateSrcsetVariants(raw);
}

/**
 * Deduplicate Next.js image variants (same image at different w= sizes).
 * Keeps the highest resolution version and merges contexts.
 */
function deduplicateSrcsetVariants(assets: CatalogedAsset[]): CatalogedAsset[] {
  const byBase = new Map<string, CatalogedAsset>();

  for (const a of assets) {
    // Extract base URL by stripping w= and q= params from _next/image URLs
    let baseKey = a.url;
    try {
      const u = new URL(a.url);
      if (u.pathname.includes("_next/image") || u.searchParams.has("w")) {
        u.searchParams.delete("w");
        u.searchParams.delete("q");
        baseKey = u.toString();
      }
    } catch {
      /* not a valid URL, keep as-is */
    }

    const existing = byBase.get(baseKey);
    if (existing) {
      // Merge contexts
      for (const ctx of a.contexts) {
        if (!existing.contexts.includes(ctx)) {
          existing.contexts.push(ctx);
        }
      }
      // Keep notes from whichever has them
      if (a.notes && !existing.notes) {
        existing.notes = a.notes;
      }
      // Keep the URL with highest w= value (largest image)
      const existingW = getWidthParam(existing.url);
      const newW = getWidthParam(a.url);
      if (newW > existingW) {
        existing.url = a.url;
      }
    } else {
      byBase.set(baseKey, { ...a, contexts: [...a.contexts] });
    }
  }

  return [...byBase.values()];
}

function getWidthParam(url: string): number {
  try {
    const u = new URL(url);
    const w = u.searchParams.get("w");
    return w ? parseInt(w) : 0;
  } catch {
    return 0;
  }
}

/**
 * Format cataloged assets as markdown for the DESIGN.md Assets section.
 */
export function formatAssetCatalog(assets: CatalogedAsset[]): string {
  if (assets.length === 0) return "No assets detected.\n";

  const lines: string[] = [];
  for (const a of assets) {
    const contexts = a.contexts.join(", ");
    const notes = a.notes ? ` | notes: ${a.notes}` : "";
    lines.push(`- **${a.type}**: ${a.url} — contexts: ${contexts}${notes}`);
  }
  return lines.join("\n") + "\n";
}
