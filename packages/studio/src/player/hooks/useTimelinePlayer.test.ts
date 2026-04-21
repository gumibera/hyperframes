import { describe, expect, it } from "vitest";
import { mergeTimelineElementsPreservingDowngrades } from "./useTimelinePlayer";

describe("mergeTimelineElementsPreservingDowngrades", () => {
  it("preserves missing current elements when a shorter manifest arrives", () => {
    expect(
      mergeTimelineElementsPreservingDowngrades(
        [
          { id: "hero", tag: "div", start: 0, duration: 4, track: 0 },
          { id: "cta", tag: "div", start: 4, duration: 2, track: 1 },
        ],
        [{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
        8,
        8,
      ),
    ).toEqual([
      { id: "hero", tag: "div", start: 0, duration: 4, track: 0 },
      { id: "cta", tag: "div", start: 4, duration: 2, track: 1 },
    ]);
  });

  it("accepts longer-duration or same-size updates as authoritative", () => {
    expect(
      mergeTimelineElementsPreservingDowngrades(
        [{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
        [{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }],
        4,
        6,
      ),
    ).toEqual([{ id: "hero", tag: "div", start: 0, duration: 4, track: 0 }]);
  });
});
