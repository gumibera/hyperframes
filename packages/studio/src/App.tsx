import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useMountEffect } from "./hooks/useMountEffect";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RenderQueue } from "./components/renders/RenderQueue";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { CompositionThumbnail, VideoThumbnail } from "./player";
import { AudioWaveform } from "./player/components/AudioWaveform";
import type { TimelineElement } from "./player";
import { XIcon, WarningIcon, CheckCircleIcon, CaretRightIcon } from "@phosphor-icons/react";

interface EditingFile {
  path: string;
  content: string | null;
}

interface LintFinding {
  severity: "error" | "warning";
  message: string;
  file?: string;
  fixHint?: string;
}

// ── Media file detection and preview ──

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|ico)$/i;
const VIDEO_EXT = /\.(mp4|webm|mov)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac)$/i;
const FONT_EXT = /\.(woff|woff2|ttf|otf|eot)$/i;

function isMediaFile(path: string): boolean {
  return (
    IMAGE_EXT.test(path) || VIDEO_EXT.test(path) || AUDIO_EXT.test(path) || FONT_EXT.test(path)
  );
}

function MediaPreview({ projectId, filePath }: { projectId: string; filePath: string }) {
  const serveUrl = `/api/projects/${projectId}/preview/${filePath}`;
  const name = filePath.split("/").pop() ?? filePath;

  if (IMAGE_EXT.test(filePath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950">
        <img
          src={serveUrl}
          alt={name}
          className="max-w-full max-h-[70%] object-contain rounded border border-neutral-800"
        />
        <span className="mt-3 text-[11px] text-neutral-500 font-mono">{filePath}</span>
      </div>
    );
  }

  if (VIDEO_EXT.test(filePath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950">
        <video
          src={serveUrl}
          controls
          className="max-w-full max-h-[70%] rounded border border-neutral-800"
        />
        <span className="mt-3 text-[11px] text-neutral-500 font-mono">{filePath}</span>
      </div>
    );
  }

  if (AUDIO_EXT.test(filePath)) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950 gap-3">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-neutral-600"
        >
          <path d="M9 18V5l12-2v13" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
        <audio src={serveUrl} controls className="w-full max-w-[280px]" />
        <span className="text-[11px] text-neutral-500 font-mono">{filePath}</span>
      </div>
    );
  }

  // Fonts and other binary — show info instead of binary dump
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 bg-neutral-950 gap-2">
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="text-neutral-600"
      >
        <path
          d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline points="14 2 14 8 20 8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-sm text-neutral-400 font-medium">{name}</span>
      <span className="text-[11px] text-neutral-600 font-mono">{filePath}</span>
      <span className="text-[10px] text-neutral-600">Binary file — preview not available</span>
    </div>
  );
}

// ── Lint Modal ──

function LintModal({
  findings,
  projectId,
  onClose,
}: {
  findings: LintFinding[];
  projectId: string;
  onClose: () => void;
}) {
  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warning");
  const hasIssues = findings.length > 0;
  const [copied, setCopied] = useState(false);

  const handleCopyToAgent = async () => {
    const lines = findings.map((f) => {
      let line = `[${f.severity}] ${f.message}`;
      if (f.file) line += `\n  File: ${f.file}`;
      if (f.fixHint) line += `\n  Fix: ${f.fixHint}`;
      return line;
    });
    const text = `Fix these HyperFrames lint issues for project "${projectId}":\n\nProject path: ${window.location.href}\n\n${lines.join("\n\n")}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-neutral-950 border border-neutral-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-800">
          <div className="flex items-center gap-3">
            {hasIssues ? (
              <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center">
                <WarningIcon size={18} className="text-red-400" weight="fill" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-[#3CE6AC]/10 flex items-center justify-center">
                <CheckCircleIcon size={18} className="text-[#3CE6AC]" weight="fill" />
              </div>
            )}
            <div>
              <h2 className="text-sm font-semibold text-neutral-200">
                {hasIssues
                  ? `${errors.length} error${errors.length !== 1 ? "s" : ""}, ${warnings.length} warning${warnings.length !== 1 ? "s" : ""}`
                  : "All checks passed"}
              </h2>
              <p className="text-xs text-neutral-500">HyperFrame Lint Results</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
          >
            <XIcon size={16} />
          </button>
        </div>

        {/* Copy to agent + findings */}
        {hasIssues && (
          <div className="flex items-center justify-end px-5 py-2 border-b border-neutral-800/50">
            <button
              onClick={handleCopyToAgent}
              className={`px-3 py-1 text-xs font-medium rounded-lg transition-colors ${
                copied ? "bg-green-600 text-white" : "bg-[#3CE6AC] hover:bg-[#3CE6AC]/80 text-white"
              }`}
            >
              {copied ? "Copied!" : "Copy to Agent"}
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {!hasIssues && (
            <div className="py-8 text-center text-neutral-500 text-sm">
              No errors or warnings found. Your composition looks good!
            </div>
          )}
          {errors.map((f, i) => (
            <div key={`e-${i}`} className="py-3 border-b border-neutral-800/50 last:border-0">
              <div className="flex items-start gap-2">
                <WarningIcon
                  size={14}
                  className="text-red-400 flex-shrink-0 mt-0.5"
                  weight="fill"
                />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-200">{f.message}</p>
                  {f.file && <p className="text-xs text-neutral-600 font-mono mt-0.5">{f.file}</p>}
                  {f.fixHint && (
                    <div className="flex items-start gap-1 mt-1.5">
                      <CaretRightIcon size={10} className="text-[#3CE6AC] flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-[#3CE6AC]">{f.fixHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
          {warnings.map((f, i) => (
            <div key={`w-${i}`} className="py-3 border-b border-neutral-800/50 last:border-0">
              <div className="flex items-start gap-2">
                <WarningIcon size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm text-neutral-300">{f.message}</p>
                  {f.file && <p className="text-xs text-neutral-600 font-mono mt-0.5">{f.file}</p>}
                  {f.fixHint && (
                    <div className="flex items-start gap-1 mt-1.5">
                      <CaretRightIcon size={10} className="text-[#3CE6AC] flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-[#3CE6AC]">{f.fixHint}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main App ──

export function StudioApp() {
  const [projectId, setProjectId] = useState<string | null>(null);
  const [resolving, setResolving] = useState(true);

  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const hashMatch = window.location.hash.match(/^#project\/([^/]+)/);
    if (hashMatch) {
      setProjectId(hashMatch[1]);
      setResolving(false);
      return;
    }
    // No hash — auto-select first available project
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data) => {
        const first = (data.projects ?? [])[0];
        if (first) {
          setProjectId(first.id);
          window.location.hash = `#project/${first.id}`;
        }
      })
      .catch(() => {})
      .finally(() => setResolving(false));
  }, []);

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const renderQueue = useRenderQueue(projectId);

  // Resizable and collapsible panel widths
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(400);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(true);
  const [timelineVisible, setTimelineVisible] = useState(false);
  const panelDragRef = useRef<{
    side: "left" | "right";
    startX: number;
    startW: number;
  } | null>(null);

  // Derive active preview URL from composition path (for drilled-down thumbnails)
  const activePreviewUrl = activeCompPath
    ? `/api/projects/${projectId}/preview/comp/${activeCompPath}`
    : null;

  const renderClipContent = useCallback(
    (el: TimelineElement, style: { clip: string; label: string }): ReactNode => {
      const pid = projectIdRef.current;
      if (!pid) return null;

      // Resolve composition source path using the compIdToSrc map
      let compSrc = el.compositionSrc;
      if (compSrc && compIdToSrc.size > 0) {
        const resolved =
          compIdToSrc.get(el.id) ||
          compIdToSrc.get(compSrc.replace(/^compositions\//, "").replace(/\.html$/, ""));
        if (resolved) compSrc = resolved;
      }

      // Composition clips — always use the comp's own preview URL for thumbnails.
      // This renders the composition in isolation so we get clean frames
      // instead of capturing the master at a time when the comp is fading in.
      if (compSrc) {
        return (
          <CompositionThumbnail
            previewUrl={`/api/projects/${pid}/preview/comp/${compSrc}`}
            label={el.id || el.tag}
            labelColor={style.label}
            seekTime={0}
            duration={el.duration}
          />
        );
      }

      // When drilled into a composition, render all inner elements via
      // CompositionThumbnail at their start time — most accurate visual.
      if (activePreviewUrl && el.duration > 0) {
        return (
          <CompositionThumbnail
            previewUrl={activePreviewUrl}
            label={el.id || el.tag}
            labelColor={style.label}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      // Audio clips — waveform visualization
      if (el.tag === "audio") {
        const audioUrl = el.src
          ? el.src.startsWith("http")
            ? el.src
            : `/api/projects/${pid}/preview/${el.src}`
          : "";
        return (
          <AudioWaveform audioUrl={audioUrl} label={el.id || el.tag} labelColor={style.label} />
        );
      }

      if ((el.tag === "video" || el.tag === "img") && el.src) {
        const mediaSrc = el.src.startsWith("http")
          ? el.src
          : `/api/projects/${pid}/preview/${el.src}`;
        return (
          <VideoThumbnail
            videoSrc={mediaSrc}
            label={el.id || el.tag}
            labelColor={style.label}
            duration={el.duration}
          />
        );
      }

      // HTML scene elements — render from the master preview at the scene's time
      if (el.tag === "div" && el.duration > 0) {
        const previewUrl = `/api/projects/${pid}/preview`;
        return (
          <CompositionThumbnail
            previewUrl={previewUrl}
            label={el.id || el.tag}
            labelColor={style.label}
            seekTime={el.start}
            duration={el.duration}
          />
        );
      }

      return null;
    },
    [compIdToSrc, activePreviewUrl],
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Listen for external file changes (user editing HTML outside the editor).
  // In dev: use Vite HMR. In embedded/production: use SSE from /api/events.
  useMountEffect(() => {
    const handler = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 400);
    };
    if (import.meta.hot) {
      import.meta.hot.on("hf:file-change", handler);
      return () => import.meta.hot?.off?.("hf:file-change", handler);
    }
    // SSE fallback for embedded studio server
    const es = new EventSource("/api/events");
    es.addEventListener("file-change", handler);
    return () => es.close();
  });
  projectIdRef.current = projectId;

  // Load file tree when projectId changes.
  // Note: This is one of the few places where useEffect with deps is acceptable —
  // it's data fetching tied to a prop change. Ideally this would use a data-fetching
  // library (useQuery/useSWR) or the parent component would own the fetch.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[] }) => {
        if (!cancelled && data.files) setFileTree(data.files);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleFileSelect = useCallback((path: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
    // Expand left panel to 50vw when opening a file in Code tab
    setLeftWidth((prev) => Math.max(prev, Math.floor(window.innerWidth * 0.5)));
    // Skip fetching binary content for media files — just set the path for preview
    if (isMediaFile(path)) {
      setEditingFile({ path, content: null });
      return;
    }
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((data: { content?: string }) => {
        if (data.content != null) {
          setEditingFile({ path, content: data.content });
        }
      })
      .catch(() => {});
  }, []);

  const editingPathRef = useRef(editingFile?.path);
  editingPathRef.current = editingFile?.path;

  const handleContentChange = useCallback((content: string) => {
    const pid = projectIdRef.current;
    const path = editingPathRef.current;
    if (!pid || !path) return;
    // Don't update editingFile state — the editor manages its own content.
    // Only save to disk and refresh the preview.
    fetch(`/api/projects/${pid}/files/${encodeURIComponent(path)}`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: content,
    })
      .then(() => {
        if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 600);
      })
      .catch(() => {});
  }, []);

  const handleLint = useCallback(async () => {
    const pid = projectIdRef.current;
    if (!pid) return;
    setLinting(true);
    try {
      const res = await fetch(`/api/projects/${pid}/lint`);
      const data = await res.json();
      const findings: LintFinding[] = (data.findings ?? []).map(
        (f: { severity?: string; message?: string; file?: string; fixHint?: string }) => ({
          severity: f.severity === "error" ? ("error" as const) : ("warning" as const),
          message: f.message ?? "",
          file: f.file,
          fixHint: f.fixHint,
        }),
      );
      setLintModal(findings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLintModal([{ severity: "error", message: `Failed to run lint: ${msg}` }]);
    } finally {
      setLinting(false);
    }
  }, []);

  // Panel resize via pointer events (works for both left sidebar and right panel)
  const handlePanelResizeStart = useCallback(
    (side: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      panelDragRef.current = {
        side,
        startX: e.clientX,
        startW: side === "left" ? leftWidth : rightWidth,
      };
    },
    [leftWidth, rightWidth],
  );

  const handlePanelResizeMove = useCallback((e: React.PointerEvent) => {
    const drag = panelDragRef.current;
    if (!drag) return;
    const delta = e.clientX - drag.startX;
    const maxLeft = Math.floor(window.innerWidth * 0.5);
    const newW = Math.max(
      160,
      Math.min(
        drag.side === "left" ? maxLeft : 600,
        drag.startW + (drag.side === "left" ? delta : -delta),
      ),
    );
    if (drag.side === "left") setLeftWidth(newW);
    else setRightWidth(newW);
  }, []);

  const handlePanelResizeEnd = useCallback(() => {
    panelDragRef.current = null;
  }, []);

  if (resolving || !projectId) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center">
        <div className="w-4 h-4 rounded-full bg-[#3CE6AC] animate-pulse" />
      </div>
    );
  }

  // At this point projectId is guaranteed non-null (narrowed by the guard above)

  const compositions = fileTree.filter((f) => f === "index.html" || f.startsWith("compositions/"));
  const assets = fileTree.filter(
    (f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json"),
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950">
      {/* Header bar */}
      <div className="flex items-center justify-between h-10 px-3 bg-neutral-900 border-b border-neutral-800 flex-shrink-0">
        {/* Left: project name */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-neutral-400">{projectId}</span>
        </div>
        {/* Right: toolbar buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setLeftCollapsed((v) => !v)}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              !leftCollapsed
                ? "bg-neutral-800 border-neutral-700 text-neutral-300"
                : "bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
            }`}
            title={leftCollapsed ? "Show sidebar" : "Hide sidebar"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 3v18" />
            </svg>
          </button>
          <button
            onClick={() => setTimelineVisible((v) => !v)}
            className={`h-7 w-7 flex items-center justify-center rounded-md border transition-colors ${
              timelineVisible
                ? "text-[#3CE6AC] bg-[#3CE6AC]/10 border-[#3CE6AC]/30"
                : "bg-transparent border-transparent text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800"
            }`}
            title={timelineVisible ? "Hide timeline" : "Show timeline"}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <rect x="3" y="13" width="18" height="8" rx="1" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="5" x2="21" y2="5" />
            </svg>
          </button>
          <button
            onClick={() => setRightCollapsed((v) => !v)}
            className={`h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border transition-colors ${
              !rightCollapsed
                ? "text-[#3CE6AC] bg-[#3CE6AC]/10 border-[#3CE6AC]/30"
                : "text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800 border-transparent"
            }`}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="10" />
              <polygon points="10 8 16 12 10 16" fill="currentColor" stroke="none" />
            </svg>
            Renders
            {renderQueue.jobs.length > 0 ? ` (${renderQueue.jobs.length})` : ""}
          </button>
        </div>
      </div>

      {/* Main content: sidebar + preview + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: Compositions + Assets (resizable, collapsible) */}
        {!leftCollapsed && (
          <LeftSidebar
            width={leftWidth}
            projectId={projectId}
            compositions={compositions}
            assets={assets}
            activeComposition={editingFile?.path ?? null}
            onSelectComposition={(comp) => {
              // Set active composition for preview drill-down
              // Don't increment refreshKey — that reloads the master iframe and
              // overrides the composition navigation. Let activeCompositionPath
              // handle the preview change via the composition stack.
              setActiveCompPath(
                comp === "index.html" || comp.startsWith("compositions/") ? comp : null,
              );
              // Load file content for code editor
              setEditingFile({ path: comp, content: null });
              fetch(`/api/projects/${projectId}/files/${comp}`)
                .then((r) => r.json())
                .then((data) => setEditingFile({ path: comp, content: data.content }))
                .catch(() => {});
            }}
            fileTree={fileTree}
            editingFile={editingFile}
            onSelectFile={handleFileSelect}
            codeChildren={
              editingFile ? (
                isMediaFile(editingFile.path) ? (
                  <MediaPreview projectId={projectId} filePath={editingFile.path} />
                ) : (
                  <SourceEditor
                    content={editingFile.content ?? ""}
                    filePath={editingFile.path}
                    onChange={handleContentChange}
                  />
                )
              ) : undefined
            }
            onLint={handleLint}
            linting={linting}
          />
        )}

        {/* Left resize handle */}
        {!leftCollapsed && (
          <div
            className="w-1 flex-shrink-0 bg-neutral-800 hover:bg-blue-500 cursor-col-resize transition-colors active:bg-blue-400"
            style={{ touchAction: "none" }}
            onPointerDown={(e) => handlePanelResizeStart("left", e)}
            onPointerMove={handlePanelResizeMove}
            onPointerUp={handlePanelResizeEnd}
          />
        )}

        {/* Center: Preview */}
        <div className="flex-1 relative min-w-0">
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            renderClipContent={renderClipContent}
            onCompIdToSrcChange={setCompIdToSrc}
            onCompositionChange={(compPath) => {
              // Sync activeCompPath when user drills down via timeline double-click
              // or navigates back via breadcrumb — keeps sidebar + thumbnails in sync.
              setActiveCompPath(compPath);
            }}
            onIframeRef={(iframe) => {
              previewIframeRef.current = iframe;
            }}
            timelineVisible={timelineVisible}
            onToggleTimeline={() => setTimelineVisible((v) => !v)}
          />
        </div>

        {/* Right panel: Renders-only (resizable, collapsible via header Renders button) */}
        {!rightCollapsed && (
          <>
            <div
              className="w-1 flex-shrink-0 bg-neutral-800 hover:bg-blue-500 cursor-col-resize transition-colors active:bg-blue-400"
              style={{ touchAction: "none" }}
              onPointerDown={(e) => handlePanelResizeStart("right", e)}
              onPointerMove={handlePanelResizeMove}
              onPointerUp={handlePanelResizeEnd}
            />
            <div
              className="flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0"
              style={{ width: rightWidth }}
            >
              <RenderQueue
                jobs={renderQueue.jobs}
                onDelete={renderQueue.deleteRender}
                onClearCompleted={renderQueue.clearCompleted}
                onStartRender={(format) => renderQueue.startRender(30, "standard", format)}
                isRendering={renderQueue.isRendering}
              />
            </div>
          </>
        )}
      </div>

      {/* Lint modal */}
      {lintModal !== null && (
        <LintModal findings={lintModal} projectId={projectId} onClose={() => setLintModal(null)} />
      )}
    </div>
  );
}
