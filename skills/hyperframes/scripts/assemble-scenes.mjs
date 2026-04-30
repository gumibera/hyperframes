#!/usr/bin/env bun

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hyperframesPackageSpec, importPackagesOrBootstrap } from "./package-loader.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

function usage() {
  console.log(
    "Usage: bun skills/hyperframes/scripts/assemble-scenes.mjs <project-dir> [--dry-run]",
  );
}

function printErrors(title, errors) {
  console.error(title);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
}

function fail(title, errors) {
  printErrors(title, errors);
  process.exit(1);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { __parseError: error instanceof Error ? error.message : String(error) };
  }
}

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function validateManifest(projectDir) {
  const manifestPath = join(projectDir, ".hyperframes", "scene-manifest.json");
  if (!existsSync(manifestPath)) {
    return [`Missing ${manifestPath}`];
  }

  const manifest = readJson(manifestPath);
  if (manifest.__parseError) {
    return [`Could not parse ${manifestPath}: ${manifest.__parseError}`];
  }

  const scenes = Array.isArray(manifest.scenes) ? manifest.scenes : null;
  if (!scenes) return [`${manifestPath} must contain a scenes array`];
  if (scenes.length === 0) return [`${manifestPath} must contain at least one scene`];

  const errors = [];
  const seen = new Set();
  const compositionDuration = toNumber(manifest.composition?.duration);
  const compositionWidth = toNumber(manifest.composition?.width);
  const compositionHeight = toNumber(manifest.composition?.height);

  if (typeof manifest.composition?.register !== "string" || !manifest.composition.register.trim()) {
    errors.push("composition.register must name the global register");
  }
  if (!Number.isFinite(compositionDuration) || compositionDuration <= 0) {
    errors.push("composition.duration must be a positive finite number");
  }
  if (!Number.isInteger(compositionWidth) || compositionWidth <= 0) {
    errors.push("composition.width must be a positive integer");
  }
  if (!Number.isInteger(compositionHeight) || compositionHeight <= 0) {
    errors.push("composition.height must be a positive integer");
  }

  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const label = `scene manifest row ${index + 1}`;
    const number = toNumber(scene?.number);
    const start = toNumber(scene?.start);
    const duration = toNumber(scene?.duration);
    const end = toNumber(scene?.end);

    if (!Number.isInteger(number) || number < 1) {
      errors.push(`${label}: number must be a positive integer`);
      continue;
    }

    if (seen.has(number)) errors.push(`${label}: duplicate scene number ${number}`);
    seen.add(number);

    if (typeof scene?.title !== "string" || !scene.title.trim()) {
      errors.push(`scene${number}: title must be a non-empty string`);
    }
    if (typeof scene?.registerFit !== "string" || !scene.registerFit.trim()) {
      errors.push(`scene${number}: registerFit must be a non-empty string`);
    }

    if (!Number.isFinite(start)) errors.push(`scene${number}: start must be a finite number`);
    if (!Number.isFinite(duration) || duration <= 0) {
      errors.push(`scene${number}: duration must be a positive number`);
    }
    if (!Number.isFinite(end)) errors.push(`scene${number}: end must be a finite number`);
    if (Number.isFinite(start) && Number.isFinite(duration) && Number.isFinite(end)) {
      const expectedEnd = start + duration;
      if (Math.abs(end - expectedEnd) > 0.001) {
        errors.push(`scene${number}: end ${end} must equal start + duration (${expectedEnd})`);
      }
    }

    if (index < scenes.length - 1) {
      const nextSceneStart = toNumber(scenes[index + 1]?.start);
      const transition = scene?.transitionOut;
      if (!transition || typeof transition !== "object") {
        errors.push(`scene${number}: non-final scenes must define transitionOut`);
      } else {
        const transitionStart = toNumber(transition.start);
        const transitionDuration = toNumber(transition.duration);
        const transitionEnd = toNumber(transition.end);
        if (!Number.isFinite(transitionStart)) {
          errors.push(`scene${number}: transitionOut.start must be a finite number`);
        }
        if (!Number.isFinite(transitionDuration) || transitionDuration < 0) {
          errors.push(`scene${number}: transitionOut.duration must be a non-negative number`);
        }
        if (!Number.isFinite(transitionEnd)) {
          errors.push(`scene${number}: transitionOut.end must be a finite number`);
        }
        if (typeof transition.type !== "string" || !transition.type.trim()) {
          errors.push(`scene${number}: transitionOut.type must be a non-empty string`);
        }
        if (typeof transition.reason !== "string" || !transition.reason.trim()) {
          errors.push(`scene${number}: transitionOut.reason must be a non-empty string`);
        }
        if (
          Number.isFinite(transitionStart) &&
          Number.isFinite(transitionDuration) &&
          Number.isFinite(transitionEnd) &&
          Math.abs(transitionEnd - (transitionStart + transitionDuration)) > 0.001
        ) {
          errors.push(`scene${number}: transitionOut.end must equal start + duration`);
        }
        if (Number.isFinite(transitionEnd) && Number.isFinite(end) && transitionEnd > end + 0.001) {
          errors.push(`scene${number}: transitionOut.end must not exceed scene end`);
        }
        if (
          Number.isFinite(transitionEnd) &&
          Number.isFinite(end) &&
          Math.abs(transitionEnd - end) > 0.001
        ) {
          errors.push(`scene${number}: transitionOut.end must equal scene end`);
        }
        if (
          Number.isFinite(transitionEnd) &&
          Number.isFinite(nextSceneStart) &&
          Math.abs(transitionEnd - nextSceneStart) > 0.001
        ) {
          errors.push(`scene${number}: transitionOut.end must equal next scene start`);
        }
        if (transition.hardCut === true && transitionDuration !== 0) {
          errors.push(`scene${number}: hard cuts must use transitionOut.duration 0`);
        }
        if (transition.hardCut !== true && transitionDuration === 0) {
          errors.push(`scene${number}: non-hard-cut transitions must use duration greater than 0`);
        }
      }
    } else if (scene?.transitionOut !== null) {
      errors.push(`scene${number}: final scene must use transitionOut: null`);
    }

    if (!hasOwn(scene, "r4")) {
      errors.push(`scene${number}: r4 must be null or a persistent-subject object`);
    } else if (scene.r4 !== null) {
      const r4 = scene.r4;
      if (!r4 || typeof r4 !== "object") {
        errors.push(`scene${number}: r4 must be null or an object`);
      } else {
        for (const field of [
          "role",
          "reservedRegion",
          "center",
          "scale",
          "motionAcrossBoundary",
          "sceneRelationship",
        ]) {
          if (!hasOwn(r4, field)) errors.push(`scene${number}: r4.${field} is required`);
        }
      }
    }

    const scenePath = join(projectDir, ".hyperframes", "scenes", `scene${number}.html`);
    if (!existsSync(scenePath)) {
      errors.push(`scene${number}: missing fragment ${scenePath}`);
      continue;
    }

    const content = readFileSync(scenePath, "utf8");
    const sceneVar = new RegExp(`^\\s*var\\s+S${number}\\s*=\\s*(-?\\d+(?:\\.\\d+)?)\\s*;`, "m");
    const sceneVarMatch = content.match(sceneVar);
    if (!sceneVarMatch) {
      errors.push(`scene${number}: fragment must define "var S${number} = ${start};"`);
      continue;
    }

    const sceneVarStart = Number(sceneVarMatch[1]);
    if (Number.isFinite(start) && Math.abs(sceneVarStart - start) > 0.001) {
      errors.push(`scene${number}: var S${number} is ${sceneVarStart}, manifest start is ${start}`);
    }

    const evalPath = join(projectDir, ".hyperframes", "scenes", `scene${number}.eval.md`);
    if (!existsSync(evalPath)) {
      errors.push(`scene${number}: missing evaluation ${evalPath}`);
      continue;
    }

    const evalContent = readFileSync(evalPath, "utf8");
    const verdictMatch = evalContent.match(/^Verdict:\s*(PASS|FAIL)\s*$/m);
    if (!verdictMatch) {
      errors.push(`scene${number}: evaluation must contain a standalone "Verdict: PASS" line`);
    } else if (verdictMatch[1] !== "PASS") {
      errors.push(`scene${number}: evaluation verdict is ${verdictMatch[1]}, expected PASS`);
    }
  }

  const finalSceneEnd = toNumber(scenes.at(-1)?.end);
  if (
    Number.isFinite(compositionDuration) &&
    Number.isFinite(finalSceneEnd) &&
    Math.abs(compositionDuration - finalSceneEnd) > 0.001
  ) {
    errors.push(
      `composition.duration ${compositionDuration} must equal final scene end ${finalSceneEnd}`,
    );
  }

  return errors;
}

async function importAssembler() {
  try {
    return await import("@hyperframes/core/assemble");
  } catch (packageError) {
    const localCoreAssembler = join(
      HERE,
      "..",
      "..",
      "..",
      "packages",
      "core",
      "src",
      "assemble",
      "index.ts",
    );
    if (existsSync(localCoreAssembler)) {
      return await import(pathToFileURL(localCoreAssembler).href);
    }

    try {
      const packages = await importPackagesOrBootstrap(["@hyperframes/core/assemble"], {
        npmPackages: [hyperframesPackageSpec("@hyperframes/core")],
      });
      return packages["@hyperframes/core/assemble"];
    } catch (loaderError) {
      const packageMessage =
        packageError instanceof Error ? packageError.message : String(packageError);
      const loaderMessage =
        loaderError instanceof Error ? loaderError.message : String(loaderError);
      throw new Error(
        [
          `Could not import @hyperframes/core/assemble: ${packageMessage}`,
          `Package bootstrap also failed: ${loaderMessage}`,
        ].join("\n\n"),
      );
    }
  }
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  usage();
  process.exit(0);
}

const dryRun = args.includes("--dry-run");
const projectArg = args.find((arg) => !arg.startsWith("-"));
const projectDir = resolve(projectArg ?? process.cwd());

const manifestErrors = validateManifest(projectDir);
if (manifestErrors.length > 0) {
  fail("Scene manifest validation failed:", manifestErrors);
}

const { assembleScenes } = await importAssembler();
const result = assembleScenes(projectDir, { dryRun });

if (!result.ok) {
  fail(
    "Scene assembly failed:",
    result.errors.map((error) => `${error.file}: ${error.message}`),
  );
}

console.log(
  [
    dryRun ? "Scene assembly dry-run passed." : "Scene assembly complete.",
    `scenes=${result.scenes}`,
    `lines=${result.lines}`,
    result.outputPath ? `output=${result.outputPath}` : null,
  ]
    .filter(Boolean)
    .join(" "),
);
