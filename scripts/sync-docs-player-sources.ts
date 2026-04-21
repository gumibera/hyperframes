#!/usr/bin/env tsx

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DURATION_SECONDS = 10;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const registryDir = join(repoRoot, "registry");
const docsRegistryDir = join(repoRoot, "docs", "public", "registry");

function walkHtmlFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

function patchExampleHtml(dir: string): void {
  for (const file of walkHtmlFiles(dir)) {
    let content = readFileSync(file, "utf-8");
    content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/video>/g, "");
    content = content.replace(/<video[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>[\s\S]*?<\/audio>/g, "");
    content = content.replace(/<audio[^>]*src="__VIDEO_SRC__"[^>]*>/g, "");
    content = content.replaceAll("__VIDEO_DURATION__", String(DEFAULT_DURATION_SECONDS));
    writeFileSync(file, content, "utf-8");
  }
}

function syncDirectory(relativeDir: string): void {
  const sourceDir = join(registryDir, relativeDir);
  const targetDir = join(docsRegistryDir, relativeDir);

  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return;
  }

  mkdirSync(dirname(targetDir), { recursive: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}

function main(): void {
  rmSync(docsRegistryDir, { recursive: true, force: true });
  mkdirSync(docsRegistryDir, { recursive: true });

  const registryManifestPath = join(registryDir, "registry.json");
  if (existsSync(registryManifestPath)) {
    cpSync(registryManifestPath, join(docsRegistryDir, "registry.json"));
  }

  syncDirectory("blocks");
  syncDirectory("components");
  syncDirectory("examples");

  const docsExamplesDir = join(docsRegistryDir, "examples");
  if (existsSync(docsExamplesDir)) {
    for (const entry of readdirSync(docsExamplesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      patchExampleHtml(join(docsExamplesDir, entry.name));
    }
  }

  console.log(`Synced docs player sources to ${relative(repoRoot, docsRegistryDir)}`);
}

main();
