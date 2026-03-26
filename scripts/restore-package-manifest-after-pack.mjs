#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BACKUP_DIR = join(tmpdir(), "hyperframes-publish-manifest-backups");

function getBackupPath(packageJsonPath) {
  const digest = createHash("sha256").update(packageJsonPath).digest("hex");
  return join(BACKUP_DIR, `${digest}.json`);
}

function main() {
  const packageJsonPath = join(process.cwd(), "package.json");
  const backupPath = getBackupPath(packageJsonPath);

  let backup;
  try {
    backup = readFileSync(backupPath, "utf8");
  } catch {
    console.log(`No publish-manifest backup found for ${packageJsonPath}; nothing to restore.`);
    return;
  }

  writeFileSync(packageJsonPath, backup);
  rmSync(backupPath, { force: true });
  console.log(`Restored ${packageJsonPath} after packing.`);
}

main();
