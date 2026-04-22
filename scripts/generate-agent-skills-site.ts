import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SKILLS_DIR = join(REPO_ROOT, "skills");
const OUTPUT_ROOTS = [join(REPO_ROOT, "docs/public/.well-known/agent-skills")];
const CLEANUP_ROOTS = [join(REPO_ROOT, "docs/public/.well-known/skills")];

const CHECK_MODE = process.argv.includes("--check");

interface SkillManifestEntry {
  description: string;
  files: string[];
  name: string;
}

async function main() {
  const skillDirs = await collectSkillDirs(SKILLS_DIR);
  const entries: SkillManifestEntry[] = [];
  const skillFiles = new Map<string, string>();

  for (const skillDir of skillDirs) {
    const relativeDir = relative(SKILLS_DIR, skillDir).replaceAll("\\", "/");
    const files = await collectFiles(skillDir);
    const skillMd = await readFile(join(skillDir, "SKILL.md"), "utf8");
    const { description, name } = parseSkillFrontmatter(skillMd, relativeDir);
    const slug = normalizeSlug(name);

    entries.push({
      name: slug,
      description,
      files,
    });

    for (const file of files) {
      const sourcePath = join(skillDir, file);
      const outputPath = join(slug, file);
      skillFiles.set(outputPath, await readFile(sourcePath, "utf8"));
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  const indexJson = `${JSON.stringify({ skills: entries }, null, 2)}\n`;

  for (const outputRoot of OUTPUT_ROOTS) {
    const expected = new Map<string, string>(skillFiles);
    expected.set("index.json", indexJson);

    if (CHECK_MODE) {
      const mismatches = await diffOutputTree(outputRoot, expected);
      if (mismatches.length > 0) {
        for (const mismatch of mismatches) {
          console.error(mismatch);
        }
        process.exitCode = 1;
        return;
      }
      continue;
    }

    await rm(outputRoot, { recursive: true, force: true });
    for (const [relativePath, content] of expected) {
      const destination = join(outputRoot, relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content, "utf8");
    }
  }

  if (!CHECK_MODE) {
    for (const cleanupRoot of CLEANUP_ROOTS) {
      await rm(cleanupRoot, { recursive: true, force: true });
    }
  }

  if (CHECK_MODE) {
    console.log("Agent skills site export is up to date.");
  } else {
    console.log(`Generated ${entries.length} skills into docs/public/.well-known.`);
  }
}

async function collectFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nestedFiles = await collectFiles(fullPath);
      for (const nestedFile of nestedFiles) {
        files.push(join(entry.name, nestedFile).replaceAll("\\", "/"));
      }
      continue;
    }

    files.push(entry.name);
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function collectSkillDirs(root: string): Promise<string[]> {
  const skillDirs: string[] = [];

  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    const fullPath = join(root, entry.name);
    if (await fileExists(join(fullPath, "SKILL.md"))) {
      skillDirs.push(fullPath);
      continue;
    }

    skillDirs.push(...(await collectSkillDirs(fullPath)));
  }

  return skillDirs.sort((a, b) => a.localeCompare(b));
}

async function diffOutputTree(
  outputRoot: string,
  expected: Map<string, string>,
): Promise<string[]> {
  const mismatches: string[] = [];
  const actualFiles = await collectExistingFiles(outputRoot);

  for (const actualFile of actualFiles) {
    if (!expected.has(actualFile)) {
      mismatches.push(
        `Unexpected generated file: ${relative(outputRoot, join(outputRoot, actualFile))}`,
      );
    }
  }

  for (const [relativePath, expectedContent] of expected) {
    const destination = join(outputRoot, relativePath);
    if (!(await fileExists(destination))) {
      mismatches.push(`Missing generated file: ${relativePath}`);
      continue;
    }

    const actualContent = await readFile(destination, "utf8");
    if (actualContent !== expectedContent) {
      mismatches.push(`Out-of-date generated file: ${relativePath}`);
    }
  }

  return mismatches;
}

async function collectExistingFiles(root: string, currentDir = root): Promise<string[]> {
  if (!(await pathExists(currentDir))) return [];

  const files: string[] = [];

  for (const entry of await readdir(currentDir, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;

    const fullPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectExistingFiles(root, fullPath)));
      continue;
    }

    files.push(relative(root, fullPath).replaceAll("\\", "/"));
  }

  return files.sort((a, b) => a.localeCompare(b));
}

async function fileExists(path: string) {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function pathExists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function normalizeSlug(name: string) {
  const slug = name
    .toLowerCase()
    .replaceAll(/[\s_]+/g, "-")
    .replaceAll(/[^a-z0-9-]/g, "")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-|-$/g, "");

  if (!slug) {
    throw new Error(`Skill name "${name}" does not produce a valid slug.`);
  }

  return slug;
}

function parseSkillFrontmatter(raw: string, skillPath: string) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    throw new Error(`Missing frontmatter in ${skillPath}/SKILL.md`);
  }

  const fields = parseYamlSubset(match[1], skillPath);
  const name = fields.name?.trim();
  const description = fields.description?.trim();

  if (!name || !description) {
    throw new Error(`Expected name and description in ${skillPath}/SKILL.md`);
  }

  return { name, description };
}

function parseYamlSubset(frontmatter: string, skillPath: string) {
  const result: Record<string, string> = {};
  const lines = frontmatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;

    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) {
      throw new Error(`Unsupported frontmatter line in ${skillPath}/SKILL.md: ${line}`);
    }

    const [, key, rawValue = ""] = match;
    if (rawValue === "|" || rawValue === ">") {
      const blockLines: string[] = [];
      index += 1;

      while (index < lines.length) {
        const blockLine = lines[index];
        if (blockLine.startsWith("  ") || blockLine.startsWith("\t")) {
          blockLines.push(blockLine.replace(/^(  |\t)/, ""));
          index += 1;
          continue;
        }
        if (!blockLine.trim()) {
          blockLines.push("");
          index += 1;
          continue;
        }
        index -= 1;
        break;
      }

      result[key] =
        rawValue === ">"
          ? blockLines.join(" ").replaceAll(/\s+/g, " ").trim()
          : blockLines.join("\n");
      continue;
    }

    result[key] = stripWrappingQuotes(rawValue.trim());
  }

  return result;
}

function stripWrappingQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

await main();
