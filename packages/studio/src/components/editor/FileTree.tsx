import {
  FILE_TREE_TAG_NAME,
  type ContextMenuItem,
  type ContextMenuOpenContext,
  type FileTreeDirectoryHandle,
  type FileTreeItemHandle,
  type FileTree as PierreTreeModel,
  type FileTreeMutationEvent,
  type FileTreeSortComparator,
} from "@pierre/trees";
import { FileTree as PierreFileTree, useFileTree } from "@pierre/trees/react";
import { Copy, FilePlus, FolderSimplePlus, PencilSimple, Plus, Trash } from "@phosphor-icons/react";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

type FileTreeActionResult = void | Promise<void>;

export interface FileTreeProps {
  files: string[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  onCreateFile?: (path: string) => FileTreeActionResult;
  onCreateFolder?: (path: string) => FileTreeActionResult;
  onDeleteFile?: (path: string) => FileTreeActionResult;
  onRenameFile?: (oldPath: string, newPath: string) => FileTreeActionResult;
  onDuplicateFile?: (path: string) => FileTreeActionResult;
  onMoveFile?: (oldPath: string, newPath: string) => FileTreeActionResult;
  onImportFiles?: (files: FileList, dir?: string) => FileTreeActionResult;
}

interface DeleteConfirmProps {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface RootContextMenuState {
  x: number;
  y: number;
}

interface TreeActionMenuProps {
  item?: ContextMenuItem;
  onNewFile?: () => void;
  onNewFolder?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
}

interface RootContextMenuProps extends RootContextMenuState {
  onClose: () => void;
  onNewFile?: () => void;
  onNewFolder?: () => void;
}

interface PendingCreateState {
  kind: "file" | "folder";
  placeholderPath: string;
}

interface DropPathData {
  itemParentPath?: string;
  itemPath?: string;
  itemType?: string;
}

const TREE_HOST_STYLE = {
  "--trees-accent-override": "#3CE6AC",
  "--trees-bg-override": "#0a0a0a",
  "--trees-bg-muted-override": "rgba(38, 38, 38, 0.7)",
  "--trees-border-color-override": "rgba(38, 38, 38, 0.8)",
  "--trees-fg-override": "#a3a3a3",
  "--trees-fg-muted-override": "#737373",
  "--trees-font-family-override": "inherit",
  "--trees-font-size-override": "12px",
  "--trees-item-margin-x-override": "0px",
  "--trees-item-padding-x-override": "8px",
  "--trees-item-row-gap-override": "6px",
  "--trees-level-gap-override": "8px",
  "--trees-padding-inline-override": "8px",
  "--trees-search-bg-override": "#171717",
  "--trees-search-fg-override": "#d4d4d8",
  "--trees-selected-bg-override": "rgba(60, 230, 172, 0.12)",
  "--trees-selected-fg-override": "#e5e7eb",
  "--trees-selected-focused-border-color-override": "rgba(60, 230, 172, 0.45)",
  height: "100%",
} as CSSProperties;

const TREE_UNSAFE_CSS = `
  [data-studio-external-drag-target='true'] {
    background-color: var(--trees-selected-bg);
  }
`;

const compareStudioTreeEntries: FileTreeSortComparator = (left, right) => {
  if (left.basename === "index.html" && right.basename !== "index.html") return -1;
  if (right.basename === "index.html" && left.basename !== "index.html") return 1;
  if (left.isDirectory !== right.isDirectory) return left.isDirectory ? -1 : 1;
  return left.path.localeCompare(right.path, undefined, { numeric: true });
};

function isCanonicalDirectoryPath(path: string): boolean {
  return path.endsWith("/");
}

function toCanonicalDirectoryPath(path: string): string {
  return isCanonicalDirectoryPath(path) ? path : `${path}/`;
}

function toPublicPath(path: string): string {
  return isCanonicalDirectoryPath(path) ? path.slice(0, -1) : path;
}

function getPathBasename(path: string): string {
  const normalized = toPublicPath(path);
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(index + 1) : normalized;
}

function getCanonicalParentDirectoryPath(path: string): string | null {
  const normalized = toPublicPath(path);
  const index = normalized.lastIndexOf("/");
  if (index < 0) return null;
  return `${normalized.slice(0, index + 1)}`;
}

function getAncestorDirectoryPaths(path: string): string[] {
  const normalized = toPublicPath(path);
  if (!normalized) return [];
  const segments = normalized.split("/");
  return segments.slice(0, -1).map((_, index) => `${segments.slice(0, index + 1).join("/")}/`);
}

function buildStudioTreePaths(files: string[]): string[] {
  const deduped = new Set<string>();
  for (const file of files) {
    if (file.endsWith("/.gitkeep")) {
      const folderPath = file.slice(0, -"/.gitkeep".length);
      if (folderPath) deduped.add(toCanonicalDirectoryPath(folderPath));
      continue;
    }
    deduped.add(file);
  }
  return Array.from(deduped);
}

function createPlaceholderPath(
  existingPaths: readonly string[],
  parentPath: string,
  kind: PendingCreateState["kind"],
): string {
  const existing = new Set(existingPaths);
  const prefix = parentPath ? `${parentPath}/` : "";
  const stem = kind === "folder" ? "new-folder" : "untitled";
  let counter = 1;

  while (true) {
    const suffix = counter === 1 ? stem : `${stem}-${counter}`;
    const nextPath = `${prefix}${suffix}`;
    const candidate = kind === "folder" ? toCanonicalDirectoryPath(nextPath) : nextPath;
    if (!existing.has(candidate)) return candidate;
    counter += 1;
  }
}

function buildMoveDestinationPath(sourcePath: string, targetDirectoryPath: string | null): string {
  const baseName = getPathBasename(sourcePath);
  const parentPath = targetDirectoryPath ? toPublicPath(targetDirectoryPath) : "";
  return parentPath ? `${parentPath}/${baseName}` : baseName;
}

function getHostElement(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(FILE_TREE_TAG_NAME) ?? null;
}

function collectExpandedPaths(host: HTMLElement | null): string[] {
  if (!host?.shadowRoot) return [];
  return Array.from(
    host.shadowRoot.querySelectorAll<HTMLElement>(
      '[data-type="item"][data-item-type="folder"][aria-expanded="true"]',
    ),
  )
    .map((element) => element.dataset.itemPath ?? "")
    .filter((path) => path.length > 0);
}

function getDropPathData(elements: readonly DropPathData[]): string {
  for (const element of elements) {
    if (!element.itemPath) continue;
    if (element.itemType === "folder") return element.itemPath;
    if (element.itemParentPath) return element.itemParentPath;
    return "";
  }
  return "";
}

function resolveImportTargetPath(event: DragEvent): string {
  const pathData: DropPathData[] = [];
  for (const entry of event.composedPath()) {
    if (!(entry instanceof HTMLElement)) continue;
    pathData.push({
      itemParentPath: entry.dataset.itemParentPath,
      itemPath: entry.dataset.itemPath,
      itemType: entry.dataset.itemType,
    });
  }
  return getDropPathData(pathData);
}

function hasExternalFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false;
  return Array.from(dataTransfer.items).some((item) => item.kind === "file");
}

function escapeAttributeValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/["\\]/g, "\\$&");
}

function isDirectoryHandle(item: FileTreeItemHandle | null): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true;
}

function renderMountedTree(model: PierreTreeModel, host: HTMLElement | null) {
  if (!host) return;
  model.render({ fileTreeContainer: host });
}

function syncSelection(model: PierreTreeModel, activeFile: string | null) {
  const selectedPaths = model.getSelectedPaths();
  if (!activeFile) {
    for (const path of selectedPaths) {
      model.getItem(path)?.deselect();
    }
    return;
  }

  const target = model.getItem(activeFile);
  if (!target) return;

  for (const ancestorPath of getAncestorDirectoryPaths(activeFile)) {
    const ancestor = model.getItem(ancestorPath);
    if (isDirectoryHandle(ancestor)) ancestor.expand();
  }

  const focusedPath = model.getFocusedPath();
  if (selectedPaths.length === 1 && selectedPaths[0] === activeFile && focusedPath === activeFile) {
    return;
  }

  for (const path of selectedPaths) {
    if (path !== activeFile) model.getItem(path)?.deselect();
  }

  target.select();
  model.focusPath(activeFile);
}

function isPendingCreateCleared(event: FileTreeMutationEvent, pendingPath: string): boolean {
  if (event.operation === "remove") return event.path === pendingPath;
  if (event.operation === "batch")
    return event.events.some((entry) => isPendingCreateCleared(entry, pendingPath));
  if (event.operation === "reset") return true;
  return false;
}

function TreeActionMenu({
  item,
  onNewFile,
  onNewFolder,
  onRename,
  onDuplicate,
  onDelete,
}: TreeActionMenuProps) {
  const isFolder = item?.kind === "directory";
  const canCreateFolder = item == null || isFolder;

  return (
    <div className="min-w-[168px] rounded-md border border-neutral-700 bg-neutral-900 py-1 shadow-lg">
      {(onNewFile || onNewFolder) && (
        <>
          {onNewFile && (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
              onClick={onNewFile}
            >
              <FilePlus size={12} weight="duotone" className="text-neutral-500" />
              New File
            </button>
          )}
          {canCreateFolder && onNewFolder && (
            <button
              type="button"
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
              onClick={onNewFolder}
            >
              <FolderSimplePlus size={12} weight="duotone" className="text-neutral-500" />
              New Folder
            </button>
          )}
          {(onRename || onDuplicate || onDelete) && (
            <div className="my-1 border-t border-neutral-700" />
          )}
        </>
      )}

      {onRename && (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
          onClick={onRename}
        >
          <PencilSimple size={12} weight="duotone" className="text-neutral-500" />
          Rename
        </button>
      )}

      {!isFolder && onDuplicate && (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-300 hover:bg-neutral-800"
          onClick={onDuplicate}
        >
          <Copy size={12} weight="duotone" className="text-neutral-500" />
          Duplicate
        </button>
      )}

      {onDelete && (
        <>
          {(onRename || onDuplicate) && <div className="my-1 border-t border-neutral-700" />}
          <button
            type="button"
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left text-xs text-red-400 hover:bg-red-900/30"
            onClick={onDelete}
          >
            <Trash size={12} weight="duotone" />
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function RootContextMenu({ x, y, onClose, onNewFile, onNewFolder }: RootContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="fixed z-50"
      style={{
        left: Math.min(x, window.innerWidth - 180),
        top: Math.min(y, window.innerHeight - 120),
      }}
    >
      <TreeActionMenu onNewFile={onNewFile} onNewFolder={onNewFolder} />
    </div>
  );
}

function DeleteConfirm({ name, onConfirm, onCancel }: DeleteConfirmProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onCancel();
    };

    document.addEventListener("keydown", handleEscape);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [onCancel]);

  return (
    <div
      ref={ref}
      className="mx-1 my-0.5 rounded-md border border-neutral-700 bg-neutral-800 p-2 text-xs"
    >
      <p className="mb-2 text-neutral-300">
        Delete <span className="font-medium text-neutral-100">{name}</span>?
      </p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded bg-neutral-700 px-2 py-1 text-neutral-300 transition-colors hover:bg-neutral-600"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="flex-1 rounded bg-red-900/60 px-2 py-1 text-red-300 transition-colors hover:bg-red-800/60"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export const FileTree = memo(function FileTree({
  files,
  activeFile,
  onSelectFile,
  onCreateFile,
  onCreateFolder,
  onDeleteFile,
  onRenameFile,
  onDuplicateFile,
  onMoveFile,
  onImportFiles,
}: FileTreeProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const callbacksRef = useRef({
    onCreateFile,
    onCreateFolder,
    onDeleteFile,
    onDuplicateFile,
    onImportFiles,
    onMoveFile,
    onRenameFile,
    onSelectFile,
  });
  callbacksRef.current = {
    onCreateFile,
    onCreateFolder,
    onDeleteFile,
    onDuplicateFile,
    onImportFiles,
    onMoveFile,
    onRenameFile,
    onSelectFile,
  };

  const displayPaths = useMemo(() => buildStudioTreePaths(files), [files]);
  const displayPathsRef = useRef(displayPaths);
  displayPathsRef.current = displayPaths;

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [externalDropTarget, setExternalDropTarget] = useState<string | null>(null);
  const [rootContextMenu, setRootContextMenu] = useState<RootContextMenuState | null>(null);
  const pendingCreateRef = useRef<PendingCreateState | null>(null);

  const modelRef = useRef<PierreTreeModel | null>(null);
  const hasFileOps = Boolean(
    onCreateFile || onCreateFolder || onDeleteFile || onRenameFile || onDuplicateFile,
  );
  const hasRootCreateActions = Boolean(onCreateFile || onCreateFolder);

  const { model } = useFileTree({
    composition: hasFileOps
      ? {
          contextMenu: {
            buttonVisibility: "when-needed",
            triggerMode: "both",
          },
        }
      : undefined,
    dragAndDrop: onMoveFile
      ? {
          canDrag: (paths) => paths.length === 1,
          onDropComplete: (event) => {
            const sourcePath = event.draggedPaths[0];
            if (!sourcePath) return;
            const nextPath = buildMoveDestinationPath(sourcePath, event.target.directoryPath);
            void Promise.resolve(
              callbacksRef.current.onMoveFile?.(toPublicPath(sourcePath), nextPath),
            ).catch(console.error);
          },
        }
      : false,
    icons: { colored: true, set: "complete" },
    initialExpandedPaths: activeFile ? getAncestorDirectoryPaths(activeFile) : undefined,
    initialExpansion: "closed",
    initialSelectedPaths: activeFile ? [activeFile] : undefined,
    itemHeight: 28,
    onSelectionChange: (selectedPaths) => {
      const focusedPath = modelRef.current?.getFocusedPath() ?? null;
      if (!focusedPath || isCanonicalDirectoryPath(focusedPath)) return;
      if (!selectedPaths.includes(focusedPath)) return;
      callbacksRef.current.onSelectFile(focusedPath);
    },
    paths: displayPaths,
    renaming: {
      onError: (error) => {
        console.error(`[Studio] File tree rename failed: ${error}`);
      },
      onRename: (event) => {
        const pending = pendingCreateRef.current;
        const isPendingRename =
          pending && toPublicPath(pending.placeholderPath) === event.sourcePath;

        if (isPendingRename) {
          pendingCreateRef.current = null;
          void Promise.resolve(
            pending.kind === "folder"
              ? callbacksRef.current.onCreateFolder?.(event.destinationPath)
              : callbacksRef.current.onCreateFile?.(event.destinationPath),
          ).catch(console.error);
          return;
        }

        void Promise.resolve(
          callbacksRef.current.onRenameFile?.(event.sourcePath, event.destinationPath),
        ).catch(console.error);
      },
    },
    sort: compareStudioTreeEntries,
    unsafeCSS: TREE_UNSAFE_CSS,
  });
  modelRef.current = model;

  const closeRootContextMenu = useCallback(() => {
    setRootContextMenu(null);
  }, []);

  const startCreate = useCallback(
    (kind: PendingCreateState["kind"], parentPath: string) => {
      if (pendingCreateRef.current) return;

      const placeholderPath = createPlaceholderPath(displayPathsRef.current, parentPath, kind);
      pendingCreateRef.current = { kind, placeholderPath };

      const parentDirectory = parentPath ? toCanonicalDirectoryPath(parentPath) : null;
      if (parentDirectory) {
        const parentItem = model.getItem(parentDirectory);
        if (isDirectoryHandle(parentItem)) parentItem.expand();
      }

      try {
        model.add(placeholderPath);
        renderMountedTree(model, hostRef.current);
        requestAnimationFrame(() => {
          if (model.startRenaming(placeholderPath, { removeIfCanceled: true }) !== false) {
            renderMountedTree(model, hostRef.current);
            return;
          }

          model.remove(
            placeholderPath,
            isCanonicalDirectoryPath(placeholderPath) ? { recursive: true } : undefined,
          );
          pendingCreateRef.current = null;
        });
      } catch (error) {
        pendingCreateRef.current = null;
        console.error(error);
      }
    },
    [model],
  );

  const handleRename = useCallback(
    (path: string) => {
      model.startRenaming(path);
      renderMountedTree(model, hostRef.current);
    },
    [model],
  );

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    void Promise.resolve(callbacksRef.current.onDeleteFile?.(deleteTarget)).catch(console.error);
    setDeleteTarget(null);
  }, [deleteTarget]);

  const renderContextMenu = useCallback(
    (item: ContextMenuItem, context: ContextMenuOpenContext) => {
      const publicPath = toPublicPath(item.path);
      const parentPath = toPublicPath(getCanonicalParentDirectoryPath(item.path) ?? "");
      const createPath = item.kind === "directory" ? publicPath : parentPath;

      return (
        <TreeActionMenu
          item={item}
          onNewFile={
            onCreateFile
              ? () => {
                  context.close({ restoreFocus: false });
                  startCreate("file", createPath);
                }
              : undefined
          }
          onNewFolder={
            item.kind === "directory" && onCreateFolder
              ? () => {
                  context.close({ restoreFocus: false });
                  startCreate("folder", createPath);
                }
              : undefined
          }
          onRename={
            onRenameFile
              ? () => {
                  context.close({ restoreFocus: false });
                  handleRename(item.path);
                }
              : undefined
          }
          onDuplicate={
            item.kind === "file" && onDuplicateFile
              ? () => {
                  context.close();
                  void Promise.resolve(callbacksRef.current.onDuplicateFile?.(publicPath)).catch(
                    console.error,
                  );
                }
              : undefined
          }
          onDelete={
            onDeleteFile
              ? () => {
                  context.close();
                  setDeleteTarget(publicPath);
                }
              : undefined
          }
        />
      );
    },
    [
      handleRename,
      onCreateFile,
      onCreateFolder,
      onDeleteFile,
      onDuplicateFile,
      onRenameFile,
      startCreate,
    ],
  );

  useEffect(() => {
    const unsubscribe = model.onMutation("*", (event) => {
      const pending = pendingCreateRef.current;
      if (!pending) return;
      if (isPendingCreateCleared(event, pending.placeholderPath)) {
        pendingCreateRef.current = null;
      }
    });

    return unsubscribe;
  }, [model]);

  useEffect(() => {
    hostRef.current = getHostElement(wrapperRef.current);
  });

  useEffect(() => {
    const host = getHostElement(wrapperRef.current);
    hostRef.current = host;
    const expandedPaths = collectExpandedPaths(host);
    model.resetPaths(displayPaths, {
      initialExpandedPaths: expandedPaths.length > 0 ? expandedPaths : undefined,
    });
  }, [displayPaths, model]);

  useEffect(() => {
    syncSelection(model, activeFile);
  }, [activeFile, model]);

  useEffect(() => {
    const host = getHostElement(wrapperRef.current);
    hostRef.current = host;
    if (!host) return;

    const handleContextMenu = (event: MouseEvent) => {
      if (!hasRootCreateActions) return;
      const path = event
        .composedPath()
        .find(
          (entry) => entry instanceof HTMLElement && typeof entry.dataset.itemPath === "string",
        );
      if (path) return;

      const headerTarget = event
        .composedPath()
        .find(
          (entry) =>
            entry instanceof HTMLElement &&
            (entry.slot === "header" || entry.closest?.('[slot="header"]') != null),
        );
      if (headerTarget) return;

      event.preventDefault();
      setRootContextMenu({ x: event.clientX, y: event.clientY });
    };

    const handleDragOver = (event: DragEvent) => {
      if (!callbacksRef.current.onImportFiles || !hasExternalFiles(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setExternalDropTarget(resolveImportTargetPath(event));
    };

    const handleDragLeave = (event: DragEvent) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        (host.contains(nextTarget) || host.shadowRoot?.contains(nextTarget))
      ) {
        return;
      }
      setExternalDropTarget(null);
    };

    const handleDrop = (event: DragEvent) => {
      if (!callbacksRef.current.onImportFiles || !hasExternalFiles(event.dataTransfer)) return;
      event.preventDefault();
      const targetPath = resolveImportTargetPath(event);
      const targetDir = targetPath ? toPublicPath(targetPath) || undefined : undefined;
      if (event.dataTransfer?.files.length) {
        void Promise.resolve(
          callbacksRef.current.onImportFiles(event.dataTransfer.files, targetDir),
        ).catch(console.error);
      }
      setExternalDropTarget(null);
    };

    const handleDragEnd = () => {
      setExternalDropTarget(null);
    };

    host.addEventListener("contextmenu", handleContextMenu);
    host.addEventListener("dragover", handleDragOver);
    host.addEventListener("dragleave", handleDragLeave);
    host.addEventListener("drop", handleDrop);
    window.addEventListener("dragend", handleDragEnd);

    return () => {
      host.removeEventListener("contextmenu", handleContextMenu);
      host.removeEventListener("dragover", handleDragOver);
      host.removeEventListener("dragleave", handleDragLeave);
      host.removeEventListener("drop", handleDrop);
      window.removeEventListener("dragend", handleDragEnd);
    };
  }, [hasRootCreateActions]);

  useEffect(() => {
    const host = hostRef.current ?? getHostElement(wrapperRef.current);
    if (!host?.shadowRoot) return;

    for (const element of host.shadowRoot.querySelectorAll<HTMLElement>(
      "[data-studio-external-drag-target='true']",
    )) {
      element.removeAttribute("data-studio-external-drag-target");
    }

    if (!externalDropTarget) return;
    if (externalDropTarget === "") return;

    const selector = `[data-type="item"][data-item-path="${escapeAttributeValue(externalDropTarget)}"]`;
    host.shadowRoot
      .querySelector<HTMLElement>(selector)
      ?.setAttribute("data-studio-external-drag-target", "true");
  }, [externalDropTarget]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {hasFileOps && (
        <div className="shrink-0 border-b border-neutral-800/50 px-2.5 py-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-neutral-600">
              Files
            </span>
            <div className="flex items-center gap-0.5">
              {onCreateFile && (
                <button
                  type="button"
                  onClick={() => startCreate("file", "")}
                  className="rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-400"
                  title="New File"
                >
                  <Plus size={12} weight="bold" />
                </button>
              )}
              {onCreateFolder && (
                <button
                  type="button"
                  onClick={() => startCreate("folder", "")}
                  className="rounded p-0.5 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-neutral-400"
                  title="New Folder"
                >
                  <FolderSimplePlus size={12} weight="duotone" />
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <div
        ref={wrapperRef}
        className={`flex-1 min-h-0 ${
          externalDropTarget === ""
            ? "bg-[#3CE6AC]/5 outline outline-1 -outline-offset-1 outline-[#3CE6AC]/30"
            : ""
        }`}
      >
        <PierreFileTree
          className="block h-full"
          model={model}
          renderContextMenu={hasFileOps ? renderContextMenu : undefined}
          style={TREE_HOST_STYLE}
        />
      </div>

      {deleteTarget && (
        <div className="shrink-0 border-t border-neutral-800/50">
          <DeleteConfirm
            name={getPathBasename(deleteTarget)}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={handleDeleteConfirm}
          />
        </div>
      )}

      {rootContextMenu && (
        <RootContextMenu
          {...rootContextMenu}
          onClose={closeRootContextMenu}
          onNewFile={
            onCreateFile
              ? () => {
                  closeRootContextMenu();
                  startCreate("file", "");
                }
              : undefined
          }
          onNewFolder={
            onCreateFolder
              ? () => {
                  closeRootContextMenu();
                  startCreate("folder", "");
                }
              : undefined
          }
        />
      )}
    </div>
  );
});

export {
  buildMoveDestinationPath,
  buildStudioTreePaths,
  createPlaceholderPath,
  getDropPathData,
  isPendingCreateCleared,
};
