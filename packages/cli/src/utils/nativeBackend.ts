export type RenderBackend = "chrome" | "native" | "auto";
export type RenderFormat = "mp4" | "webm" | "mov";

export type RenderBackendDecision =
  | {
      kind: "chrome";
      requested: RenderBackend;
      reasons: string[];
    }
  | {
      kind: "native";
      requested: "native" | "auto";
      reasons: [];
    }
  | {
      kind: "unavailable";
      requested: "native";
      reasons: string[];
    };

const VALID_RENDER_BACKENDS = new Set<RenderBackend>(["chrome", "native", "auto"]);

export function parseRenderBackend(raw: string): RenderBackend | null {
  return VALID_RENDER_BACKENDS.has(raw as RenderBackend) ? (raw as RenderBackend) : null;
}

export function resolveRenderBackend(options: {
  requested: RenderBackend;
  docker: boolean;
  format: RenderFormat;
  hdr: boolean;
  nativeRuntimeAvailable?: boolean;
}): RenderBackendDecision {
  if (options.requested === "chrome") {
    return { kind: "chrome", requested: "chrome", reasons: [] };
  }

  const reasons: string[] = [];
  if (options.docker) {
    reasons.push("native renderer is only available for local renders");
  }
  if (options.format !== "mp4") {
    reasons.push("native renderer currently outputs mp4 only");
  }
  if (options.hdr) {
    reasons.push("native renderer HDR parity is not implemented yet");
  }
  if (options.nativeRuntimeAvailable === false) {
    reasons.push("native renderer binary source is not available in this installation");
  }

  if (options.requested === "native") {
    return reasons.length === 0
      ? { kind: "native", requested: "native", reasons: [] }
      : { kind: "unavailable", requested: "native", reasons };
  }

  return reasons.length === 0
    ? { kind: "native", requested: "auto", reasons: [] }
    : { kind: "chrome", requested: "auto", reasons };
}
