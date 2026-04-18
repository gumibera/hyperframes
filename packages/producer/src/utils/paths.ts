/**
 * Path resolution utilities for the render pipeline.
 */

import { resolve, basename, join, relative, isAbsolute } from "node:path";

export interface RenderPaths {
  absoluteProjectDir: string;
  absoluteOutputPath: string;
}

const DEFAULT_RENDERS_DIR =
  process.env.PRODUCER_RENDERS_DIR ??
  resolve(new URL(import.meta.url).pathname, "../../..", "renders");

/** Cross-platform `child ⊆ parent` check. Equality counts as inside. */
export function isPathInside(childPath: string, parentPath: string): boolean {
  const absChild = resolve(childPath);
  const absParent = resolve(parentPath);
  if (absChild === absParent) return true;
  const rel = relative(absParent, absChild);
  // rel === ""  → same path
  // rel starts with ".."  → above parent
  // rel is absolute  → different drive / volume on Windows
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Sanitise an absolute external-asset path into a relative key of the
 * form `hf-ext/…` that `path.join(compileDir, key)` cannot escape. Drops
 * drive-letter colons, UNC and extended-length prefixes, and normalises
 * separators so the output is portable across platforms.
 *
 * Caller contract: `absPath` must be canonical (typically via
 * `path.resolve`). `..` components are not stripped here —
 * `isPathInside` at copy time is the defensive backstop.
 */
export function toExternalAssetKey(absPath: string): string {
  return (
    "hf-ext/" +
    absPath
      .replace(/\\/g, "/")
      // Extended-length UNC (\\?\UNC\server\share\...) → match the UNC branch below
      .replace(/^\/\/\?\/UNC\//i, "//")
      // Extended-length path (\\?\D:\...) → strip prefix
      .replace(/^\/\/\?\//, "")
      // UNC (\\server\share\...) → unc/server/share/... (keeps the boundary)
      .replace(/^\/\/([^/]+)\//, "unc/$1/")
      // Leading slash (Unix absolute or what's left after strips)
      .replace(/^\/+/, "")
      // Drive letter ("D:/coder" → "D/coder")
      .replace(/^([A-Za-z]):\/?/, "$1/")
  );
}

export function resolveRenderPaths(
  projectDir: string,
  outputPath: string | null | undefined,
  rendersDir: string = DEFAULT_RENDERS_DIR,
): RenderPaths {
  const absoluteProjectDir = resolve(projectDir);
  const projectName = basename(absoluteProjectDir);
  const resolvedOutputPath = outputPath ?? join(rendersDir, `${projectName}.mp4`);
  const absoluteOutputPath = resolve(resolvedOutputPath);

  return { absoluteProjectDir, absoluteOutputPath };
}
