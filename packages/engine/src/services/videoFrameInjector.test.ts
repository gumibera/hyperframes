import { afterEach, describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import type { Page } from "puppeteer-core";
import { queryElementStacking } from "./videoFrameInjector.js";

class IdentityDomMatrix {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(_transform?: string) {}

  translate(): IdentityDomMatrix {
    return this;
  }

  multiply(): IdentityDomMatrix {
    return this;
  }

  toString(): string {
    return "matrix(1, 0, 0, 1, 0, 0)";
  }
}

const originalGlobals = {
  window: globalThis.window,
  document: globalThis.document,
  HTMLElement: globalThis.HTMLElement,
  DOMMatrix: globalThis.DOMMatrix,
};

function setLayoutBox(
  el: Element,
  {
    width,
    height,
    x = 0,
    y = 0,
    left = x,
    top = y,
  }: { width: number; height: number; x?: number; y?: number; left?: number; top?: number },
): void {
  Object.defineProperties(el, {
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
    offsetLeft: { configurable: true, value: left },
    offsetTop: { configurable: true, value: top },
    getBoundingClientRect: {
      configurable: true,
      value: () => ({
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
      }),
    },
  });
}

function installDom(html: string): { document: Document; window: Window & typeof globalThis } {
  const { document, window } = parseHTML(html);
  globalThis.window = window as typeof globalThis.window;
  globalThis.document = document as typeof globalThis.document;
  globalThis.HTMLElement = window.HTMLElement as typeof globalThis.HTMLElement;
  globalThis.DOMMatrix = IdentityDomMatrix as typeof globalThis.DOMMatrix;
  return { document, window: window as Window & typeof globalThis };
}

function makePage(): Page {
  return {
    evaluate: async <TArg, TResult>(
      pageFunction: (arg: TArg) => TResult,
      arg: TArg,
    ): Promise<TResult> => pageFunction(arg),
  } as Page;
}

afterEach(() => {
  globalThis.window = originalGlobals.window;
  globalThis.document = originalGlobals.document;
  globalThis.HTMLElement = originalGlobals.HTMLElement;
  globalThis.DOMMatrix = originalGlobals.DOMMatrix;
});

describe("queryElementStacking", () => {
  it("inherits border radius from ancestors that clip via overflow-x only", async () => {
    const { document, window } = installDom(`
      <div id="clipper">
        <video id="hdr-video" data-start="0"></video>
      </div>
    `);

    const clipper = document.getElementById("clipper");
    const video = document.getElementById("hdr-video");
    expect(clipper).not.toBeNull();
    expect(video).not.toBeNull();
    if (!clipper || !video) {
      throw new Error("Expected DOM nodes to exist");
    }

    setLayoutBox(clipper, { width: 240, height: 180 });
    setLayoutBox(video, { width: 120, height: 90 });

    window.getComputedStyle = ((el: Element) => {
      if (el === clipper) {
        return {
          position: "static",
          zIndex: "auto",
          opacity: "1",
          overflow: "visible",
          overflowX: "hidden",
          overflowY: "visible",
          borderTopLeftRadius: "24px",
          borderTopRightRadius: "24px",
          borderBottomRightRadius: "24px",
          borderBottomLeftRadius: "24px",
          transform: "none",
          transformOrigin: "0 0",
          visibility: "visible",
          display: "block",
          objectFit: "",
          objectPosition: "",
        };
      }
      return {
        position: "static",
        zIndex: "auto",
        opacity: "1",
        overflow: "visible",
        overflowX: "visible",
        overflowY: "visible",
        borderTopLeftRadius: "0px",
        borderTopRightRadius: "0px",
        borderBottomRightRadius: "0px",
        borderBottomLeftRadius: "0px",
        transform: "none",
        transformOrigin: "0 0",
        visibility: "visible",
        display: "block",
        objectFit: "",
        objectPosition: "",
      };
    }) as typeof window.getComputedStyle;

    const [stack] = await queryElementStacking(makePage(), new Set(["hdr-video"]));
    expect(stack).toBeDefined();
    expect(stack?.borderRadius).toEqual([24, 24, 24, 24]);
  });
});
