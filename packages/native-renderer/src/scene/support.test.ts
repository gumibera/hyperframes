import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import type { Browser, Page } from "puppeteer-core";
import { ensureBrowser } from "../../../cli/src/browser/manager.js";
import { detectNativeSupport } from "./support.js";

interface PuppeteerLike {
  launch(options: { executablePath: string; headless: boolean; args: string[] }): Promise<Browser>;
}

const cliRequire = createRequire(new URL("../../../cli/package.json", import.meta.url));
const puppeteer = cliRequire("puppeteer-core") as PuppeteerLike;

async function setComposition(page: Page, innerHtml: string, rootStyle = ""): Promise<void> {
  await page.setContent(`<!doctype html>
    <html>
      <body style="margin:0">
        <div data-composition-id="test" style="width:320px;height:180px;${rootStyle}">
          ${innerHtml}
        </div>
      </body>
    </html>`);
}

describe("detectNativeSupport", () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    const browserInfo = await ensureBrowser();
    browser = await puppeteer.launch({
      executablePath: browserInfo.executablePath,
      headless: true,
      args: ["--allow-file-access-from-files", "--disable-web-security"],
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  });

  it.each([
    ["svg", '<svg id="icon" width="32" height="32"><circle cx="16" cy="16" r="12" /></svg>', "svg"],
    ["canvas", '<canvas id="paint" width="32" height="32"></canvas>', "canvas"],
    ["iframe", '<iframe id="frame" srcdoc="<p>embedded</p>"></iframe>', "iframe"],
    ["unresolved video", '<video id="clip"></video>', "video"],
    [
      "resolved video",
      '<video id="clip" src="file:///tmp/hyperframes-native-test.mp4"></video>',
      "video",
    ],
    [
      "animated element without stable id",
      '<span style="display:block;transform:translateY(20px);opacity:.5">Animated</span>',
      "element-id",
    ],
    [
      "backdrop filter",
      '<div id="glass" style="width:100px;height:80px;backdrop-filter:blur(4px)"></div>',
      "backdrop-filter",
    ],
    [
      "mask image",
      '<div id="mask" style="width:100px;height:80px;-webkit-mask-image:linear-gradient(black,transparent)"></div>',
      "mask-image",
    ],
    [
      "unsupported filter",
      '<div id="drop" style="width:100px;height:80px;filter:drop-shadow(0 0 4px black)"></div>',
      "filter",
    ],
    [
      "unsupported clip path",
      '<div id="clip-path" style="width:100px;height:80px;clip-path:inset(10px)"></div>',
      "clip-path",
    ],
    ["multiple background layers", "", "background-image"],
    ["repeated background image", "", "background-image"],
    [
      "multiple shadows",
      '<div id="shadow" style="width:100px;height:80px;box-shadow:0 0 4px red, 0 0 8px blue"></div>',
      "box-shadow",
    ],
    [
      "vertical writing mode",
      '<div id="vertical" style="writing-mode:vertical-rl">Text</div>',
      "writing-mode",
    ],
  ])("rejects %s before native rendering starts", async (_name, innerHtml, property) => {
    const rootStyle = _name.includes("multiple background")
      ? `background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3KsAAAAABJRU5ErkJggg=="),linear-gradient(red,blue);background-repeat:no-repeat`
      : _name.includes("repeated background")
        ? `background-image:url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lK3KsAAAAABJRU5ErkJggg==");background-repeat:repeat`
        : "";
    await setComposition(page, innerHtml, rootStyle);

    const report = await detectNativeSupport(page, 320, 180);

    expect(report.supported).toBe(false);
    expect(report.reasons.some((reason) => reason.property === property)).toBe(true);
  });

  it("allows the supported subset used by the native fast path", async () => {
    await setComposition(
      page,
      '<div id="card" style="width:120px;height:80px;background:linear-gradient(red,blue);border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.25);filter:brightness(1.1)"></div>',
    );

    const report = await detectNativeSupport(page, 320, 180);

    expect(report).toEqual({ supported: true, reasons: [] });
  });

  it("allows animated elements when they have a stable id", async () => {
    await setComposition(
      page,
      '<span id="animated" style="display:block;transform:translateY(20px);opacity:.5">Animated</span>',
    );

    const report = await detectNativeSupport(page, 320, 180);

    expect(report).toEqual({ supported: true, reasons: [] });
  });
});
