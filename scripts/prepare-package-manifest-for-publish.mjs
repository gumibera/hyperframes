#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(import.meta.dirname, "..");
const PACKAGES_DIR = join(ROOT, "packages");
const BACKUP_DIR = join(tmpdir(), "hyperframes-publish-manifest-backups");
const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

function loadPackageJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function listWorkspacePackages() {
  return readdirSync(PACKAGES_DIR)
    .map((dir) => join(PACKAGES_DIR, dir, "package.json"))
    .filter((path) => existsSync(path));
}

function getBackupPath(packageJsonPath) {
  const digest = createHash("sha256").update(packageJsonPath).digest("hex");
  return join(BACKUP_DIR, `${digest}.json`);
}

function resolveWorkspaceSpec(spec, version, packageJsonPath, depName) {
  const workspaceSpec = spec.slice("workspace:".length);

  if (workspaceSpec === "" || workspaceSpec === "*") return version;
  if (workspaceSpec === "^") return `^${version}`;
  if (workspaceSpec === "~") return `~${version}`;

  throw new Error(
    `Unsupported workspace spec "${spec}" for ${depName} in ${packageJsonPath}. ` +
      "Update the publish rewrite script before publishing this package.",
  );
}

function main() {
  const packageJsonPath = join(process.cwd(), "package.json");
  const pkg = loadPackageJson(packageJsonPath);
  const workspacePackages = new Map(
    listWorkspacePackages().map((path) => {
      const workspacePkg = loadPackageJson(path);
      return [workspacePkg.name, workspacePkg.version];
    }),
  );

  mkdirSync(BACKUP_DIR, { recursive: true });
  const backupPath = getBackupPath(packageJsonPath);
  try {
    readFileSync(backupPath, "utf8");
  } catch {
    writeFileSync(backupPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  let rewrites = 0;

  for (const field of DEP_FIELDS) {
    const deps = pkg[field];
    if (!deps) continue;

    for (const [depName, spec] of Object.entries(deps)) {
      if (!String(spec).startsWith("workspace:")) continue;

      const depVersion = workspacePackages.get(depName);
      if (!depVersion) {
        throw new Error(`Cannot resolve workspace dependency ${depName} in ${packageJsonPath}`);
      }

      const resolvedSpec = resolveWorkspaceSpec(spec, depVersion, packageJsonPath, depName);
      deps[depName] = resolvedSpec;
      rewrites += 1;
      console.log(`${pkg.name} ${field} ${depName}: ${spec} -> ${resolvedSpec}`);
    }
  }

  if (rewrites > 0) {
    writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  console.log(`Prepared ${pkg.name} for packing by rewriting ${rewrites} workspace reference(s).`);
}

main();
