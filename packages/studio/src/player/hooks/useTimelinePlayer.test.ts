import { describe, expect, it } from "vitest";
import { Window } from "happy-dom";
import {
  buildStandaloneRootTimelineElement,
  findTimelineDomNodeForClip,
  getTimelineElementSelector,
  type ClipManifestClip,
  mergeTimelineElementsPreservingDowngrades,
  resolveStandaloneRootCompositionSrc,
} from "./useTimelinePlayer";

function createDocument(markup: string): Document {
  const window = new Window();
  window.document.body.innerHTML = markup;
  return window.document;
}

function createClip(overrides: Partial<ClipManifestClip>): ClipManifestClip {
  return {
    id: null,
    label: "",
    start: 0,
    duration: 4,
    track: 0,
    kind: "element",
    tagName: "div",
    compositionId: null,
    parentCompositionId: null,
    compositionSrc: null,
    assetUrl: null,
    ...overrides,
  };
}

describe("buildStandaloneRootTimelineElement", () => {
  it("includes selector and source metadata for standalone composition fallback clips", () => {
    expect(
      buildStandaloneRootTimelineElement({
        compositionId: "hero",
        tagName: "DIV",
        rootDuration: 8,
        iframeSrc: "http://127.0.0.1:4173/api/projects/demo/preview/comp/scenes/hero.html?_t=123",
        selector: '[data-composition-id="hero"]',
      }),
    ).toEqual({
      id: "hero",
      key: 'scenes/hero.html:[data-composition-id="hero"]:0',
      tag: "div",
      start: 0,
      duration: 8,
      track: 0,
      compositionSrc: "scenes/hero.html",
      selector: '[data-composition-id="hero"]',
      selectorIndex: undefined,
      sourceFile: "scenes/hero.html",
    });
  });

  it("returns null for invalid fallback durations", () => {
    expect(
      buildStandaloneRootTimelineElement({
        compositionId: "hero",
        tagName: "div",
        rootDuration: 0,
        iframeSrc: "http://localhost/preview/comp/hero.html",
      }),
    ).toBe(null);
    expect(
      buildStandaloneRootTimelineElement({
        compositionId: "hero",
        tagName: "div",
        rootDuration: Number.NaN,
        iframeSrc: "http://localhost/preview/comp/hero.html",
      }),
    ).toBe(null);
  });
});

describe("resolveStandaloneRootCompositionSrc", () => {
  it("extracts the composition path from a preview iframe url", () => {
    expect(
      resolveStandaloneRootCompositionSrc(
        "http://127.0.0.1:4173/api/projects/demo/preview/comp/scenes/hero.html?_t=123",
      ),
    ).toBe("scenes/hero.html");
  });

  it("returns undefined for non-composition preview urls", () => {
    expect(
      resolveStandaloneRootCompositionSrc("http://127.0.0.1:4173/api/projects/demo/preview"),
    ).toBe(undefined);
  });
});

describe("findTimelineDomNodeForClip", () => {
  it("matches anonymous manifest clips back to repeated DOM nodes in timeline order", () => {
    const doc = createDocument(`
      <div data-composition-id="main" data-start="0" data-duration="8">
        <section id="identity-card" class="clip identity-card" data-start="0" data-duration="4" data-track-index="0"></section>
        <div class="clip duplicate-card first" data-start="0" data-duration="4" data-track-index="1"></div>
        <div class="clip duplicate-card second" data-start="0" data-duration="4" data-track-index="2"></div>
      </div>
    `);
    const used = new Set<Element>();

    const first = findTimelineDomNodeForClip(
      doc,
      createClip({ id: "__node__index_2", track: 1 }),
      1,
      used,
    ) as HTMLElement;
    used.add(first);
    const second = findTimelineDomNodeForClip(
      doc,
      createClip({ id: "__node__index_3", track: 2 }),
      2,
      used,
    ) as HTMLElement;

    expect(first.className).toBe("clip duplicate-card first");
    expect(second.className).toBe("clip duplicate-card second");
    expect(getTimelineElementSelector(first)).toBe(".duplicate-card");
    expect(getTimelineElementSelector(second)).toBe(".duplicate-card");
  });
});

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
