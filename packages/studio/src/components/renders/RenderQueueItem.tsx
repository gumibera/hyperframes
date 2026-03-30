import { memo, useCallback, useState, useEffect, useRef } from "react";
import type { RenderJob } from "./useRenderQueue";

interface RenderQueueItemProps {
  job: RenderJob;
  onDelete: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatTimeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

/** Extracts a single JPEG frame from a video URL using a hidden video + canvas. */
function RenderThumbnail({ src }: { src: string }) {
  const [frame, setFrame] = useState<string | null>(null);
  const didExtract = useRef(false);

  useEffect(() => {
    if (didExtract.current) return;
    didExtract.current = true;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.preload = "metadata";

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const cleanup = () => {
      video.src = "";
      video.load();
    };

    video.addEventListener("loadedmetadata", () => {
      // Seek to ~10% in so we get a representative non-black frame
      video.currentTime = Math.min(2, video.duration * 0.1 || 2);
    });

    video.addEventListener("seeked", () => {
      if (!ctx) return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      setFrame(canvas.toDataURL("image/jpeg", 0.7));
      cleanup();
    });

    video.addEventListener("error", cleanup);

    video.src = src;
    video.load();

    return cleanup;
  }, [src]);

  if (!frame) {
    return <div className="w-full h-full bg-neutral-800 animate-pulse rounded" />;
  }

  return <img src={frame} alt="" draggable={false} className="w-full h-full object-cover" />;
}

export const RenderQueueItem = memo(function RenderQueueItem({
  job,
  onDelete,
}: RenderQueueItemProps) {
  const [hovered, setHovered] = useState(false);

  const handleOpen = useCallback(() => {
    window.open(`/api/render/${job.id}/view`, "_blank");
  }, [job.id]);

  const handleDownload = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const a = document.createElement("a");
      a.href = `/api/render/${job.id}/download`;
      a.download = job.filename;
      a.click();
    },
    [job.id, job.filename],
  );

  const isClickable = job.status === "complete";

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={isClickable ? handleOpen : undefined}
      className={[
        "px-3 py-2.5 border-b border-neutral-800/30 last:border-0 transition-colors duration-150",
        isClickable ? "cursor-pointer hover:bg-neutral-800/30" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2.5">
        {/* Thumbnail — matches CompCard sizing (w-20 h-[45px]) */}
        <div className="w-20 h-[45px] rounded overflow-hidden bg-neutral-900 flex-shrink-0 relative">
          {job.status === "complete" && <RenderThumbnail src={`/api/render/${job.id}/view`} />}
          {job.status === "rendering" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-[#3CE6AC] animate-pulse" />
            </div>
          )}
          {job.status === "failed" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-red-400" />
            </div>
          )}
          {job.status === "cancelled" && (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-2 h-2 rounded-full bg-neutral-600" />
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-neutral-300 truncate">
              {job.filename}
            </span>
            {job.durationMs && (
              <span className="text-[9px] text-neutral-600 flex-shrink-0">
                {formatDuration(job.durationMs)}
              </span>
            )}
          </div>

          {/* Progress bar + percentage */}
          {job.status === "rendering" && (
            <div className="mt-1">
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] text-neutral-500">{job.stage || "Rendering"}</span>
                <span className="text-[9px] font-mono text-[#3CE6AC]">{job.progress}%</span>
              </div>
              <div className="w-full h-1 bg-neutral-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#3CE6AC] rounded-full transition-all duration-300"
                  style={{ width: `${job.progress}%` }}
                />
              </div>
            </div>
          )}

          {job.status === "failed" && job.error && (
            <span className="text-[9px] text-red-400 mt-0.5 block">{job.error}</span>
          )}

          {job.status !== "rendering" && (
            <span className="text-[9px] text-neutral-600">{formatTimeAgo(job.createdAt)}</span>
          )}
        </div>

        {/* Actions */}
        {hovered && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {job.status === "complete" && (
              <button
                onClick={handleDownload}
                className="p-1 rounded text-neutral-500 hover:text-green-400 transition-colors"
                title="Download"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              className="p-1 rounded text-neutral-500 hover:text-red-400 transition-colors"
              title="Remove"
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
