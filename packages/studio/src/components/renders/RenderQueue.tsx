import { memo, useRef, useEffect } from "react";
import { RenderQueueItem } from "./RenderQueueItem";
import type { RenderJob } from "./useRenderQueue";

interface RenderQueueProps {
  jobs: RenderJob[];
  onDelete: (jobId: string) => void;
  onClearCompleted: () => void;
  onStartRender: () => void;
  isRendering: boolean;
}

export const RenderQueue = memo(function RenderQueue({
  jobs,
  onDelete,
  onClearCompleted,
  onStartRender,
  isRendering,
}: RenderQueueProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(jobs.length);

  // Auto-scroll to bottom when new jobs are added
  useEffect(() => {
    if (jobs.length > prevCount.current && listRef.current) {
      listRef.current.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    }
    prevCount.current = jobs.length;
  }, [jobs.length]);

  const completedCount = jobs.filter((j) => j.status !== "rendering").length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800/50 flex-shrink-0">
        <span className="text-[11px] font-medium text-neutral-500 uppercase tracking-wider">
          Renders ({jobs.length})
        </span>
        <div className="flex items-center gap-1.5">
          {completedCount > 0 && (
            <button
              onClick={onClearCompleted}
              className="text-[10px] text-neutral-600 hover:text-neutral-400 transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={onStartRender}
            disabled={isRendering}
            className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50"
          >
            {isRendering ? "Rendering..." : "Export MP4"}
          </button>
        </div>
      </div>

      {/* Job list */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-neutral-700">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <p className="text-[10px] text-neutral-600 text-center">
              No renders yet
            </p>
          </div>
        ) : (
          jobs.map((job) => (
            <RenderQueueItem key={job.id} job={job} onDelete={() => onDelete(job.id)} />
          ))
        )}
      </div>
    </div>
  );
});
