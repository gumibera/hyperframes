export type RenderBackend = "chrome" | "native" | "auto";
export type RenderFormat = "mp4" | "webm" | "mov";

export type RenderBackendDecision =
  | {
      kind: "chrome";
      requested: RenderBackend;
      reasons: string[];
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

  // The Rust prototype exists in this branch, but the published CLI has no
  // napi-rs/binary handoff yet. Auto mode must be safe, and explicit native
  // mode should fail loudly instead of silently rendering through Chrome.
  reasons.push("native renderer bindings are not bundled yet");

  if (options.requested === "native") {
    return { kind: "unavailable", requested: "native", reasons };
  }

  return { kind: "chrome", requested: "auto", reasons };
}
