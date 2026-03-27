import { useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { NLELayout } from "./components/nle/NLELayout";
import { SourceEditor } from "./components/editor/SourceEditor";
import { FileTree } from "./components/editor/FileTree";
import { LeftSidebar } from "./components/sidebar/LeftSidebar";
import { RenderQueue } from "./components/renders/RenderQueue";
import { useRenderQueue } from "./components/renders/useRenderQueue";
import { CompositionThumbnail } from "./player/components/CompositionThumbnail";
import { VideoThumbnail } from "./player/components/VideoThumbnail";
import type { TimelineElement } from "./player/store/playerStore";
import { XIcon, WarningIcon, CheckCircleIcon, CaretRightIcon } from "@phosphor-icons/react";

interface EditingFile {
  path: string;
  content: string | null;
}

interface ProjectEntry {
  id: string;
  title?: string;
  sessionId?: string;
}

interface LintFinding {
  severity: "error" | "warning";
  message: string;
  file?: string;
  fixHint?: string;
}

import { ExpandOnHover } from "./components/ui/ExpandOnHover";

// ── Project Card with hover-to-preview ──

function ExpandedPreviewIframe({ src }: { src: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [dims, setDims] = useState({ w: 1920, h: 1080 });
  const [scale, setScale] = useState(1);

  // Recalculate scale when container resizes or dims change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      // Fit the composition inside the container (contain, not cover)
      const s = Math.min(cw / dims.w, ch / dims.h);
      setScale(s);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [dims]);

  // After iframe loads: detect composition dimensions, seek, and play
  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let attempts = 0;
    const interval = setInterval(() => {
      try {
        const doc = iframe.contentDocument;
        if (doc) {
          const comp = doc.querySelector("[data-composition-id]") as HTMLElement | null;
          if (comp) {
            const w = parseInt(comp.getAttribute("data-width") ?? "0", 10);
            const h = parseInt(comp.getAttribute("data-height") ?? "0", 10);
            if (w > 0 && h > 0) setDims({ w, h });
          }
        }
        const win = iframe.contentWindow as Window & {
          __player?: { seek: (t: number) => void; play: () => void };
        };
        if (win?.__player) {
          win.__player.seek(2);
          win.__player.play();
          clearInterval(interval);
        }
      } catch {
        /* cross-origin */
      }
      if (++attempts > 25) clearInterval(interval);
    }, 200);
  }, []);

  // Center the scaled iframe
  const offsetX = containerRef.current
    ? (containerRef.current.clientWidth - dims.w * scale) / 2
    : 0;
  const offsetY = containerRef.current
    ? (containerRef.current.clientHeight - dims.h * scale) / 2
    : 0;

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-black">
      <iframe
        ref={iframeRef}
        src={src}
        sandbox="allow-scripts allow-same-origin"
        onLoad={handleLoad}
        className="absolute border-none"
        style={{
          left: Math.max(0, offsetX),
          top: Math.max(0, offsetY),
          width: dims.w,
          height: dims.h,
          transformOrigin: "0 0",
          transform: `scale(${scale})`,
        }}
      />
    </div>
  );
}

function ProjectCard({ project: p, onSelect }: { project: ProjectEntry; onSelect: () => void }) {
  const thumbnailUrl = `/api/projects/${p.id}/thumbnail/index.html?t=0.5`;
  const previewUrl = `/api/projects/${p.id}/preview`;

  const card = (
    <div className="rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800/60 hover:border-[#3CE6AC]/30 hover:shadow-lg hover:shadow-[#3CE6AC]/5 transition-all duration-200 cursor-pointer">
      <div className="aspect-video bg-neutral-950 relative overflow-hidden flex items-center justify-center">
        <img
          src={thumbnailUrl}
          alt={p.title ?? p.id}
          loading="lazy"
          className="max-w-full max-h-full object-contain"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="px-3.5 py-3">
        <div className="text-sm font-medium text-neutral-200 truncate">{p.title ?? p.id}</div>
        <div className="text-[10px] text-neutral-600 font-mono truncate mt-0.5">{p.id}</div>
      </div>
    </div>
  );

  const expandedPreview = (
    <div className="w-full h-full bg-neutral-950 rounded-[16px] overflow-hidden flex flex-col">
      <div className="flex-1 min-h-0">
        <ExpandedPreviewIframe src={previewUrl} />
      </div>
      <div className="px-5 py-3 bg-neutral-900 border-t border-neutral-800/50 flex items-center justify-between flex-shrink-0">
        <div>
          <div className="text-sm font-medium text-neutral-200">{p.title ?? p.id}</div>
          <div className="text-[10px] text-neutral-600 font-mono mt-0.5">{p.id}</div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect();
          }}
          className="px-4 py-1.5 text-xs font-semibold text-[#09090B] bg-[#3CE6AC] rounded-lg hover:brightness-110 transition-colors"
        >
          Open
        </button>
      </div>
    </div>
  );

  return (
    <ExpandOnHover
      expandedContent={expandedPreview}
      onClick={onSelect}
      expandScale={0.6}
      delay={400}
    >
      {card}
    </ExpandOnHover>
  );
}

// ── Project Picker ──

function ProjectPicker({ onSelect }: { onSelect: (id: string) => void }) {
  const [projects, setProjects] = useState<ProjectEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/projects")
      .then((r) => r.json())
      .then((data: { projects?: ProjectEntry[] }) => {
        setProjects(data.projects ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="h-screen w-screen bg-neutral-950 overflow-y-auto">
      {/* Header */}
      <div className="max-w-4xl mx-auto px-6 pt-16 pb-8">
        <div className="flex items-center gap-3 mb-2">
          <svg width="32" height="32" viewBox="0 0 512 512" className="flex-shrink-0">
            <rect width="512" height="512" rx="115" fill="#1A1913" />
            <g strokeLinecap="round" strokeLinejoin="round">
              <polyline
                points="156,176 76,256 156,336"
                fill="none"
                stroke="#7B7568"
                strokeWidth="32"
              />
              <line x1="206" y1="346" x2="286" y2="166" stroke="#D8D3C5" strokeWidth="32" />
              <polygon
                points="336,176 436,256 336,336"
                fill="#3CE6AC"
                stroke="#3CE6AC"
                strokeWidth="32"
              />
            </g>
          </svg>
          <h1 className="text-2xl font-bold text-neutral-100 tracking-tight">HyperFrames Studio</h1>
        </div>
        <p className="text-sm text-neutral-500 ml-11">Your projects</p>
      </div>

      {/* Project grid */}
      <div className="max-w-4xl mx-auto px-6 pb-16">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="aspect-video rounded-xl bg-neutral-900 animate-pulse" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4">
            <svg width="48" height="48" viewBox="0 0 512 512" className="opacity-20">
              <rect width="512" height="512" rx="115" fill="#1A1913" />
              <g strokeLinecap="round" strokeLinejoin="round">
                <polyline
                  points="156,176 76,256 156,336"
                  fill="none"
                  stroke="#7B7568"
                  strokeWidth="32"
                />
                <line x1="206" y1="346" x2="286" y2="166" stroke="#D8D3C5" strokeWidth="32" />
                <polygon
                  points="336,176 436,256 336,336"
                  fill="#3CE6AC"
                  stroke="#3CE6AC"
                  strokeWidth="32"
                />
              </g>
            </svg>
            <div className="text-center">
              <p className="text-sm text-neutral-400 font-medium">No projects yet</p>
              <p className="text-xs text-neutral-600 mt-1">
                Run{" "}
                <code className="px-1.5 py-0.5 rounded bg-neutral-800 text-[#3CE6AC] text-[11px]">
                  hyperframes init
                </code>{" "}
                to create one
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((p) => (
              <ProjectCard key={p.id} project={p} onSelect={() => onSelect(p.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lint Modal ──

function LintModal({ findings, onClose }: { findings: LintFinding[]; onClose: () => void }) {
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
    const text = `Fix these HyperFrames lint issues:\n\n${lines.join("\n\n")}`;
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

  useEffect(() => {
    const hash = window.location.hash;
    const projectMatch = hash.match(/project\/([^/]+)/);
    const sessionMatch = hash.match(/session\/([^/]+)/);
    if (projectMatch) {
      setProjectId(projectMatch[1]);
      setResolving(false);
    } else if (sessionMatch) {
      fetch(`/api/resolve-session/${sessionMatch[1]}`)
        .then((r) => r.json())
        .then((data: { projectId?: string }) => {
          if (data.projectId) {
            window.location.hash = `#project/${data.projectId}`;
            setProjectId(data.projectId);
          }
          setResolving(false);
        })
        .catch(() => setResolving(false));
    } else {
      setResolving(false);
    }
  }, []);

  const [editingFile, setEditingFile] = useState<EditingFile | null>(null);
  const [rightTab, setRightTab] = useState<"code" | "renders">("code");
  const [activeCompPath, setActiveCompPath] = useState<string | null>(null);
  const [fileTree, setFileTree] = useState<string[]>([]);
  const [compIdToSrc, setCompIdToSrc] = useState<Map<string, string>>(new Map());
  const renderQueue = useRenderQueue(projectId);

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

      if (compSrc) {
        const previewUrl = `/api/projects/${pid}/preview/comp/${compSrc}`;
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

      // HTML scene divs — render from index.html at the scene's time
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
    [compIdToSrc],
  );
  const [lintModal, setLintModal] = useState<LintFinding[] | null>(null);
  const [linting, setLinting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectIdRef = useRef(projectId);
  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  // Listen for external file changes (user editing HTML outside the editor)
  useEffect(() => {
    if (!import.meta.hot) return;
    const handler = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => setRefreshKey((k) => k + 1), 400);
    };
    import.meta.hot.on("hf:file-change", handler);
    return () => import.meta.hot?.off?.("hf:file-change", handler);
  }, []);
  projectIdRef.current = projectId;

  // Load file tree when projectId changes
  const prevProjectIdRef = useRef<string | null>(null);
  if (projectId && projectId !== prevProjectIdRef.current) {
    prevProjectIdRef.current = projectId;
    fetch(`/api/projects/${projectId}`)
      .then((r) => r.json())
      .then((data: { files?: string[] }) => {
        if (data.files) setFileTree(data.files);
      })
      .catch(() => {});
  }

  const handleSelectProject = useCallback((id: string) => {
    window.location.hash = `#project/${id}`;
    setProjectId(id);
  }, []);

  const handleFileSelect = useCallback((path: string) => {
    const pid = projectIdRef.current;
    if (!pid) return;
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
      // Fetch all HTML files and lint them client-side using the core linter
      const res = await fetch(`/api/projects/${pid}`);
      const data = await res.json();
      const files: string[] = data.files?.filter((f: string) => f.endsWith(".html")) ?? [];

      const findings: LintFinding[] = [];
      for (const file of files) {
        const fileRes = await fetch(`/api/projects/${pid}/files/${encodeURIComponent(file)}`);
        const fileData = await fileRes.json();
        if (!fileData.content) continue;

        // Basic lint checks (subset of the full linter)
        const html = fileData.content as string;

        if (file === "index.html") {
          // Check for root composition
          if (!html.includes("data-composition-id")) {
            findings.push({
              severity: "error",
              message: "No element with `data-composition-id` found.",
              file,
              fixHint: "Add `data-composition-id` to the root composition wrapper.",
            });
          }
          // Check for timeline registration
          if (!html.includes("__timelines")) {
            findings.push({
              severity: "error",
              message: "Missing `window.__timelines` registration.",
              file,
              fixHint: 'Add: window.__timelines["compositionId"] = tl;',
            });
          }
          // Check for TARGET_DURATION
          if (
            html.includes("gsap.timeline") &&
            !html.includes("TARGET_DURATION") &&
            !html.includes("tl.set({}, {},")
          ) {
            findings.push({
              severity: "warning",
              message: "No TARGET_DURATION spacer found. Video may be shorter than intended.",
              file,
              fixHint:
                "Add: const TARGET_DURATION = 30; if (tl.duration() < TARGET_DURATION) { tl.set({}, {}, TARGET_DURATION); }",
            });
          }
        }

        // Check for composition hosts missing dimensions
        const hostRe = /data-composition-src=["']([^"']+)["']/g;
        let hostMatch;
        while ((hostMatch = hostRe.exec(html)) !== null) {
          const surrounding = html.slice(
            Math.max(0, hostMatch.index - 300),
            hostMatch.index + hostMatch[0].length + 50,
          );
          const hasDataDims =
            /data-width\s*=/i.test(surrounding) && /data-height\s*=/i.test(surrounding);
          const hasStyleDims = /style\s*=.*width:\s*\d+px.*height:\s*\d+px/i.test(surrounding);
          if (!hasDataDims && !hasStyleDims) {
            findings.push({
              severity: "warning",
              message: `Composition host for "${hostMatch[1]}" missing data-width/data-height. May render with zero dimensions.`,
              file,
              fixHint:
                'Add data-width="1920" data-height="1080" style="position:relative;width:1920px;height:1080px"',
            });
          }
        }

        // Check for repeat: -1
        if (/repeat\s*:\s*-\s*1/.test(html)) {
          findings.push({
            severity: "error",
            message: "GSAP `repeat: -1` found — infinite loop breaks timeline duration.",
            file,
            fixHint: "Use a finite repeat count or CSS animation.",
          });
        }

        // Check script syntax
        const scriptRe = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
        let scriptMatch;
        while ((scriptMatch = scriptRe.exec(html)) !== null) {
          const js = scriptMatch[1]?.trim();
          if (!js) continue;
          try {
            new Function(js);
          } catch (e) {
            findings.push({
              severity: "error",
              message: `Script syntax error: ${e instanceof Error ? e.message : String(e)}`,
              file,
            });
          }
        }
      }

      setLintModal(findings);
    } catch {
      setLintModal([{ severity: "error", message: "Failed to run lint." }]);
    } finally {
      setLinting(false);
    }
  }, []);

  if (resolving) {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex items-center justify-center">
        <div className="text-sm text-neutral-500">Loading...</div>
      </div>
    );
  }

  if (!projectId) {
    return <ProjectPicker onSelect={handleSelectProject} />;
  }

  const compositions = fileTree.filter((f) => f === "index.html" || f.startsWith("compositions/"));
  const assets = fileTree.filter(
    (f) => !f.endsWith(".html") && !f.endsWith(".md") && !f.endsWith(".json"),
  );

  return (
    <div className="flex flex-col h-screen w-screen bg-neutral-950">
      {/* Top row: sidebar + preview + right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left sidebar: Compositions + Assets */}
        <LeftSidebar
          projectId={projectId}
          compositions={compositions}
          assets={assets}
          activeComposition={editingFile?.path ?? null}
          onSelectComposition={(comp) => {
            // Set active composition for preview drill-down
            setActiveCompPath(comp.startsWith("compositions/") ? comp : null);
            // Force preview refresh to reload the iframe
            setRefreshKey((k) => k + 1);
            // Load file content for code editor
            setEditingFile({ path: comp, content: null });
            fetch(`/api/projects/${projectId}/files/${comp}`)
              .then((r) => r.json())
              .then((data) => setEditingFile({ path: comp, content: data.content }))
              .catch(() => {});
          }}
        />

        {/* Center: Preview */}
        <div className="flex-1 relative min-w-0">
          <NLELayout
            projectId={projectId}
            refreshKey={refreshKey}
            activeCompositionPath={activeCompPath}
            renderClipContent={renderClipContent}
            onCompIdToSrcChange={setCompIdToSrc}
            onIframeRef={(iframe) => {
              previewIframeRef.current = iframe;
            }}
          />

          {/* Lint button — top-right of preview */}
          <div className="absolute top-3 right-3 z-50 flex items-center gap-1.5">
            <button
              onClick={handleLint}
              disabled={linting}
              className="h-8 px-3 rounded-lg bg-neutral-900 border border-neutral-800 text-xs font-medium text-neutral-400 hover:text-amber-300 hover:border-amber-800/50 transition-colors disabled:opacity-40"
            >
              {linting ? "Linting..." : "Lint"}
            </button>
          </div>
        </div>

        {/* Right panel: Code + Renders tabs — always visible */}
        <div className="w-[320px] flex flex-col border-l border-neutral-800 bg-neutral-900 flex-shrink-0">
          {/* Tab bar */}
          <div className="flex items-center border-b border-neutral-800 flex-shrink-0">
            <button
              onClick={() => setRightTab("code")}
              className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                rightTab === "code"
                  ? "text-neutral-200 border-b-2 border-[#3CE6AC]"
                  : "text-neutral-500 hover:text-neutral-400"
              }`}
            >
              Code
            </button>
            <button
              onClick={() => setRightTab("renders")}
              className={`flex-1 py-2 text-[11px] font-medium transition-colors ${
                rightTab === "renders"
                  ? "text-neutral-200 border-b-2 border-[#3CE6AC]"
                  : "text-neutral-500 hover:text-neutral-400"
              }`}
            >
              Renders{renderQueue.jobs.length > 0 ? ` (${renderQueue.jobs.length})` : ""}
            </button>
          </div>

          {/* Tab content */}
          {rightTab === "code" ? (
            <>
              {fileTree.length > 0 && (
                <div className="border-b border-neutral-800 max-h-32 overflow-y-auto">
                  <FileTree
                    files={fileTree}
                    activeFile={editingFile?.path ?? null}
                    onSelectFile={handleFileSelect}
                  />
                </div>
              )}
              <div className="flex-1 overflow-hidden">
                {editingFile ? (
                  <SourceEditor
                    content={editingFile.content ?? ""}
                    filePath={editingFile.path}
                    onChange={handleContentChange}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-neutral-600 text-sm">
                    Select a file to edit
                  </div>
                )}
              </div>
            </>
          ) : (
            <RenderQueue
              jobs={renderQueue.jobs}
              onDelete={renderQueue.deleteRender}
              onClearCompleted={renderQueue.clearCompleted}
              onStartRender={() => renderQueue.startRender()}
              isRendering={renderQueue.isRendering}
            />
          )}
        </div>
      </div>

      {/* Lint modal */}
      {lintModal !== null && <LintModal findings={lintModal} onClose={() => setLintModal(null)} />}
    </div>
  );
}
