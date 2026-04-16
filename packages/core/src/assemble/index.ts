/**
 * Deterministic multi-scene assembly.
 *
 * Reads a scaffold (index.html) and scene fragments (.hyperframes/scenes/sceneN.html),
 * validates each fragment against the Scene Fragment Spec, splits on markers, and
 * injects into the scaffold. No AI in the loop — just split and concat.
 *
 * Usage:
 *   import { assembleScenes } from "@hyperframes/core/assemble";
 *   const result = assembleScenes("./my-project");
 *   if (!result.ok) console.error(result.errors);
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// ── Types ───────────────────────────────────────────────────────────────────

export interface AssembleResult {
  ok: boolean;
  errors: AssembleError[];
  /** Total lines in the assembled file (0 if errors) */
  lines: number;
  /** Number of scenes assembled */
  scenes: number;
  /** Path to the written file (empty if dry-run or errors) */
  outputPath: string;
}

export interface AssembleError {
  file: string;
  message: string;
}

interface FragmentSections {
  html: string;
  css: string;
  gsap: string;
}

// ── Fragment spec validation ────────────────────────────────────────────────

const PROHIBITED_PATTERNS: Array<[RegExp, string]> = [
  [/<!DOCTYPE/i, "DOCTYPE declaration — fragments must not be standalone documents"],
  [/<html[\s>]/i, "<html> tag — fragments must not be standalone documents"],
  [/<head[\s>]/i, "<head> tag — fragments must not be standalone documents"],
  [/<body[\s>]/i, "<body> tag — fragments must not be standalone documents"],
  [/<style[\s>]/i, "<style> tag — CSS section must be raw CSS, not wrapped in style tags"],
  [/<\/style>/i, "</style> tag — CSS section must be raw CSS"],
  [/<script[\s>]/i, "<script> tag — GSAP section must be raw JS, not wrapped in script tags"],
  [/<\/script>/i, "</script> tag — GSAP section must be raw JS"],
  [/<script\s+src=/i, "external script loading — the scaffold handles dependencies"],
  [/gsap\.timeline\s*\(/i, "gsap.timeline() — the scaffold creates the timeline"],
  [/window\.__timelines/i, "window.__timelines — the scaffold registers it"],
  [/\btl\.from\s*\(/i, "tl.from() — use tl.set() + tl.to() instead"],
  [/\btl\.fromTo\s*\(/i, "tl.fromTo() — use tl.set() + tl.to() instead"],
];

function validateFragment(content: string, filename: string): AssembleError[] {
  const errors: AssembleError[] = [];

  const htmlMarkers = (content.match(/<!-- HTML -->/g) || []).length;
  const cssMarkers = (content.match(/<!-- CSS -->/g) || []).length;
  const gsapMarkers = (content.match(/<!-- GSAP -->/g) || []).length;

  if (htmlMarkers !== 1) {
    errors.push({
      file: filename,
      message: `Expected 1 <!-- HTML --> marker, found ${htmlMarkers}`,
    });
  }
  if (cssMarkers !== 1) {
    errors.push({ file: filename, message: `Expected 1 <!-- CSS --> marker, found ${cssMarkers}` });
  }
  if (gsapMarkers !== 1) {
    errors.push({
      file: filename,
      message: `Expected 1 <!-- GSAP --> marker, found ${gsapMarkers}`,
    });
  }

  // Check marker order
  const htmlPos = content.indexOf("<!-- HTML -->");
  const cssPos = content.indexOf("<!-- CSS -->");
  const gsapPos = content.indexOf("<!-- GSAP -->");
  if (htmlPos >= 0 && cssPos >= 0 && gsapPos >= 0) {
    if (!(htmlPos < cssPos && cssPos < gsapPos)) {
      errors.push({
        file: filename,
        message: "Markers must appear in order: <!-- HTML --> then <!-- CSS --> then <!-- GSAP -->",
      });
    }
  }

  for (const [pattern, reason] of PROHIBITED_PATTERNS) {
    if (pattern.test(content)) {
      errors.push({ file: filename, message: `Prohibited: ${reason}` });
    }
  }

  return errors;
}

function stripWrapperTags(text: string, openTag: RegExp, closeTag: RegExp): string {
  return text.replace(openTag, "").replace(closeTag, "").trim();
}

function splitFragment(content: string): FragmentSections {
  const htmlStart = content.indexOf("<!-- HTML -->") + "<!-- HTML -->".length;
  const cssStart = content.indexOf("<!-- CSS -->");
  const gsapStart = content.indexOf("<!-- GSAP -->");

  const rawCss = content.substring(cssStart + "<!-- CSS -->".length, gsapStart).trim();
  const rawGsap = content.substring(gsapStart + "<!-- GSAP -->".length).trim();

  return {
    html: content.substring(htmlStart, cssStart).trim(),
    css: stripWrapperTags(rawCss, /<style[^>]*>/gi, /<\/style>/gi),
    gsap: stripWrapperTags(rawGsap, /<script[^>]*>/gi, /<\/script>/gi),
  };
}

// ── Scaffold markers ────────────────────────────────────────────────────────

const SCENE_CONTENT_RE =
  /(<div id="scene(\d+)" class="scene"[^>]*>)\s*<!--\s*SCENE\s+\d+\s+CONTENT\s*-->\s*(<\/div>)/g;
const STYLE_MARKER = "/* SCENE STYLES */";
const GSAP_MARKER = "// SCENE TWEENS";

// ── Public API ──────────────────────────────────────────────────────────────

export interface AssembleOptions {
  /** If true, validate without writing. Default: false */
  dryRun?: boolean;
}

export function assembleScenes(projectDir: string, options?: AssembleOptions): AssembleResult {
  const dir = resolve(projectDir);
  const indexPath = join(dir, "index.html");
  const scenesDir = join(dir, ".hyperframes", "scenes");
  const dryRun = options?.dryRun ?? false;

  const fail = (errors: AssembleError[]): AssembleResult => ({
    ok: false,
    errors,
    lines: 0,
    scenes: 0,
    outputPath: "",
  });

  // ── Check prerequisites ─────────────────────────────────────────────
  if (!existsSync(indexPath)) {
    return fail([{ file: "index.html", message: "Scaffold not found" }]);
  }
  if (!existsSync(scenesDir)) {
    return fail([{ file: ".hyperframes/scenes/", message: "Scenes directory not found" }]);
  }

  const scaffold = readFileSync(indexPath, "utf-8");

  if (!scaffold.includes(STYLE_MARKER)) {
    return fail([{ file: "index.html", message: `Scaffold missing "${STYLE_MARKER}" in <style>` }]);
  }
  if (!scaffold.includes(GSAP_MARKER)) {
    return fail([{ file: "index.html", message: `Scaffold missing "${GSAP_MARKER}" in <script>` }]);
  }

  // Find scene content markers
  const sceneSlots = new Map<number, { open: string; close: string; fullMatch: string }>();
  let match: RegExpExecArray | null;
  const re = new RegExp(SCENE_CONTENT_RE.source, SCENE_CONTENT_RE.flags);
  while ((match = re.exec(scaffold)) !== null) {
    const num = parseInt(match[2]!, 10);
    sceneSlots.set(num, { open: match[1]!, close: match[3]!, fullMatch: match[0]! });
  }

  if (sceneSlots.size === 0) {
    return fail([
      {
        file: "index.html",
        message:
          'No scene content markers found. Expected: <div id="sceneN" class="scene"><!-- SCENE N CONTENT --></div>',
      },
    ]);
  }

  // ── Discover and validate fragments ────────────────────────────────
  const sceneFiles = readdirSync(scenesDir)
    .filter((f) => /^scene\d+\.html$/.test(f))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)![0]!, 10);
      const numB = parseInt(b.match(/\d+/)![0]!, 10);
      return numA - numB;
    });

  if (sceneFiles.length === 0) {
    return fail([{ file: ".hyperframes/scenes/", message: "No scene fragment files found" }]);
  }

  const allErrors: AssembleError[] = [];
  const fragments = new Map<number, FragmentSections>();

  for (const file of sceneFiles) {
    const num = parseInt(file.match(/\d+/)![0]!, 10);
    const content = readFileSync(join(scenesDir, file), "utf-8");
    const errors = validateFragment(content, file);
    allErrors.push(...errors);

    if (errors.length === 0) {
      fragments.set(num, splitFragment(content));
    }

    if (!sceneSlots.has(num)) {
      allErrors.push({ file, message: `No matching scene slot in scaffold for scene ${num}` });
    }
  }

  for (const num of sceneSlots.keys()) {
    if (!fragments.has(num) && !allErrors.some((e) => e.file === `scene${num}.html`)) {
      allErrors.push({
        file: "scaffold",
        message: `Scene slot ${num} has no matching fragment file`,
      });
    }
  }

  if (allErrors.length > 0) {
    return fail(allErrors);
  }

  // ── Assemble ──────────────────────────────────────────────────────
  let output = scaffold;

  // Inject HTML into scene slots
  for (const [num, sections] of fragments) {
    const slot = sceneSlots.get(num)!;
    output = output.replace(slot.fullMatch, `${slot.open}\n${sections.html}\n${slot.close}`);
  }

  // Inject CSS at style marker
  const allCss = [...fragments.entries()]
    .sort(([a], [b]) => a - b)
    .map(([num, s]) => `/* ===== SCENE ${num} ===== */\n${s.css}`)
    .join("\n\n");
  output = output.replace(STYLE_MARKER, `${STYLE_MARKER}\n${allCss}`);

  // Inject GSAP at script marker
  const allGsap = [...fragments.entries()]
    .sort(([a], [b]) => a - b)
    .map(([num, s]) => `// ===== SCENE ${num} =====\n${s.gsap}`)
    .join("\n\n");
  output = output.replace(GSAP_MARKER, `${GSAP_MARKER}\n${allGsap}`);

  // ── Verify output structure ───────────────────────────────────────
  const openDivs = (output.match(/<div[\s>]/g) || []).length;
  const closeDivs = (output.match(/<\/div>/g) || []).length;
  if (openDivs !== closeDivs) {
    return fail([
      {
        file: "assembled output",
        message: `div imbalance: ${openDivs} opening, ${closeDivs} closing (diff: ${openDivs - closeDivs})`,
      },
    ]);
  }

  const lines = output.split("\n").length;

  if (dryRun) {
    return { ok: true, errors: [], lines, scenes: fragments.size, outputPath: "" };
  }

  writeFileSync(indexPath, output, "utf-8");
  return { ok: true, errors: [], lines, scenes: fragments.size, outputPath: indexPath };
}
