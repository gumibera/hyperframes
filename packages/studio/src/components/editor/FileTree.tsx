import { memo, useState, useCallback } from "react";
import {
  FileHtml,
  FileCss,
  FileJs,
  FileJsx,
  FileTs,
  FileTsx,
  FileTxt,
  FileCode,
  File,
  FilmStrip,
  MusicNote,
  Image as PhImage,
} from "@phosphor-icons/react";
import { ChevronDown, ChevronRight } from "../../icons/SystemIcons";

interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

const SZ = 14;

function FileIcon({ path }: { path: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const d = { size: SZ, weight: "duotone" as const, className: "flex-shrink-0" };
  if (ext === "html") return <FileHtml {...d} color="#E44D26" />;
  if (ext === "css") return <FileCss {...d} color="#264DE4" />;
  if (ext === "js" || ext === "mjs" || ext === "cjs") return <FileJs {...d} color="#F0DB4F" />;
  if (ext === "jsx") return <FileJsx {...d} color="#61DAFB" />;
  if (ext === "ts" || ext === "mts") return <FileTs {...d} color="#3178C6" />;
  if (ext === "tsx") return <FileTsx {...d} color="#3178C6" />;
  if (ext === "txt" || ext === "md" || ext === "mdx") return <FileTxt {...d} color="#9CA3AF" />;
  if (ext === "json" || ext === "svg") return <FileCode {...d} color="#22C55E" />;
  if (ext === "wav" || ext === "mp3" || ext === "ogg" || ext === "m4a")
    return <MusicNote size={SZ} color="#3CE6AC" className="flex-shrink-0" />;
  if (ext === "mp4" || ext === "webm" || ext === "mov")
    return <FilmStrip size={SZ} color="#A855F7" className="flex-shrink-0" />;
  if (ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp" || ext === "gif")
    return <PhImage size={SZ} color="#22C55E" className="flex-shrink-0" />;
  if (ext === "woff" || ext === "woff2" || ext === "ttf" || ext === "otf")
    return <File size={SZ} weight="duotone" color="#6B7280" className="flex-shrink-0" />;
  return <File size={SZ} weight="duotone" color="#6B7280" className="flex-shrink-0" />;
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
