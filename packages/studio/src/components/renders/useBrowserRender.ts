import { useState, useCallback } from "react";
import type { RenderJob } from "./useRenderQueue";

export function useBrowserRender(projectId: string | null) {
  const [isRendering, setIsRendering] = useState(false);
  const [job, setJob] = useState<RenderJob | null>(null);

  const startBrowserRender = useCallback(
    async (format: "mp4" | "webm" = "mp4") => {
      if (!projectId || isRendering) return;
      setIsRendering(true);

      const jobId = crypto.randomUUID();
      const startTime = Date.now();
      setJob({
        id: jobId,
        status: "rendering",
        progress: 0,
        stage: "initializing",
        filename: `browser-export.${format}`,
        createdAt: startTime,
      });

      try {
        const { render, isSupported } = await import("@hyperframes/renderer");
        if (!isSupported()) {
          throw new Error(
            "Browser does not support WebCodecs. Use Chrome 94+, Firefox 130+, or Safari 26+.",
          );
        }

        const result = await render({
          composition: `/api/projects/${projectId}/preview`,
          format,
          fps: 30,
          codec: "h264",
          frameSource: "snapdom",
          concurrency: 1,
          workerUrl: "/node_modules/@hyperframes/renderer/dist/worker.bundle.js",
          onProgress: (p) => {
            setJob((prev) =>
              prev
                ? {
                    ...prev,
                    progress: Math.round(p.progress * 100),
                    stage: p.stage,
                  }
                : prev,
            );
          },
        });

        // Trigger download
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `export.${format}`;
        a.click();
        URL.revokeObjectURL(url);

        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: "complete",
                progress: 100,
                durationMs: Date.now() - startTime,
              }
            : prev,
        );
      } catch (err) {
        setJob((prev) =>
          prev
            ? {
                ...prev,
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
              }
            : prev,
        );
      } finally {
        setIsRendering(false);
      }
    },
    [projectId, isRendering],
  );

  return { isRendering, job, startBrowserRender };
}
