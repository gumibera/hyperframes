// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { SnapdomFrameSource } from "./snapdom.js";

// Mock @zumer/snapdom since jsdom can't run real SVG foreignObject rendering
vi.mock("@zumer/snapdom", () => ({
  snapdom: {
    toCanvas: vi.fn().mockResolvedValue(
      (() => {
        const c = document.createElement("canvas");
        c.width = 1920;
        c.height = 1080;
        return c;
      })(),
    ),
  },
}));

describe("SnapdomFrameSource", () => {
  it("has name 'snapdom'", () => {
    const source = new SnapdomFrameSource();
    expect(source.name).toBe("snapdom");
  });

  it("duration is 0 before init", () => {
    const source = new SnapdomFrameSource();
    expect(source.duration).toBe(0);
  });

  it("media is empty before init", () => {
    const source = new SnapdomFrameSource();
    expect(source.media).toEqual([]);
  });
});
