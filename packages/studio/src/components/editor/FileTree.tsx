import { memo, useState, useCallback } from "react";
import { Film, Music, Image, ChevronDown, ChevronRight } from "../../icons/SystemIcons";

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

/** VS Code–style language badge: colored rounded rect with a 2–3 letter label. */
function Badge({ label, bg, text = "#fff" }: { label: string; bg: string; text?: string }) {
  return (
    <span
      className="flex-shrink-0 inline-flex items-center justify-center rounded"
      style={{
        width: 16,
        height: 16,
        background: bg,
        color: text,
        fontSize: 7,
        fontWeight: 700,
        fontFamily: "monospace",
        letterSpacing: "-0.02em",
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  );
}

/** Render a file-type icon for a given file path. */
function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  // Language badges
  if (ext === "html") return <Badge label="HTML" bg="#E44D26" />;
  if (ext === "js" || ext === "mjs" || ext === "cjs")
    return <Badge label="JS" bg="#F0DB4F" text="#323330" />;
  if (ext === "ts" || ext === "mts") return <Badge label="TS" bg="#3178C6" />;
  if (ext === "css") return <Badge label="CSS" bg="#264DE4" />;
  if (ext === "json") return <Badge label="{}" bg="#1E7F34" />;
  if (ext === "md" || ext === "mdx") return <Badge label="MD" bg="#555" />;
  if (ext === "svg") return <Badge label="SVG" bg="#FF9900" />;
  if (ext === "wav" || ext === "mp3" || ext === "ogg" || ext === "m4a")
    return <Music size={13} style={{ color: "#3CE6AC" }} className="flex-shrink-0" />;
  if (ext === "mp4" || ext === "webm" || ext === "mov")
    return <Film size={13} style={{ color: "#A855F7" }} className="flex-shrink-0" />;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif")
    return <Image size={13} style={{ color: "#22C55E" }} className="flex-shrink-0" />;
  if (ext === "woff" || ext === "woff2" || ext === "ttf" || ext === "otf")
    return <Badge label="Aa" bg="#525252" />;
  if (ext === "txt") return <Badge label="TXT" bg="#4B5563" />;
  // Generic document
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#6B7280"
      strokeWidth="1.5"
      strokeLinecap="round"
      className="flex-shrink-0"
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

interface TreeNode {
  name: string;
  fullPath: string;
  children: Map<string, TreeNode>;
  isFile: boolean;
}

function buildTree(files: string[]): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: new Map(), isFile: false };
  for (const file of files) {
    const parts = file.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const fullPath = parts.slice(0, i + 1).join("/");
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullPath,
          children: new Map(),
          isFile: isLast,
        });
      }
      current = current.children.get(part)!;
      if (isLast) current.isFile = true;
    }
  }
  return root;
}

function sortChildren(children: Map<string, TreeNode>): TreeNode[] {
  return Array.from(children.values()).sort((a, b) => {
    // index.html always first
    if (a.name === "index.html") return -1;
    if (b.name === "index.html") return 1;
    // Directories before files
    if (!a.isFile && b.isFile) return -1;
    if (a.isFile && !b.isFile) return 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeFolder({
  node,
  depth,
  activeFile,
  onSelectFile,
  defaultOpen,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  defaultOpen: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const toggle = useCallback(() => setIsOpen((v) => !v), []);
  const children = sortChildren(node.children);
  const Chevron = isOpen ? ChevronDown : ChevronRight;

  return (
    <>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1.5 px-2.5 py-1 min-h-7 text-left text-xs text-neutral-400 hover:bg-neutral-800/30 hover:text-neutral-300 transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <Chevron size={10} className="flex-shrink-0 text-neutral-600" />
        <span className="truncate font-medium">{node.name}</span>
      </button>
      {isOpen &&
        children.map((child) =>
          child.isFile && child.children.size === 0 ? (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ) : child.children.size > 0 ? (
            <TreeFolder
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              defaultOpen={isActiveInSubtree(child, activeFile)}
            />
          ) : (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ),
        )}
    </>
  );
}

function TreeFile({
  node,
  depth,
  activeFile,
  onSelectFile,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}) {
  const isActive = node.fullPath === activeFile;

  return (
    <button
      onClick={() => onSelectFile(node.fullPath)}
      className={`w-full flex items-center gap-2 py-1 min-h-7 text-left transition-all text-xs ${
        isActive
          ? "bg-neutral-800/60 text-neutral-200"
          : "text-neutral-500 hover:bg-neutral-800/30 hover:text-neutral-300"
      }`}
      style={{ paddingLeft: `${8 + depth * 12 + 14}px` }}
    >
      <FileIcon path={node.name} />
      <span className="truncate">{node.name}</span>
    </button>
  );
}

function isActiveInSubtree(node: TreeNode, activeFile: string | null): boolean {
  if (!activeFile) return false;
  if (node.fullPath === activeFile) return true;
  for (const child of node.children.values()) {
    if (isActiveInSubtree(child, activeFile)) return true;
  }
  return false;
}

export const FileTree = memo(function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  const tree = buildTree(files);
  const children = sortChildren(tree.children);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-2.5 py-1.5 border-b border-neutral-800 flex-shrink-0">
        <span className="text-2xs font-medium text-neutral-500 uppercase tracking-caps">Files</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {children.map((child) =>
          child.isFile && child.children.size === 0 ? (
            <TreeFile
              key={child.fullPath}
              node={child}
              depth={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
            />
          ) : (
            <TreeFolder
              key={child.fullPath}
              node={child}
              depth={0}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              defaultOpen={isActiveInSubtree(child, activeFile)}
            />
          ),
        )}
      </div>
    </div>
  );
});
