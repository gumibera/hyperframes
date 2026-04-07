/**
 * Generate HyperFrames sub-composition HTML from a parsed section.
 *
 * Each section becomes a template-wrapped composition with:
 * - Shared CSS (full head styles + CSSOM)
 * - The section's HTML content
 * - Scale factor to fit 1920x1080
 * - Default GSAP entrance/exit animations
 */

import type { ParsedSection } from "./sectionParser.js";

const DEFAULT_SECTION_DURATION = 5;

export function generateComposition(
  section: ParsedSection,
  headCss: string,
  cssomRules: string,
  htmlAttrs: string,
  viewportWidth: number,
  duration: number = DEFAULT_SECTION_DURATION,
): string {
  const compositionId = section.id;
  const canvasW = 1920;
  const canvasH = 1080;
  // Scale to fit the section height into the canvas (if taller than canvas)
  const sectionH = section.height || canvasH;
  const scaleByWidth = canvasW / viewportWidth;
  const scaleByHeight = sectionH * scaleByWidth > canvasH ? canvasH / (sectionH * scaleByWidth) : 1;
  const scale = scaleByWidth * scaleByHeight;

  // For sub-sections split from a larger parent, offset the content vertically
  // so the viewport shows the right part of the shared HTML.
  const contentOffsetY = section.parentY != null ? -(section.y - section.parentY) : 0;

  // Strip <script> tags from head CSS — only keep <style> tags
  // This reduces size and avoids script conflicts in compositions
  const cssOnly = headCss.replace(/<script[\s\S]*?<\/script>/gi, "");

  return `<template id="${compositionId}-template">
  <div data-composition-id="${compositionId}" data-width="${canvasW}" data-height="${canvasH}">
    <!-- Page styles (inlined for HyperFrames compatibility) -->
    ${cssOnly}
    ${cssomRules ? `<style data-cssom="true">${cssomRules}</style>` : ""}

    <!-- Section content scaled to fit canvas -->
    <div id="${compositionId}-bg" style="
      position: absolute; top: 0; left: 0;
      width: ${canvasW}px; height: ${canvasH}px;
      background: ${section.backgroundColor || "#ffffff"};
      overflow: hidden; opacity: 0;
    ">
      <div id="${compositionId}-content" ${htmlAttrs} style="
        transform-origin: top left;
        transform: scale(${scale.toFixed(4)});
        width: ${viewportWidth}px;
        position: absolute; top: ${contentOffsetY}px; left: 0;
      ">
        ${section.html}
      </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      (function() {
        var dur = ${duration};
        var tl = gsap.timeline({ paused: true });

        // Entrance
        tl.fromTo("#${compositionId}-bg",
          { opacity: 0 }, { opacity: 1, duration: 0.4, ease: "power2.out" }, 0);

        // Subtle zoom during hold (continuous motion)
        tl.fromTo("#${compositionId}-content",
          { scale: ${scale.toFixed(4)} },
          { scale: ${(scale * 1.02).toFixed(4)}, duration: dur - 0.6, ease: "sine.inOut" }, 0.3);

        // Exit
        tl.to("#${compositionId}-bg",
          { opacity: 0, duration: 0.3, ease: "power2.in" }, dur - 0.3);

        window.__timelines = window.__timelines || {};
        window.__timelines["${compositionId}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

/**
 * Generate root index.html that loads all sections sequentially.
 */
export function generateRootComposition(
  sectionIds: string[],
  title: string,
  sectionDuration: number = DEFAULT_SECTION_DURATION,
): string {
  const totalDuration = sectionIds.length * sectionDuration;

  const sectionDivs = sectionIds
    .map(
      (id, i) => `    <div
      data-composition-id="${id}"
      data-composition-src="compositions/${id}.html"
      data-start="${i * sectionDuration}"
      data-duration="${sectionDuration}"
      data-track-index="1"
    ></div>`,
    )
    .join("\n\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=1920" />
  <title>${title} — Captured Components</title>
  <style>
    body { margin: 0; padding: 0; background: #000; }
  </style>
</head>
<body>
  <div
    data-composition-id="${slugify(title)}-capture"
    data-width="1920"
    data-height="1080"
    data-start="0"
    data-duration="${totalDuration}"
  >
${sectionDivs}

    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <script>
      window.__timelines = window.__timelines || {};
      window.__timelines["${slugify(title)}-capture"] = gsap.timeline({ paused: true });
    </script>
  </div>
</body>
</html>
`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}
