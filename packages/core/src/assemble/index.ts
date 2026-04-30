/**
 * Deterministic multi-scene assembly.
 *
 * Reads a scaffold (`index.html`) and scene fragments
 * (`.hyperframes/scenes/sceneN.html`), validates each fragment against the
 * Scene Fragment Spec, splits on markers, and injects the pieces into the
 * scaffold.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface AssembleResult {
  ok: boolean;
  errors: AssembleError[];
  lines: number;
  scenes: number;
  outputPath: string;
}

export interface AssembleError {
  file: string;
  message: string;
}

export interface AssembleOptions {
  dryRun?: boolean;
}

interface FragmentSections {
  html: string;
  css: string;
  gsap: string;
}

const HTML_MARKER = "<!-- HTML -->";
const CSS_MARKER = "<!-- CSS -->";
const GSAP_MARKER = "<!-- GSAP -->";
const STYLE_MARKER = "/* SCENE STYLES */";
const TWEENS_MARKER = "// SCENE TWEENS";
const GENERATED_STYLES_START = "/* HYPERFRAMES GENERATED SCENE STYLES START */";
const GENERATED_STYLES_END = "/* HYPERFRAMES GENERATED SCENE STYLES END */";
const GENERATED_TWEENS_START = "// HYPERFRAMES GENERATED SCENE TWEENS START";
const GENERATED_TWEENS_END = "// HYPERFRAMES GENERATED SCENE TWEENS END";

const PROHIBITED_PATTERNS: Array<[RegExp, string]> = [
  [/<!DOCTYPE/i, "DOCTYPE declaration; fragments must not be standalone documents"],
  [/<html[\s>]/i, "<html> tag; fragments must not be standalone documents"],
  [/<head[\s>]/i, "<head> tag; fragments must not be standalone documents"],
  [/<body[\s>]/i, "<body> tag; fragments must not be standalone documents"],
  [/<style[\s>]/i, "<style> tag; CSS section must be raw CSS"],
  [/<\/style>/i, "</style> tag; CSS section must be raw CSS"],
  [/<script[\s>]/i, "<script> tag; GSAP section must be raw JS"],
  [/<\/script>/i, "</script> tag; GSAP section must be raw JS"],
  [/<script\s+src=/i, "external script loading; the scaffold handles dependencies"],
  [/gsap\.timeline\s*\(/i, "gsap.timeline(); the scaffold creates the timeline"],
  [/\bgsap\.set\s*\(/i, "gsap.set(); use the scaffold timeline's tl.set() instead"],
  [/\bgsap\.to\s*\(/i, "gsap.to(); use the scaffold timeline's tl.to() instead"],
  [/\bgsap\.from\s*\(/i, "gsap.from(); use tl.set() and tl.to() instead"],
  [/\bgsap\.fromTo\s*\(/i, "gsap.fromTo(); use tl.set() and tl.to() instead"],
  [/window\.__timelines/i, "window.__timelines; the scaffold registers it"],
  [/\btl\.from\s*\(/i, "tl.from(); use tl.set() and tl.to() instead"],
  [/\btl\.fromTo\s*\(/i, "tl.fromTo(); use tl.set() and tl.to() instead"],
];

interface CssRule {
  selector: string;
  declarations: string;
}

interface TimelineCall {
  method: string;
  args: string[];
}

interface SceneOpening {
  sceneNumber: number;
  index: number;
  endIndex: number;
}

function countMarker(content: string, marker: string): number {
  return content.split(marker).length - 1;
}

function createSceneHtmlStartMarker(sceneNumber: number): string {
  return `<!-- HYPERFRAMES GENERATED SCENE ${sceneNumber} HTML START -->`;
}

function createSceneHtmlEndMarker(sceneNumber: number): string {
  return `<!-- HYPERFRAMES GENERATED SCENE ${sceneNumber} HTML END -->`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitTopLevelArgs(args: string): string[] {
  const result: string[] = [];
  let current = "";
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (const char of args) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }

    if (char === "(" || char === "{" || char === "[") {
      depth += 1;
      current += char;
      continue;
    }

    if (char === ")" || char === "}" || char === "]") {
      depth -= 1;
      current += char;
      continue;
    }

    if (char === "," && depth === 0) {
      result.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function findMatchingParen(content: string, openParenIndex: number): number {
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (let index = openParenIndex; index < content.length; index += 1) {
    const char = content[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function findTimelineCalls(gsap: string): TimelineCall[] {
  const calls: TimelineCall[] = [];
  const timelineCallPattern = /\btl\.(set|to)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = timelineCallPattern.exec(gsap)) !== null) {
    const method = match[1];
    if (method !== "set" && method !== "to") continue;
    const openParenIndex = gsap.indexOf("(", match.index);
    const closeParenIndex = findMatchingParen(gsap, openParenIndex);
    if (closeParenIndex === -1) {
      calls.push({ method, args: [] });
      continue;
    }

    calls.push({
      method,
      args: splitTopLevelArgs(gsap.slice(openParenIndex + 1, closeParenIndex)),
    });
    timelineCallPattern.lastIndex = closeParenIndex + 1;
  }

  return calls;
}

function getCssRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;

  while ((match = rulePattern.exec(css)) !== null) {
    const rawSelector = match[1];
    const declarations = match[2];
    if (rawSelector === undefined || declarations === undefined) continue;
    const selector = rawSelector.trim();
    if (!selector || selector.startsWith("@") || selector === "from" || selector === "to") {
      continue;
    }

    rules.push({ selector, declarations });
  }

  return rules;
}

function getCssRulePropertyNames(declarations: string): Set<string> {
  const names = new Set<string>();
  const propertyPattern = /(^|[;\s])([a-z-]+)\s*:/gi;
  let match: RegExpExecArray | null;

  while ((match = propertyPattern.exec(declarations)) !== null) {
    const propertyName = match[2];
    if (propertyName !== undefined) names.add(propertyName.toLowerCase());
  }

  return names;
}

function getSelectorTokens(selector: string): string[] {
  const tokens: string[] = [];
  const tokenPattern = /[#.](-?[_a-zA-Z][\w-]*)/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(selector)) !== null) {
    const token = match[1];
    if (token !== undefined) tokens.push(token);
  }

  return tokens;
}

function selectorContainsBodyElement(selector: string): boolean {
  return selector.split(",").some((part) => /(^|[\s>+~])body(?=$|[\s.#:[>+~])/i.test(part.trim()));
}

function validatePrefixedSelector(
  selector: string,
  sceneNumber: number,
  file: string,
  context: string,
): AssembleError[] {
  const errors: AssembleError[] = [];
  const prefix = `s${sceneNumber}-`;

  for (const token of getSelectorTokens(selector)) {
    if (token.startsWith(prefix)) continue;
    errors.push({
      file,
      message: `${context} selector "${selector}" uses "${token}", expected "${prefix}" prefix`,
    });
  }

  return errors;
}

function validateHtmlPrefixes(html: string, sceneNumber: number, file: string): AssembleError[] {
  const errors: AssembleError[] = [];
  const prefix = `s${sceneNumber}-`;
  const attrPattern = /\b(id|class)\s*=\s*(["'])(.*?)\2/gis;
  let match: RegExpExecArray | null;

  while ((match = attrPattern.exec(html)) !== null) {
    const attrName = match[1]?.toLowerCase();
    const attrValue = match[3];
    if (attrName === undefined || attrValue === undefined) continue;
    const tokens = attrName === "class" ? attrValue.split(/\s+/) : [attrValue];
    for (const token of tokens) {
      if (!token) continue;
      if (!token.startsWith(prefix)) {
        errors.push({
          file,
          message: `HTML ${attrName} "${token}" must use "${prefix}" prefix`,
        });
      }
    }
  }

  return errors;
}

function validateCss(
  css: string,
  gsap: string,
  sceneNumber: number,
  file: string,
): AssembleError[] {
  const errors: AssembleError[] = [];
  const ownedSceneProperties = new Set([
    "position",
    "top",
    "left",
    "width",
    "height",
    "opacity",
    "z-index",
  ]);
  const animatedSelectors = new Set<string>();

  for (const call of findTimelineCalls(gsap)) {
    const target = call.args[0] ?? "";
    for (const selector of getSelectorTokens(target)) animatedSelectors.add(selector);
  }

  for (const rule of getCssRules(css)) {
    errors.push(...validatePrefixedSelector(rule.selector, sceneNumber, file, "CSS"));

    if (selectorContainsBodyElement(rule.selector)) {
      errors.push({ file, message: "CSS must not style body; the scaffold owns body styles" });
    }

    if (/(^|[^\w-])\.scene([^\w-]|$)/.test(rule.selector)) {
      errors.push({ file, message: "CSS must not style .scene; the scaffold owns scene styles" });
    }

    if (new RegExp(`#scene${sceneNumber}(?![\\w-])`).test(rule.selector)) {
      const propertyNames = getCssRulePropertyNames(rule.declarations);
      for (const propertyName of propertyNames) {
        if (ownedSceneProperties.has(propertyName)) {
          errors.push({
            file,
            message: `CSS must not set ${propertyName} on #scene${sceneNumber}; the scaffold owns scene containers`,
          });
        }
      }
    }

    const hasCenteredTransform = /transform\s*:[^;{}]*translate\s*\(\s*-50%\s*,\s*-50%\s*\)/i.test(
      rule.declarations,
    );
    if (hasCenteredTransform) {
      const centeredTokens = getSelectorTokens(rule.selector);
      const animatesCenteredElement = centeredTokens.some((token) => animatedSelectors.has(token));
      if (animatesCenteredElement || centeredTokens.length === 0) {
        errors.push({
          file,
          message:
            "CSS transform centering with translate(-50%, -50%) conflicts with GSAP transforms; use xPercent/yPercent in tl.set()",
        });
      }
    }
  }

  return errors;
}

function validateGsap(gsap: string, sceneNumber: number, file: string): AssembleError[] {
  const errors: AssembleError[] = [];
  const sceneVar = `S${sceneNumber}`;
  const sceneVarPattern = new RegExp(
    `^\\s*var\\s+${sceneVar}\\s*=\\s*-?\\d+(?:\\.\\d+)?\\s*;`,
    "m",
  );
  const repeatPattern = /\brepeat\s*:\s*([^,}\n]+)/g;
  let repeatMatch: RegExpExecArray | null;

  if (!sceneVarPattern.test(gsap)) {
    errors.push({
      file,
      message: `GSAP section must define "var ${sceneVar} = <start_time>;"`,
    });
  }

  while ((repeatMatch = repeatPattern.exec(gsap)) !== null) {
    const rawValue = repeatMatch[1];
    if (rawValue === undefined) continue;
    const value = rawValue.trim();
    const repeatValue = Number(value);
    if (!/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(repeatValue)) {
      errors.push({
        file,
        message: `GSAP repeat value "${value}" must be a finite non-negative number`,
      });
    }
  }

  for (const call of findTimelineCalls(gsap)) {
    if (call.args.length === 0) {
      errors.push({ file, message: `Unable to parse tl.${call.method}() call` });
      continue;
    }

    const target = call.args[0] ?? "";
    errors.push(...validatePrefixedSelector(target, sceneNumber, file, "GSAP"));

    const position = call.args[2] ?? "";
    if (call.method === "set" && position !== "0") {
      errors.push({ file, message: "tl.set() calls must use time 0 as the third argument" });
    }

    if (call.method === "to" && !new RegExp(`\\b${sceneVar}\\b`).test(position)) {
      errors.push({
        file,
        message: `tl.to() calls must use ${sceneVar} in the position argument`,
      });
    }
  }

  return errors;
}

function validateFragment(content: string, file: string): AssembleError[] {
  const errors: AssembleError[] = [];
  const sceneNumber = getSceneNumber(file);
  const markerCounts: Array<[string, number]> = [
    [HTML_MARKER, countMarker(content, HTML_MARKER)],
    [CSS_MARKER, countMarker(content, CSS_MARKER)],
    [GSAP_MARKER, countMarker(content, GSAP_MARKER)],
  ];

  for (const [marker, count] of markerCounts) {
    if (count !== 1) {
      errors.push({ file, message: `Expected 1 ${marker} marker, found ${count}` });
    }
  }

  const htmlPosition = content.indexOf(HTML_MARKER);
  const cssPosition = content.indexOf(CSS_MARKER);
  const gsapPosition = content.indexOf(GSAP_MARKER);
  if (htmlPosition >= 0 && cssPosition >= 0 && gsapPosition >= 0) {
    if (!(htmlPosition < cssPosition && cssPosition < gsapPosition)) {
      errors.push({
        file,
        message: `Markers must appear in order: ${HTML_MARKER}, ${CSS_MARKER}, ${GSAP_MARKER}`,
      });
    }
  }

  for (const [pattern, reason] of PROHIBITED_PATTERNS) {
    if (pattern.test(content)) {
      errors.push({ file, message: `Prohibited: ${reason}` });
    }
  }

  const hasValidMarkers =
    markerCounts.every(([, count]) => count === 1) &&
    htmlPosition >= 0 &&
    cssPosition >= 0 &&
    gsapPosition >= 0 &&
    htmlPosition < cssPosition &&
    cssPosition < gsapPosition;

  if (hasValidMarkers && Number.isFinite(sceneNumber)) {
    const sections = splitFragment(content);
    errors.push(...validateHtmlPrefixes(sections.html, sceneNumber, file));
    errors.push(...validateCss(sections.css, sections.gsap, sceneNumber, file));
    errors.push(...validateGsap(sections.gsap, sceneNumber, file));
  }

  return errors;
}

function splitFragment(content: string): FragmentSections {
  const htmlStart = content.indexOf(HTML_MARKER) + HTML_MARKER.length;
  const cssStart = content.indexOf(CSS_MARKER);
  const gsapStart = content.indexOf(GSAP_MARKER);

  return {
    html: content.slice(htmlStart, cssStart).trim(),
    css: content.slice(cssStart + CSS_MARKER.length, gsapStart).trim(),
    gsap: content.slice(gsapStart + GSAP_MARKER.length).trim(),
  };
}

function fail(errors: AssembleError[]): AssembleResult {
  return {
    ok: false,
    errors,
    lines: 0,
    scenes: 0,
    outputPath: "",
  };
}

function getSceneNumber(file: string): number {
  return Number(file.match(/\d+/)?.[0] ?? Number.NaN);
}

function getAttributeValue(tag: string, attrName: string): string | null {
  const attrPattern = new RegExp(`\\b${attrName}\\s*=\\s*(["'])(.*?)\\1`, "i");
  const match = tag.match(attrPattern);
  return match?.[2] ?? null;
}

function getSceneOpenings(scaffold: string): SceneOpening[] {
  const openings: SceneOpening[] = [];
  const divPattern = /<div\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = divPattern.exec(scaffold)) !== null) {
    const tag = match[0];
    const id = getAttributeValue(tag, "id");
    const className = getAttributeValue(tag, "class");
    const sceneNumber = Number(id?.match(/^scene(\d+)$/)?.[1] ?? Number.NaN);
    const classTokens = className?.split(/\s+/) ?? [];

    if (Number.isFinite(sceneNumber) && classTokens.includes("scene")) {
      openings.push({
        sceneNumber,
        index: match.index,
        endIndex: divPattern.lastIndex,
      });
    }
  }

  return openings;
}

function getSceneSlots(scaffold: string): Set<number> {
  const sceneSlots = new Set<number>();
  const openings = getSceneOpenings(scaffold);

  openings.forEach((opening, index) => {
    const nextOpening = openings[index + 1];
    const marker = `<!-- SCENE ${opening.sceneNumber} CONTENT -->`;
    const sceneSegment = scaffold.slice(opening.endIndex, nextOpening?.index ?? scaffold.length);
    if (sceneSegment.includes(marker)) sceneSlots.add(opening.sceneNumber);
  });

  return sceneSlots;
}

function replaceGeneratedBlock(
  output: string,
  marker: string,
  start: string,
  end: string,
  content: string,
): string {
  const generatedBlock = `${start}\n${content}\n${end}`;
  const existingBlockPattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);

  if (existingBlockPattern.test(output)) {
    return output.replace(existingBlockPattern, generatedBlock);
  }

  return output.replace(marker, `${marker}\n${generatedBlock}`);
}

export function assembleScenes(projectDir: string, options: AssembleOptions = {}): AssembleResult {
  const dir = resolve(projectDir);
  const indexPath = join(dir, "index.html");
  const scenesDir = join(dir, ".hyperframes", "scenes");

  if (!existsSync(indexPath)) {
    return fail([{ file: "index.html", message: "Scaffold not found" }]);
  }

  if (!existsSync(scenesDir)) {
    return fail([{ file: ".hyperframes/scenes/", message: "Scenes directory not found" }]);
  }

  const scaffold = readFileSync(indexPath, "utf-8");
  if (!scaffold.includes(STYLE_MARKER)) {
    return fail([{ file: "index.html", message: `Scaffold missing "${STYLE_MARKER}"` }]);
  }

  if (!scaffold.includes(TWEENS_MARKER)) {
    return fail([{ file: "index.html", message: `Scaffold missing "${TWEENS_MARKER}"` }]);
  }

  const sceneSlots = getSceneSlots(scaffold);
  if (sceneSlots.size === 0) {
    return fail([
      {
        file: "index.html",
        message:
          'No scene content markers found. Expected: <div id="sceneN" class="scene"><!-- SCENE N CONTENT --></div>',
      },
    ]);
  }

  const sceneFiles = readdirSync(scenesDir)
    .filter((file) => /^scene\d+\.html$/.test(file))
    .sort((a, b) => getSceneNumber(a) - getSceneNumber(b));

  if (sceneFiles.length === 0) {
    return fail([{ file: ".hyperframes/scenes/", message: "No scene fragment files found" }]);
  }

  const errors: AssembleError[] = [];
  const fragments = new Map<number, FragmentSections>();

  for (const file of sceneFiles) {
    const sceneNumber = getSceneNumber(file);
    const content = readFileSync(join(scenesDir, file), "utf-8");
    const fragmentErrors = validateFragment(content, file);
    errors.push(...fragmentErrors);

    if (fragmentErrors.length === 0) {
      fragments.set(sceneNumber, splitFragment(content));
    }

    if (!sceneSlots.has(sceneNumber)) {
      errors.push({ file, message: `No matching scene slot in scaffold for scene ${sceneNumber}` });
    }
  }

  for (const sceneNumber of sceneSlots) {
    const sceneFile = `scene${sceneNumber}.html`;
    const hasFileError = errors.some((error) => error.file === sceneFile);
    if (!fragments.has(sceneNumber) && !hasFileError) {
      errors.push({
        file: "index.html",
        message: `Scene slot ${sceneNumber} has no fragment file`,
      });
    }
  }

  if (errors.length > 0) return fail(errors);

  let output = scaffold;
  const sortedFragments = [...fragments.entries()].sort(([a], [b]) => a - b);

  for (const [sceneNumber, sections] of sortedFragments) {
    const marker = `<!-- SCENE ${sceneNumber} CONTENT -->`;
    output = replaceGeneratedBlock(
      output,
      marker,
      createSceneHtmlStartMarker(sceneNumber),
      createSceneHtmlEndMarker(sceneNumber),
      sections.html,
    );
  }

  const sceneCss = sortedFragments
    .map(([sceneNumber, sections]) => `/* ===== SCENE ${sceneNumber} ===== */\n${sections.css}`)
    .join("\n\n");
  output = replaceGeneratedBlock(
    output,
    STYLE_MARKER,
    GENERATED_STYLES_START,
    GENERATED_STYLES_END,
    sceneCss,
  );

  const sceneGsap = sortedFragments
    .map(([sceneNumber, sections]) => `// ===== SCENE ${sceneNumber} =====\n${sections.gsap}`)
    .join("\n\n");
  output = replaceGeneratedBlock(
    output,
    TWEENS_MARKER,
    GENERATED_TWEENS_START,
    GENERATED_TWEENS_END,
    sceneGsap,
  );

  const openingDivs = output.match(/<div[\s>]/g)?.length ?? 0;
  const closingDivs = output.match(/<\/div>/g)?.length ?? 0;
  if (openingDivs !== closingDivs) {
    return fail([
      {
        file: "assembled output",
        message: `div imbalance: ${openingDivs} opening, ${closingDivs} closing`,
      },
    ]);
  }

  const lines = output.split("\n").length;
  if (options.dryRun) {
    return { ok: true, errors: [], lines, scenes: sortedFragments.length, outputPath: "" };
  }

  writeFileSync(indexPath, output, "utf-8");
  return { ok: true, errors: [], lines, scenes: sortedFragments.length, outputPath: indexPath };
}
