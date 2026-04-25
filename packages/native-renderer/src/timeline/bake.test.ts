import { describe, it, expect } from "vitest";
import type { BakedTimeline, BakedFrame, BakedElementState } from "./types";

describe("BakedTimeline", () => {
  it("serializes to JSON compatible with Rust serde types", () => {
    const timeline: BakedTimeline = {
      fps: 30,
      duration: 2.0,
      total_frames: 60,
      frames: [
        {
          frame_index: 0,
          time: 0.0,
          elements: {
            title: {
              opacity: 0,
              translate_x: 0,
              translate_y: 50,
              scale_x: 1,
              scale_y: 1,
              rotate_deg: 0,
              visibility: true,
            },
            card: {
              opacity: 1,
              translate_x: 0,
              translate_y: 0,
              scale_x: 1,
              scale_y: 1,
              rotate_deg: 0,
              visibility: true,
            },
          },
        },
        {
          frame_index: 30,
          time: 1.0,
          elements: {
            title: {
              opacity: 1,
              translate_x: 0,
              translate_y: 0,
              scale_x: 1,
              scale_y: 1,
              rotate_deg: 0,
              visibility: true,
            },
            card: {
              opacity: 1,
              translate_x: 0,
              translate_y: 0,
              scale_x: 1.2,
              scale_y: 1.2,
              rotate_deg: 0,
              visibility: true,
            },
          },
        },
      ],
    };

    const json = JSON.stringify(timeline);
    const parsed = JSON.parse(json) as BakedTimeline;

    expect(parsed.total_frames).toBe(60);
    expect(parsed.frames[0].elements["title"].opacity).toBe(0);
    expect(parsed.frames[1].elements["card"].scale_x).toBe(1.2);
  });

  it("uses snake_case field names matching Rust Transform2D", () => {
    const state: BakedElementState = {
      opacity: 0.5,
      translate_x: 100,
      translate_y: -30,
      scale_x: 1.5,
      scale_y: 0.8,
      rotate_deg: 45,
      visibility: true,
    };

    const json = JSON.stringify(state);
    const parsed = JSON.parse(json);

    // Verify snake_case keys are present (Rust serde expects these)
    expect(parsed).toHaveProperty("translate_x");
    expect(parsed).toHaveProperty("translate_y");
    expect(parsed).toHaveProperty("scale_x");
    expect(parsed).toHaveProperty("scale_y");
    expect(parsed).toHaveProperty("rotate_deg");
    expect(parsed).not.toHaveProperty("translateX");
    expect(parsed).not.toHaveProperty("scaleX");
    expect(parsed).not.toHaveProperty("rotateDeg");
  });

  it("preserves frame ordering and time precision", () => {
    const frames: BakedFrame[] = Array.from({ length: 5 }, (_, i) => ({
      frame_index: i,
      time: i / 30,
      elements: {
        box: {
          opacity: i / 4,
          translate_x: i * 10,
          translate_y: 0,
          scale_x: 1,
          scale_y: 1,
          rotate_deg: 0,
          visibility: true,
        },
      },
    }));

    const timeline: BakedTimeline = {
      fps: 30,
      duration: 5 / 30,
      total_frames: 5,
      frames,
    };

    const parsed = JSON.parse(JSON.stringify(timeline)) as BakedTimeline;

    expect(parsed.frames).toHaveLength(5);
    expect(parsed.frames[0].frame_index).toBe(0);
    expect(parsed.frames[4].frame_index).toBe(4);
    expect(parsed.frames[2].time).toBeCloseTo(2 / 30, 10);
    expect(parsed.frames[3].elements["box"].translate_x).toBe(30);
  });

  it("handles hidden elements with zero opacity", () => {
    const frame: BakedFrame = {
      frame_index: 0,
      time: 0,
      elements: {
        hidden_el: {
          opacity: 0,
          translate_x: 0,
          translate_y: 0,
          scale_x: 1,
          scale_y: 1,
          rotate_deg: 0,
          visibility: false,
        },
      },
    };

    const parsed = JSON.parse(JSON.stringify(frame)) as BakedFrame;
    expect(parsed.elements["hidden_el"].opacity).toBe(0);
    expect(parsed.elements["hidden_el"].visibility).toBe(false);
  });

  it("handles empty element map for frames with no ID'd elements", () => {
    const timeline: BakedTimeline = {
      fps: 24,
      duration: 1.0,
      total_frames: 24,
      frames: [{ frame_index: 0, time: 0, elements: {} }],
    };

    const parsed = JSON.parse(JSON.stringify(timeline)) as BakedTimeline;
    expect(Object.keys(parsed.frames[0].elements)).toHaveLength(0);
  });
});
