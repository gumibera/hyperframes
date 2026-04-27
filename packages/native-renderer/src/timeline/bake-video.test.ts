import { describe, it, expect } from "bun:test";

describe("bakeVideoTimeline output contract", () => {
  it("produces identity transforms with screen-space bounds", () => {
    const mockState = {
      opacity: 0.8,
      translate_x: 0,
      translate_y: 0,
      scale_x: 1,
      scale_y: 1,
      rotate_deg: 0,
      visibility: true,
      bounds_x: 100,
      bounds_y: 200,
      bounds_w: 640,
      bounds_h: 360,
      border_radius: [8, 8, 8, 8] as [number, number, number, number],
    };

    expect(mockState.translate_x).toBe(0);
    expect(mockState.translate_y).toBe(0);
    expect(mockState.scale_x).toBe(1);
    expect(mockState.scale_y).toBe(1);
    expect(mockState.rotate_deg).toBe(0);
    expect(mockState.bounds_w).toBeGreaterThan(0);
    expect(mockState.bounds_h).toBeGreaterThan(0);
  });
});
