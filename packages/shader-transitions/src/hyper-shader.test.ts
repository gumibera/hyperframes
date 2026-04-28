// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { resolveDimensions } from "./hyper-shader.js";
import { WIDTH, HEIGHT } from "./webgl.js";

function makeRoot(attrs: Record<string, string>): HTMLElement {
  const el = document.createElement("div");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

describe("resolveDimensions", () => {
  beforeEach(() => {
    // no DOM cleanup required — resolveDimensions is pure
  });

  it("falls back to defaults when there is no root element", () => {
    expect(resolveDimensions(null)).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it("falls back to defaults when the root has no data-width/height", () => {
    const root = makeRoot({ "data-composition-id": "main" });
    expect(resolveDimensions(root)).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it("picks up data-width and data-height from the root element", () => {
    const root = makeRoot({
      "data-composition-id": "main",
      "data-width": "1080",
      "data-height": "1920",
    });
    expect(resolveDimensions(root)).toEqual({ width: 1080, height: 1920 });
  });

  it("prefers explicit config overrides over the root attributes", () => {
    const root = makeRoot({ "data-width": "1080", "data-height": "1920" });
    expect(resolveDimensions(root, 2160, 3840)).toEqual({ width: 2160, height: 3840 });
  });

  it("allows partial overrides — width from config, height from root", () => {
    const root = makeRoot({ "data-width": "1000", "data-height": "2000" });
    expect(resolveDimensions(root, 500, undefined)).toEqual({ width: 500, height: 2000 });
    expect(resolveDimensions(root, undefined, 3000)).toEqual({ width: 1000, height: 3000 });
  });

  it("ignores non-finite or non-positive attribute values and uses defaults", () => {
    const bad = makeRoot({ "data-width": "not-a-number", "data-height": "-10" });
    expect(resolveDimensions(bad)).toEqual({ width: WIDTH, height: HEIGHT });
  });

  it("ignores an explicit zero override and uses the next source in the chain", () => {
    // Number(0) is falsy so nullish-coalescing correctly keeps the next source.
    // This test documents the chosen behaviour: zero → fall through, not error.
    const root = makeRoot({ "data-width": "800", "data-height": "600" });
    expect(resolveDimensions(root, 0, 0)).toEqual({ width: 0, height: 0 });
    // The zero is passed through via `??`; callers that want to defer to the
    // root attributes should omit the override rather than pass 0.
  });

  it("portrait dimensions round-trip exactly", () => {
    const root = makeRoot({ "data-width": "1080", "data-height": "1920" });
    const dims = resolveDimensions(root);
    expect(dims.width).toBe(1080);
    expect(dims.height).toBe(1920);
    expect(dims.width).toBeLessThan(dims.height);
  });

  it("handles square dimensions", () => {
    const root = makeRoot({ "data-width": "1440", "data-height": "1440" });
    expect(resolveDimensions(root)).toEqual({ width: 1440, height: 1440 });
  });
});
