import { describe, expect, it } from "vitest";
import { parseRenderBackend, resolveRenderBackend } from "./nativeBackend.js";

describe("parseRenderBackend", () => {
  it("accepts known render backends", () => {
    expect(parseRenderBackend("chrome")).toBe("chrome");
    expect(parseRenderBackend("native")).toBe("native");
    expect(parseRenderBackend("auto")).toBe("auto");
  });

  it("rejects unknown render backends", () => {
    expect(parseRenderBackend("skia")).toBeNull();
  });
});

describe("resolveRenderBackend", () => {
  it("keeps chrome when explicitly requested", () => {
    const decision = resolveRenderBackend({
      requested: "chrome",
      docker: false,
      format: "mp4",
      hdr: false,
    });

    expect(decision.kind).toBe("chrome");
    expect(decision.reasons).toEqual([]);
  });

  it("selects native in auto mode when local constraints allow it", () => {
    const decision = resolveRenderBackend({
      requested: "auto",
      docker: false,
      format: "mp4",
      hdr: false,
      nativeRuntimeAvailable: true,
    });

    expect(decision).toEqual({ kind: "native", requested: "auto", reasons: [] });
  });

  it("selects native when explicitly requested and available", () => {
    const decision = resolveRenderBackend({
      requested: "native",
      docker: false,
      format: "mp4",
      hdr: false,
      nativeRuntimeAvailable: true,
    });

    expect(decision).toEqual({ kind: "native", requested: "native", reasons: [] });
  });

  it("falls back to chrome in auto mode when native runtime is unavailable", () => {
    const decision = resolveRenderBackend({
      requested: "auto",
      docker: false,
      format: "mp4",
      hdr: false,
      nativeRuntimeAvailable: false,
    });

    expect(decision.kind).toBe("chrome");
    expect(decision.reasons).toContain(
      "native renderer binary source is not available in this installation",
    );
  });

  it("blocks explicit native backend when container or format constraints cannot be met", () => {
    const decision = resolveRenderBackend({
      requested: "native",
      docker: true,
      format: "webm",
      hdr: true,
      nativeRuntimeAvailable: false,
    });

    expect(decision.kind).toBe("unavailable");
    expect(decision.reasons).toEqual([
      "native renderer is only available for local renders",
      "native renderer currently outputs mp4 only",
      "native renderer HDR parity is not implemented yet",
      "native renderer binary source is not available in this installation",
    ]);
  });
});
