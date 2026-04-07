/**
 * Split captured website into per-section HyperFrames sub-compositions.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseSections } from "./sectionParser.js";
import { generateComposition, generateRootComposition } from "./compositionGen.js";
import type { CaptureResult, SectionResult } from "../types.js";

export async function splitCapture(
  captureResult: CaptureResult,
  maxSections: number = 12,
): Promise<SectionResult[]> {
  const { extracted, tokens, projectDir } = captureResult;

  // Parse body HTML into sections
  const parsedSections = parseSections(extracted.bodyHtml, tokens.sections, maxSections);

  if (parsedSections.length === 0) {
    return [];
  }

  // Create compositions directory
  const compositionsDir = join(projectDir, "compositions");
  mkdirSync(compositionsDir, { recursive: true });

  // Generate sub-composition for each section
  const results: SectionResult[] = [];

  for (const section of parsedSections) {
    const compositionHtml = generateComposition(
      section,
      extracted.headHtml,
      extracted.cssomRules,
      extracted.htmlAttrs,
      extracted.viewportWidth,
    );

    const filename = `${section.id}.html`;
    const filePath = join(compositionsDir, filename);
    writeFileSync(filePath, compositionHtml, "utf-8");

    results.push({
      id: section.id,
      type: section.type,
      heading: section.heading,
      compositionPath: `compositions/${filename}`,
      verified: false, // Will be set by verify step
    });
  }

  // Generate root index.html
  const rootHtml = generateRootComposition(
    results.map((r) => r.id),
    tokens.title,
  );
  writeFileSync(join(projectDir, "index.html"), rootHtml, "utf-8");

  return results;
}
