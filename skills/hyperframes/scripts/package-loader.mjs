import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BOOTSTRAP_ENV = "HYPERFRAMES_SKILL_DEPS_BOOTSTRAPPED";
const NODE_MODULES_ENV = "HYPERFRAMES_SKILL_NODE_MODULES";

export async function importPackagesOrBootstrap(packageNames, options = {}) {
  const entries = new Map();
  const missing = [];

  for (const packageName of packageNames) {
    const entry = resolvePackageEntry(packageName);
    if (entry) entries.set(packageName, entry);
    else missing.push(packageName);
  }

  if (missing.length > 0 && !process.env[BOOTSTRAP_ENV]) {
    bootstrapWithNpmInstall(options.npmPackages ?? missing);
  }

  if (missing.length > 0) {
    throw new Error(
      [
        `Could not resolve required package(s): ${missing.join(", ")}`,
        "Install them in this project, for example:",
        `  npm install --save-dev ${packageNames.map(shellQuote).join(" ")}`,
      ].join("\n"),
    );
  }

  const modules = {};
  for (const [packageName, entry] of entries) {
    modules[packageName] = await import(pathToFileURL(entry).href);
  }
  return modules;
}

function resolvePackageEntry(packageName) {
  const bases = [process.cwd(), HERE, ...envNodeModulesDirs(), ...nodeModulesDirsFromPath()];

  const seen = new Set();
  for (const base of bases) {
    const normalized = resolve(base);
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    try {
      return createRequire(join(normalized, "__hyperframes_skill_loader__.cjs")).resolve(
        packageName,
      );
    } catch {
      const packageDir = findPackageDir(normalized, packageName);
      const packageEntry = packageDir ? readPackageEntry(packageDir) : null;
      if (packageEntry) return packageEntry;
    }
  }

  return null;
}

function envNodeModulesDirs() {
  return (process.env[NODE_MODULES_ENV] ?? "").split(delimiter).filter(Boolean);
}

function nodeModulesDirsFromPath() {
  const dirs = [];
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    if (!entry.endsWith(`${join("node_modules", ".bin")}`)) continue;
    dirs.push(dirname(entry));
  }
  return dirs;
}

function findPackageDir(base, packageName) {
  const packageSegments = packageName.split("/");
  const roots =
    basename(base) === "node_modules"
      ? [base]
      : ancestors(base).map((ancestor) => join(ancestor, "node_modules"));

  for (const root of roots) {
    const packageDir = join(root, ...packageSegments);
    if (existsSync(join(packageDir, "package.json"))) return packageDir;
  }
  return null;
}

function readPackageEntry(packageDir) {
  try {
    const manifest = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
    const entry = exportEntry(manifest.exports) ?? manifest.module ?? manifest.main ?? "index.js";
    const entryPath = join(packageDir, entry);
    return existsSync(entryPath) ? entryPath : null;
  } catch {
    return null;
  }
}

function exportEntry(exports) {
  const root =
    typeof exports === "object" && exports !== null ? (exports["."] ?? exports) : exports;
  if (typeof root === "string") return root;
  if (typeof root !== "object" || root === null) return null;
  if (typeof root.import === "string") return root.import;
  if (typeof root.default === "string") return root.default;
  if (typeof root.node === "string") return root.node;
  if (typeof root.node === "object" && root.node !== null) {
    return root.node.import ?? root.node.default ?? null;
  }
  return null;
}

function ancestors(start) {
  const dirs = [];
  let current = resolve(start);
  const root = parse(current).root;
  while (current && current !== root) {
    dirs.push(current);
    current = dirname(current);
  }
  dirs.push(root);
  return dirs;
}

function bootstrapWithNpmInstall(packageNames) {
  const installRoot = mkdtempSync(join(tmpdir(), "hyperframes-skill-deps-"));
  const installResult = spawnSync(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "install",
      "--silent",
      "--no-audit",
      "--no-fund",
      "--no-save",
      "--prefix",
      installRoot,
      ...packageNames,
    ],
    { stdio: "inherit" },
  );

  if (installResult.error) throw installResult.error;
  if (installResult.status !== 0) {
    rmSync(installRoot, { recursive: true, force: true });
    process.exit(installResult.status ?? 1);
  }

  const args = [...process.argv.slice(1)];
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      [BOOTSTRAP_ENV]: "1",
      [NODE_MODULES_ENV]: join(installRoot, "node_modules"),
    },
  });

  rmSync(installRoot, { recursive: true, force: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
