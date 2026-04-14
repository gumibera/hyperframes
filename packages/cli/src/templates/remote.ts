// Compat shim — fetchRemoteTemplate delegates to the new registry resolver +
// installer (packages/cli/src/registry/). Kept so init.ts and external imports
// that reference this path keep working through the PR 3 rollout. Delete when
// init.ts is fully ported.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { installItem, resolveItem } from "../registry/index.js";

// Re-exported for the existing remote.test.ts regression guard. These paths
// describe the repo layout under the default registry URL; updating them in
// sync with any future move prevents silent breakage of installed CLIs.
export const TEMPLATES_DIR = "registry/examples";
export const MANIFEST_FILENAME = "templates.json";

export interface RemoteTemplateInfo {
  id: string;
  label: string;
  hint: string;
  bundled: boolean;
}

/**
 * List available remote templates.
 *
 * Kept only for backwards compat with any third-party code that imported this
 * function. Internally, init.ts reaches for `resolveTemplateList` in
 * `generators.ts`, which goes through the new registry resolver.
 */
export async function listRemoteTemplates(): Promise<RemoteTemplateInfo[]> {
  const { listRegistryItems, loadAllItems } = await import("../registry/index.js");
  const entries = await listRegistryItems({ type: "hyperframes:example" });
  const items = await loadAllItems(entries);
  return items.map((item) => ({
    id: item.name,
    label: item.title,
    hint: item.description,
    bundled: false,
  }));
}

/**
 * Download a template into destDir. Delegates to the registry installer.
 */
export async function fetchRemoteTemplate(templateId: string, destDir: string): Promise<void> {
  const item = await resolveItem(templateId);
  await installItem(item, { destDir });

  // Safety check — an item with no index.html isn't a valid example.
  if (!existsSync(join(destDir, "index.html"))) {
    throw new Error(
      `Template "${templateId}" installed but missing index.html. The registry item may be malformed.`,
    );
  }
}
