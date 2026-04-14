#!/usr/bin/env tsx
/**
 * Generate Catalog MDX Pages + Index
 *
 * Walks registry/blocks/ and registry/components/, reads each item's
 * registry-item.json, and emits:
 *
 *   docs/catalog/blocks/<name>.mdx       — per-block detail page
 *   docs/catalog/components/<name>.mdx   — per-component detail page
 *   docs/public/catalog-index.json       — flat manifest for the grid page
 *
 * Run before building docs (e.g., in a Mintlify pre-build script):
 *   npx tsx scripts/generate-catalog-pages.ts
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Import from source — bun workspace linking doesn't resolve for scripts outside packages/.
import {
  type RegistryItem,
  isBlockItem,
  ITEM_TYPE_DIRS,
} from "../packages/core/src/registry/types.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const registryDir = resolve(repoRoot, "registry");
const docsDir = resolve(repoRoot, "docs");

// ── Types ──────────────────────────────────────────────────────────────────

type ItemKind = "block" | "component";

interface CatalogEntry {
  name: string;
  type: ItemKind;
  title: string;
  description: string;
  tags: string[];
  /** Relative href within the docs site. */
  href: string;
  /** Preview poster image path (relative to docs root). */
  preview?: string;
}

// ── Discovery ──────────────────────────────────────────────────────────────

function discoverItems(): { kind: ItemKind; manifest: RegistryItem }[] {
  const items: { kind: ItemKind; manifest: RegistryItem }[] = [];

  const dirs: { kind: ItemKind; dir: string }[] = [
    { kind: "block", dir: join(registryDir, "blocks") },
    { kind: "component", dir: join(registryDir, "components") },
  ];

  for (const { kind, dir } of dirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(dir, entry.name, "registry-item.json");
      if (!existsSync(manifestPath)) continue;

      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as RegistryItem;
      items.push({ kind, manifest });
    }
  }

  return items.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}

// ── MDX generation ─────────────────────────────────────────────────────────

function typeLabel(kind: ItemKind): string {
  return kind === "block" ? "Block" : "Component";
}

function typeDir(kind: ItemKind): string {
  return ITEM_TYPE_DIRS[kind === "block" ? "hyperframes:block" : "hyperframes:component"];
}

function generateItemMdx(kind: ItemKind, manifest: RegistryItem): string {
  const tags = manifest.tags ?? [];
  const tagBadges = tags.map((t) => `\`${t}\``).join(" ");
  const installCmd = `npx hyperframes add ${manifest.name}`;

  const lines: string[] = [
    "---",
    `title: "${manifest.title.replace(/"/g, '\\"')}"`,
    `description: "${manifest.description.replace(/"/g, '\\"')}"`,
    "---",
    "",
    `# ${manifest.title}`,
    "",
    manifest.description,
    "",
  ];

  if (tagBadges) {
    lines.push(tagBadges, "");
  }

  // Preview video with poster fallback — matches the examples page pattern.
  const previewPath = `/images/catalog/${typeDir(kind)}/${manifest.name}`;
  lines.push(
    `<video className="w-full aspect-video rounded-xl object-cover bg-zinc-100 dark:bg-zinc-800" src="${previewPath}.mp4" poster="${previewPath}.png" muted loop playsInline autoPlay />`,
    "",
  );

  // Install command
  lines.push(
    "## Install",
    "",
    "<CodeGroup>",
    "",
    "```bash Terminal",
    installCmd,
    "```",
    "",
    "</CodeGroup>",
    "",
  );

  // Details
  if (kind === "block" && manifest.dimensions && manifest.duration) {
    lines.push(
      "## Details",
      "",
      `| Property | Value |`,
      `| --- | --- |`,
      `| Type | ${typeLabel(kind)} |`,
      `| Dimensions | ${manifest.dimensions.width}×${manifest.dimensions.height} |`,
      `| Duration | ${manifest.duration}s |`,
      "",
    );
  } else {
    lines.push(
      "## Details",
      "",
      `| Property | Value |`,
      `| --- | --- |`,
      `| Type | ${typeLabel(kind)} |`,
      "",
    );
  }

  // Files
  lines.push("## Files", "", "| File | Target | Type |", "| --- | --- | --- |");
  for (const f of manifest.files) {
    lines.push(`| \`${f.path}\` | \`${f.target}\` | ${f.type} |`);
  }
  lines.push("");

  // Usage hint — find the primary file by type, not array position.
  const primaryFile =
    manifest.files.find((f) => f.type === "hyperframes:composition") ??
    manifest.files.find((f) => f.type === "hyperframes:snippet") ??
    manifest.files[0];
  const primaryTarget = primaryFile?.target ?? `compositions/${manifest.name}.html`;

  if (kind === "block" && isBlockItem(manifest)) {
    const w = manifest.dimensions.width;
    const h = manifest.dimensions.height;
    lines.push(
      "## Usage",
      "",
      "After installing, add the block to your host composition:",
      "",
      "```html",
      `<div data-composition-id="${manifest.name}" data-composition-src="${primaryTarget}" data-start="0" data-duration="${manifest.duration}" data-track-index="1" data-width="${w}" data-height="${h}"></div>`,
      "```",
      "",
    );
  } else {
    lines.push(
      "## Usage",
      "",
      `Open \`${primaryTarget}\` and paste its contents into your composition. See the comment header in the file for detailed instructions.`,
      "",
    );
  }

  // Related skill
  if (manifest.relatedSkill) {
    lines.push(`<Tip>Related skill: \`/${manifest.relatedSkill}\`</Tip>`, "");
  }

  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

function main(): void {
  const items = discoverItems();
  const catalogIndex: CatalogEntry[] = [];

  // Clean previous generated output so deleted items don't leave stale pages.
  // Only remove the generated subdirectories, not the entire catalog/ dir
  // (which may contain hand-written pages like an overview).
  for (const sub of ["blocks", "components"]) {
    const dir = join(docsDir, "catalog", sub);
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }

  console.log(`Generating catalog pages for ${items.length} item(s)...\n`);

  for (const { kind, manifest } of items) {
    const dir = typeDir(kind);
    const outDir = join(docsDir, "catalog", dir);
    mkdirSync(outDir, { recursive: true });

    const mdx = generateItemMdx(kind, manifest);
    const outPath = join(outDir, `${manifest.name}.mdx`);
    writeFileSync(outPath, mdx, "utf-8");
    console.log(`  ✓ catalog/${dir}/${manifest.name}.mdx`);

    catalogIndex.push({
      name: manifest.name,
      type: kind,
      title: manifest.title,
      description: manifest.description,
      tags: manifest.tags ?? [],
      href: `/catalog/${dir}/${manifest.name}`,
      preview: `/images/catalog/${dir}/${manifest.name}.png`,
    });
  }

  // Write catalog-index.json
  const publicDir = join(docsDir, "public");
  mkdirSync(publicDir, { recursive: true });
  const indexPath = join(publicDir, "catalog-index.json");
  writeFileSync(indexPath, JSON.stringify(catalogIndex, null, 2) + "\n", "utf-8");
  console.log(`\n  ✓ public/catalog-index.json (${catalogIndex.length} items)`);

  // Update docs.json navigation with generated catalog pages.
  const docsJsonPath = join(docsDir, "docs.json");
  const docsJson = JSON.parse(readFileSync(docsJsonPath, "utf-8"));
  const tabs = docsJson.navigation?.tabs as Array<{ tab: string; groups: unknown[] }>;

  // Build catalog groups from discovered items
  const blockPages = catalogIndex
    .filter((i) => i.type === "block")
    .map((i) => `catalog/blocks/${i.name}`);
  const componentPages = catalogIndex
    .filter((i) => i.type === "component")
    .map((i) => `catalog/components/${i.name}`);

  const catalogGroups: { group: string; pages: string[] }[] = [];
  if (blockPages.length > 0) catalogGroups.push({ group: "Blocks", pages: blockPages });
  if (componentPages.length > 0) catalogGroups.push({ group: "Components", pages: componentPages });

  if (catalogGroups.length > 0) {
    // Replace or insert the Catalog tab
    const existingIdx = tabs.findIndex((t) => t.tab === "Catalog");
    const catalogTab = { tab: "Catalog", groups: catalogGroups };
    if (existingIdx >= 0) {
      tabs[existingIdx] = catalogTab;
    } else {
      // Insert before the last tab (Reference)
      const refIdx = tabs.findIndex((t) => t.tab === "Reference");
      if (refIdx >= 0) {
        tabs.splice(refIdx, 0, catalogTab);
      } else {
        tabs.push(catalogTab);
      }
    }
    writeFileSync(docsJsonPath, JSON.stringify(docsJson, null, 2) + "\n", "utf-8");
    console.log(
      `  ✓ docs.json updated with ${blockPages.length} blocks + ${componentPages.length} components`,
    );
  }

  console.log("\nDone.");
}

main();
