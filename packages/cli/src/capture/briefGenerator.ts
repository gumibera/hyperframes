/**
 * Generate a prompt-ready design brief from captured website data.
 *
 * The brief is formatted like the 100 test prompts — specific hex colors,
 * exact text, font specs, animation timing — so Claude can build clean
 * HyperFrames compositions from scratch by reading the brief + screenshots.
 */

import type { DesignTokens, DownloadedAsset } from "./types.js";
import type { AnimationCatalog } from "./animationCataloger.js";

export function generateCaptureBrief(
  url: string,
  tokens: DesignTokens,
  animations: AnimationCatalog | undefined,
  screenshots: string[],
  assets: DownloadedAsset[],
  fontPaths: string[],
): string {
  const sections = tokens.sections;
  const sectionCount = sections.filter(
    (s) => s.type !== "header" && s.type !== "footer" && s.heading,
  ).length;
  const suggestedDuration = Math.max(15, sectionCount * 5);

  let brief = `# Capture Brief: ${tokens.title}
Source: ${url}

## How to Use This Brief

1. **Read each section below** — it describes what the original website looks like
2. **Read each screenshot** — they show the exact visual layout
3. **Build a new HyperFrames project** using \`/hyperframes\` skill
4. **Use the exact values** from this brief: hex colors, font names, text content, timing
5. **Reference \`assets/\`** for downloaded images and SVGs

## Project Overview

- **Title:** ${tokens.title}
- **Description:** ${tokens.description}
- **Suggested duration:** ${suggestedDuration}s (${sectionCount} content sections × 5s each)
- **Canvas:** 1920×1080

## Brand System

### Colors
${tokens.colors
  .slice(0, 10)
  .map((c) => `- \`${c}\``)
  .join("\n")}

### Typography
- **Fonts:** ${tokens.fonts.join(", ") || "system-ui"}
${fontPaths.length > 0 ? `- **Local files:** ${fontPaths.join(", ")}\n- Load with \`@font-face\` in compositions` : "- Use system fonts or Google Fonts CDN"}

### Headings (from site)
${tokens.headings.map((h) => `- h${h.level}: "${h.text}" — ${h.fontSize} ${h.fontWeight} ${h.color}`).join("\n")}

### CTAs (from site)
${tokens.ctas.map((c) => `- "${c.text}"${c.href ? ` → ${c.href}` : ""}`).join("\n")}

## Downloaded Assets

${assets.map((a) => `- \`${a.localPath}\` (${a.type})`).join("\n") || "None"}

## Screenshots (READ THESE)

${screenshots.map((s) => `- \`${s}\``).join("\n")}

---

## Sections

`;

  // Sort sections by Y position
  const sorted = [...sections].sort((a, b) => a.y - b.y);
  let sectionIdx = 0;

  for (const section of sorted) {
    // Skip empty headers/footers without headings
    if (!section.heading && (section.type === "header" || section.type === "footer")) {
      continue;
    }

    sectionIdx++;

    // Find matching screenshot
    const screenshotMatch = screenshots.find(
      (s) =>
        s.includes(`section-${String(sectionIdx - 1).padStart(2, "0")}`) ||
        s.includes(`section-${String(sectionIdx).padStart(2, "0")}`),
    );

    // Find headings that fall in this section's Y range
    const sectionHeadings = tokens.headings.filter((h) => {
      // Match by text overlap with section heading
      if (section.heading && h.text.includes(section.heading.slice(0, 20))) return true;
      return false;
    });

    // Find CTAs in this section's Y range
    const sectionCtas = tokens.ctas.filter((_c) => {
      // Basic heuristic: include all CTAs for hero, specific ones for others
      if (section.type === "hero") return true;
      return false;
    });

    // Find paragraphs that might belong to this section
    const sectionParagraphs = tokens.paragraphs.filter((p) => {
      if (section.heading && p.includes(section.heading.slice(0, 15))) return true;
      return false;
    });

    // Find animations for this section's Y range
    const nextSection = sorted[sorted.indexOf(section) + 1];
    const yMax = nextSection ? nextSection.y : section.y + section.height;
    const sectionAnims = getAnimationsForRange(animations, section.y, yMax);

    brief += `### Section ${sectionIdx}: ${section.heading || section.type} (${section.type})
**Screenshot:** \`${screenshotMatch || `screenshots/section-${String(sectionIdx - 1).padStart(2, "0")}.png`}\` — **READ THIS IMAGE**
**Background:** ${section.backgroundColor || "#ffffff"}
**Y range:** ${section.y}–${yMax}px (${section.height}px tall)

#### Content
`;

    if (section.heading) {
      brief += `- **Heading:** "${section.heading}"\n`;
    }

    if (sectionHeadings.length > 0) {
      for (const h of sectionHeadings) {
        brief += `- h${h.level}: "${h.text}" — ${h.fontSize} ${h.fontWeight} ${h.color}\n`;
      }
    }

    if (sectionParagraphs.length > 0) {
      for (const p of sectionParagraphs.slice(0, 3)) {
        brief += `- Text: "${p.slice(0, 120)}${p.length > 120 ? "..." : ""}"\n`;
      }
    }

    if (sectionCtas.length > 0) {
      for (const c of sectionCtas) {
        brief += `- CTA: "${c.text}"\n`;
      }
    }

    brief += `
#### Brand
- Font: ${tokens.fonts[0] || "Inter"}
- Background: \`${section.backgroundColor || "#ffffff"}\`
`;

    if (sectionAnims.length > 0) {
      brief += `
#### Animations (from source site)
${sectionAnims.map((a) => `- ${a}`).join("\n")}
`;
    }

    brief += `
---

`;
  }

  // Build a rich suggested prompt with specific animations, transitions, and effects
  const contentSections = sorted.filter(
    (s) => s.heading && s.type !== "header" && s.type !== "footer",
  );
  const numScenes = Math.min(contentSections.length, 7);
  const sceneSections = contentSections.slice(0, numScenes);
  const totalDur = sceneSections.reduce((sum, _, i) => sum + getSceneDuration(i, numScenes), 0);

  // Transition types to cycle through (never repeat)
  const transitions = [
    "wipe left-to-right",
    "circle iris reveal from center",
    "diagonal wipe top-left to bottom-right",
    "crossfade over 0.8s",
    "slide-push from right",
    "glitch transition with brief RGB split",
    "zoom-through",
  ];

  // Entrance animations to cycle through (never repeat same one twice)
  const entrances = [
    "slides up from bottom with overshoot (back.out easing)",
    "fades in word-by-word with stagger 0.12s",
    "scales up from 80% with elastic easing",
    "types out character-by-character at 20 chars/sec",
    "drops in from above with bounce easing",
    "slides in from right with power4.out easing",
    "reveals via expanding clip-path circle from center",
  ];

  // Mid-scene activity to keep things alive
  const midActivities = [
    "Logo bar scrolls horizontally like a marquee",
    "Cards have subtle float animation (y: -4px, yoyo, repeat)",
    "Background has very subtle gradient shift",
    "Numbers counter-animate from 0 to their values",
    "Testimonial cards pulse with soft glow on hover highlight",
    "Icons rotate slowly (360deg over 8s)",
    "Decorative dots drift with parallax motion",
  ];

  brief += `## Suggested Prompt

Read \`${slugify(tokens.title)}/capture-brief.md\` from top to bottom. Read every screenshot listed in the brief. Then:

\`\`\`
Create a new Hyperframes project called "${slugify(tokens.title)}-promo" in ~/Desktop/CLAUDE\\ TEST/.
Use npx hyperframes init, then build a ${totalDur}-second composition.

`;

  for (let i = 0; i < sceneSections.length; i++) {
    const s = sceneSections[i];
    const dur = getSceneDuration(i, numScenes);
    const bgColor = s.backgroundColor || "#0F172A";
    const transition = i > 0 ? transitions[(i - 1) % transitions.length] : "";
    const entrance = entrances[i % entrances.length];
    const midActivity = midActivities[i % midActivities.length];

    // Find sub-elements to mention based on section type
    const elements = getSectionElements(s, tokens);

    brief += `Scene ${i + 1} (${dur}s)${transition ? ` [${transition}]` : ""}: `;
    brief += `${bgColor} background. `;
    brief += `"${s.heading}" heading ${entrance}. `;

    if (elements.length > 0) {
      brief += elements.join(". ") + ". ";
    }

    brief += `${midActivity}. `;

    // Exit for all but last scene
    if (i < sceneSections.length - 1) {
      brief += `All elements exit before transition.`;
    } else {
      brief += `Hold, then fade to black.`;
    }

    brief += "\n\n";
  }

  brief += `Colors: use exact hex values from the capture brief. Font: ${tokens.fonts[0] || "Inter"} (check capture brief for local font files). Reference notion/assets/ for images and SVGs. Then run npx hyperframes lint and npx hyperframes preview.
\`\`\`

### Prompt Tips
- **Always specify transition types** between scenes — don't let it default to simple fades
- **Use specific animation verbs**: "slides up", "bounces in", "types out", "counter-animates from 0 to X" — not just "appears"
- **Stagger everything**: cards, list items, logos — specify "stagger 0.15s" or "stagger 0.2s apart"
- **Add mid-scene activity**: without it, scenes feel static. Floating, pulsing, subtle rotation, parallax
- **Specify easing**: "elastic easing", "back.out with overshoot", "power4.out" — not just "ease-in"
- **Exit animations are 2x faster than entrances**: elements should clear before the transition
`;

  return brief;
}

/** Scene duration based on position: hook=5s, middle=6s, close=4s */
function getSceneDuration(index: number, total: number): number {
  if (index === 0) return 5; // hook
  if (index === total - 1) return 4; // close
  return index < 3 ? 6 : 5; // features get more time
}

/** Generate element descriptions based on section type and tokens */
function getSectionElements(
  section: { heading: string; type: string; y: number; height: number },
  tokens: DesignTokens,
): string[] {
  const elements: string[] = [];
  const type = section.type;
  const heading = section.heading.toLowerCase();

  // CTAs for hero sections
  if (type === "hero" || heading.includes("try") || heading.includes("start")) {
    const ctas = tokens.ctas.slice(0, 2);
    if (ctas.length > 0) {
      elements.push(
        `CTA buttons "${ctas.map((c) => c.text).join('" and "')}" slide up staggered 0.2s, primary pulses with glow`,
      );
    }
  }

  // Logo bar for hero
  if (type === "hero") {
    const logoCount = tokens.svgs.filter((s) => s.isLogo).length;
    if (logoCount > 0) {
      elements.push(
        `Logo bar with ${logoCount} company logos fades in staggered at bottom, then scrolls as marquee`,
      );
    }
  }

  // Feature cards
  if (
    type === "features" ||
    heading.includes("feature") ||
    heading.includes("work") ||
    heading.includes("assistant")
  ) {
    elements.push("Feature cards slide in staggered 0.15s from bottom with back.out easing");
    elements.push("Product screenshots scale in from 95% with subtle shadow animation");
  }

  // Social proof / testimonials
  if (heading.includes("trust") || heading.includes("customer") || heading.includes("team")) {
    elements.push("Testimonial cards fade in staggered with subtle lift (translateY -8px)");
    elements.push("Company logos appear in a row, staggered 0.1s");
  }

  // Pricing / productivity
  if (
    heading.includes("price") ||
    heading.includes("productiv") ||
    heading.includes("save") ||
    heading.includes("fewer")
  ) {
    elements.push("Stats counter-animate from 0 to their values in DM Mono Bold");
    elements.push("Checkmark items slide in staggered with green (#22C55E) check icons");
  }

  // CTA / try free
  if (heading.includes("try") || heading.includes("start") || heading.includes("free")) {
    elements.push("Main CTA button scales up with elastic easing, pulses with blue glow shadow");
  }

  return elements;
}

function getAnimationsForRange(
  animations: AnimationCatalog | undefined,
  yMin: number,
  yMax: number,
): string[] {
  if (!animations) return [];
  const results: string[] = [];
  const seen = new Set<string>();

  // Web animations with keyframes in this Y range
  for (const anim of animations.webAnimations) {
    const rect = anim.targetRect;
    if (!rect) continue;
    const top = rect.top ?? -1;
    if (top >= yMin && top <= yMax) {
      const kfs = anim.keyframes || [];
      const props = new Set<string>();
      for (const kf of kfs) {
        for (const k of Object.keys(kf)) {
          if (!["offset", "composite", "easing", "computedOffset"].includes(k)) {
            props.add(k);
          }
        }
      }
      if (props.size === 0) continue;
      const timing = anim.timing || {};
      const dur = timing.duration;
      const ease = timing.easing || "linear";
      const durStr = typeof dur === "number" ? `${dur}ms` : "scroll-linked";
      const desc = `${anim.targetSelector?.slice(0, 60) || "element"}: ${[...props].join(", ")} (${durStr}, ${ease})`;
      if (!seen.has(desc)) {
        seen.add(desc);
        results.push(desc);
      }
    }
  }

  // Scroll targets in this range (summarize count)
  const scrollTargets = (animations.scrollTargets || []).filter(
    (st) => st.rect?.top >= yMin && st.rect?.top <= yMax,
  );
  if (scrollTargets.length > 0) {
    results.push(
      `${scrollTargets.length} scroll-triggered elements (IntersectionObserver targets)`,
    );
  }

  return results.slice(0, 8); // Cap at 8 most relevant
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}
