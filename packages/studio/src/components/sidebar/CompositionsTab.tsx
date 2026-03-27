import { memo, useState, useRef, useEffect } from "react";

interface CompositionsTabProps {
  projectId: string;
  compositions: string[];
  activeComposition: string | null;
  onSelect: (comp: string) => void;
}

function CompCard({
  projectId,
  comp,
  isActive,
  onSelect,
}: {
  projectId: string;
  comp: string;
  isActive: boolean;
  onSelect: () => void;
}) {
  const name = comp.replace(/^compositions\//, "").replace(/\.html$/, "");
  const [hovered, setHovered] = useState(false);
  const [iframeReady, setIframeReady] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbnailUrl = `/api/projects/${projectId}/thumbnail/${comp}?t=0.5`;
  const previewUrl = `/api/projects/${projectId}/preview/comp/${comp}`;

  // Auto-play iframe composition on hover
  useEffect(() => {
    if (!hovered) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    let attempts = 0;
    const interval = setInterval(() => {
      try {
        const win = iframe.contentWindow as Window & {
          __player?: { play: () => void; seek: (t: number) => void };
          __timelines?: Record<
            string,
            { play: () => void; seek: (t: number) => void; pause: () => void }
          >;
        };
        if (win?.__player) {
          win.__player.seek(0);
          win.__player.play();
          clearInterval(interval);
          return;
        }
        if (win?.__timelines) {
          const keys = Object.keys(win.__timelines);
          const tl = keys.length > 0 ? win.__timelines[keys[keys.length - 1]] : null;
          if (tl) {
            tl.seek(0);
            tl.play();
            clearInterval(interval);
          }
        }
      } catch {
        // cross-origin
      }
      if (++attempts > 15) clearInterval(interval);
    }, 200);

    return () => {
      clearInterval(interval);
      try {
        const win = iframe.contentWindow as Window & {
          __player?: { pause: () => void };
          __timelines?: Record<string, { pause: () => void }>;
        };
        if (win?.__player) win.__player.pause();
        else if (win?.__timelines) {
          for (const tl of Object.values(win.__timelines)) tl?.pause?.();
        }
      } catch {
        // cross-origin
      }
    };
  }, [hovered]);

  return (
    <button
      type="button"
      onClick={onSelect}
      onPointerEnter={() => {
        if (hoverTimer.current) clearTimeout(hoverTimer.current);
        hoverTimer.current = setTimeout(() => setHovered(true), 200);
      }}
      onPointerLeave={() => {
        if (hoverTimer.current) {
          clearTimeout(hoverTimer.current);
          hoverTimer.current = null;
        }
        setHovered(false);
        setIframeReady(false);
      }}
      className={`w-full text-left px-2 py-1.5 flex items-center gap-2.5 transition-colors ${
        isActive
          ? "bg-[#3CE6AC]/10 border-l-2 border-[#3CE6AC]"
          : "border-l-2 border-transparent hover:bg-neutral-800/50"
      }`}
    >
      {/* Thumbnail with hover-to-preview */}
      <div
        ref={containerRef}
        className="w-20 h-[45px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative"
      >
        <img
          src={thumbnailUrl}
          alt={name}
          loading="lazy"
          className="w-full h-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
        {hovered && (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            sandbox="allow-scripts allow-same-origin"
            onLoad={() => setTimeout(() => setIframeReady(true), 300)}
            className="absolute border-none pointer-events-none"
            style={{
              top: 0,
              left: 0,
              width: 1920,
              height: 1080,
              transformOrigin: "0 0",
              transform: `scale(${(containerRef.current?.clientWidth ?? 80) / 1920})`,
              opacity: iframeReady ? 1 : 0,
              transition: "opacity 200ms ease-out",
            }}
            tabIndex={-1}
          />
        )}
      </div>
      {/* Name */}
      <div className="min-w-0 flex-1">
        <span className="text-[11px] font-medium text-neutral-300 truncate block">{name}</span>
        <span className="text-[9px] text-neutral-600 truncate block">{comp}</span>
      </div>
    </button>
  );
}

export const CompositionsTab = memo(function CompositionsTab({
  projectId,
  compositions,
  activeComposition,
  onSelect,
}: CompositionsTabProps) {
  if (compositions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center px-4">
        <p className="text-xs text-neutral-600 text-center">No compositions found</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {compositions.map((comp) => (
        <CompCard
          key={comp}
          projectId={projectId}
          comp={comp}
          isActive={activeComposition === comp}
          onSelect={() => onSelect(comp)}
        />
      ))}
    </div>
  );
});
