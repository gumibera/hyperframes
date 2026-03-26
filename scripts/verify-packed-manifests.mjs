#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function listWorkspacePackageDirs() {
  return readdirSync(PACKAGES_DIR)
    .map((dir) => join("packages", dir))
    .filter((dir) => existsSync(join(ROOT, dir, "package.json")));
}

function listWorkspaceRefs(pkg) {
  const refs = [];

  for (const field of DEP_FIELDS) {
    for (const [depName, spec] of Object.entries(pkg[field] || {})) {
      if (String(spec).startsWith("workspace:")) {
        refs.push(`${field}:${depName}=${spec}`);
      }
    }
  }

  return refs;
}

function parsePackJson(output, workspace) {
  const match = output.match(/(\[\s*{[\s\S]*}\s*])\s*$/);
  if (!match) {
    throw new Error(`Could not parse npm pack JSON output for ${workspace}`);
  }

  return JSON.parse(match[1]);
}

function main() {
  for (const workspace of listWorkspacePackageDirs()) {
    const sourcePackageJson = JSON.parse(
      readFileSync(join(ROOT, workspace, "package.json"), "utf8"),
    );
    if (listWorkspaceRefs(sourcePackageJson).length === 0) continue;

    const packOutput = execFileSync("npm", ["pack", "--json", "--workspace", workspace], {
      cwd: ROOT,
      encoding: "utf8",
    });
    const [{ filename }] = parsePackJson(packOutput, workspace);

    try {
      const packedPackageJson = execFileSync("tar", ["-xOf", filename, "package/package.json"], {
        cwd: ROOT,
        encoding: "utf8",
      });
      const packedRefs = listWorkspaceRefs(JSON.parse(packedPackageJson));

      if (packedRefs.length > 0) {
        throw new Error(
          `Packed manifest for ${workspace} still contains workspace refs: ${packedRefs.join(", ")}`,
        );
      }

      console.log(`Verified ${workspace}: packed manifest is publish-safe.`);
    } finally {
      rmSync(join(ROOT, filename), { force: true });
    }
  }
}

main();
