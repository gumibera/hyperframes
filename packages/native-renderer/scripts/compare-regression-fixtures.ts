import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { createFileServer } from "../../producer/src/services/fileServer.js";
import { ensureBrowser } from "../../cli/src/browser/manager.js";
import { extractScene, type ExtractedScene, type SceneElement } from "../src/scene/extract.js";
import {
  detectNativeSupport,
  type NativeSupportReport,
  type NativeUnsupportedReason,
} from "../src/scene/support.js";
import { bakeTimeline } from "../src/timeline/bake.js";

interface FixtureMeta {
  name: string;
  description: string;
  tags: string[];
  renderConfig: {
    fps: 24 | 30 | 60;
  };
}

interface Fixture {
  id: string;
  dir: string;
  srcDir: string;
  compiledHtmlPath: string;
  meta: FixtureMeta;
}

interface BrowserInfo {
  executablePath: string;
}

interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}

interface PageLike {
  setViewport(viewport: { width: number; height: number }): Promise<void>;
  goto(
    url: string,
    options: { waitUntil: "domcontentloaded" | "load" | "networkidle0"; timeout?: number },
  ): Promise<unknown>;
  waitForFunction(pageFunction: string, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T = unknown>(pageFunction: string): Promise<T>;
  screenshot(options: { type: "jpeg"; quality: number }): Promise<Uint8Array>;
  close(): Promise<void>;
}

interface PuppeteerLike {
  launch(options: {
    executablePath: string;
    headless: boolean;
    args: string[];
  }): Promise<BrowserLike>;
}

interface FixtureResult {
  id: string;
  name: string;
  status: "native-pass" | "native-review" | "fallback-required" | "failed";
  warnings: string[];
  error?: string;
  fps: number;
  duration: number;
  sampleDuration: number;
  width: number;
  height: number;
  cdp?: {
    outputPath: string;
    elapsedMs: number;
    avgFrameMs: number;
  };
  native?: {
    outputPath: string;
    extractionMs: number;
    renderElapsedMs: number;
    totalElapsedMs: number;
    avgPaintMs: number;
  };
  auto?: {
    outputPath: string;
    elapsedMs: number;
    backend: "native" | "chrome-fallback";
  };
  support?: NativeSupportReport;
  fidelity?: {
    posterPsnrDb: PsnrDb;
    sampledPsnrDb?: PsnrDb;
    status: "excellent" | "review" | "mismatch";
  };
}

type PsnrDb = number | "inf";

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(name);
}

function runChecked(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed with ${result.status}\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

function discoverFixtures(testsDir: string, selectedIds: string[]): Fixture[] {
  const selected = new Set(selectedIds.filter(Boolean));
  const fixtures: Fixture[] = [];

  for (const id of readdirSync(testsDir).sort()) {
    if (selected.size > 0 && !selected.has(id)) continue;
    const dir = join(testsDir, id);
    if (!statSync(dir).isDirectory()) continue;

    const srcDir = join(dir, "src");
    const metaPath = join(dir, "meta.json");
    const compiledHtmlPath = join(dir, "output", "compiled.html");
    if (!existsSync(srcDir) || !existsSync(metaPath) || !existsSync(compiledHtmlPath)) continue;

    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as FixtureMeta;
    fixtures.push({ id, dir, srcDir, compiledHtmlPath, meta });
  }

  return fixtures;
}

function waitForProcess(child: ChildProcessWithoutNullStreams, command: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} failed with ${code}\n${stderr}`));
      }
    });
  });
}

function writeFrame(stdin: Writable, frame: Uint8Array): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    stdin.write(Buffer.from(frame), (error) => {
      if (error) reject(error);
      else resolvePromise();
    });
  });
}

async function renderCdpReference({
  browser,
  fps,
  duration,
  url,
  outputPath,
  quality,
  width,
  height,
}: {
  browser: BrowserLike;
  fps: number;
  duration: number;
  url: string;
  outputPath: string;
  quality: number;
  width: number;
  height: number;
}): Promise<{ elapsedMs: number; avgFrameMs: number }> {
  const frames = Math.max(1, Math.ceil(fps * duration));
  const ffmpeg = spawn("ffmpeg", [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "-framerate",
    String(fps),
    "-i",
    "-",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    outputPath,
  ]);
  const ffmpegDone = waitForProcess(ffmpeg, "ffmpeg cdp reference");

  const page = await browser.newPage();
  const start = performance.now();
  try {
    await page.setViewport({ width, height });
    await page.goto(url, { waitUntil: "load", timeout: 90_000 });
    await page.waitForFunction(`!!(window.__hf && typeof window.__hf.seek === "function")`, {
      timeout: 45_000,
    });

    for (let frame = 0; frame < frames; frame++) {
      const time = frame / fps;
      await page.evaluate(`void(window.__hf.seek(${JSON.stringify(time)}))`);
      const jpeg = await page.screenshot({ type: "jpeg", quality });
      await writeFrame(ffmpeg.stdin, jpeg);
    }
  } finally {
    ffmpeg.stdin.end();
    await page.close();
  }
  await ffmpegDone;

  const elapsedMs = Math.round(performance.now() - start);
  return { elapsedMs, avgFrameMs: Number((elapsedMs / frames).toFixed(2)) };
}

function collectSceneWarnings(scene: ExtractedScene): string[] {
  const warnings = new Set<string>();

  function visit(element: SceneElement): void {
    if (element.kind.type === "Video" && !element.kind.src) {
      warnings.add("video element has no resolved source");
    }
    if (element.style.background_gradient) warnings.add("gradient extraction is partial");
    for (const child of element.children) visit(child);
  }

  for (const element of scene.elements) visit(element);
  return Array.from(warnings);
}

function formatSupportReason(reason: NativeUnsupportedReason): string {
  return `${reason.elementId}: ${reason.property}=${reason.value} (${reason.reason})`;
}

function rewriteLocalImageSources(
  scene: ExtractedScene,
  serverUrl: string,
  compiledDir: string,
  srcDir: string,
): void {
  function mapSrc(src: string): string {
    if (!src.startsWith(serverUrl)) return src;
    const url = new URL(src);
    const relPath = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const compiledPath = join(compiledDir, relPath);
    if (existsSync(compiledPath)) return compiledPath;
    const sourcePath = join(srcDir, relPath);
    if (existsSync(sourcePath)) return sourcePath;
    return src;
  }

  function visit(element: SceneElement): void {
    if (element.kind.type === "Image" || element.kind.type === "Video") {
      element.kind.src = mapSrc(element.kind.src);
    }
    if (element.style.background_image) {
      element.style.background_image.src = mapSrc(element.style.background_image.src);
    }
    for (const child of element.children) visit(child);
  }

  for (const element of scene.elements) visit(element);
}

function extractPoster(videoPath: string, posterPath: string, time: number): void {
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      String(time),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      posterPath,
      "-y",
    ],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `failed to extract poster for ${videoPath}`);
  }
}

function computePsnrDb(referencePath: string, nativePath: string): PsnrDb | undefined {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-i", referencePath, "-i", nativePath, "-lavfi", "psnr", "-f", "null", "-"],
    { encoding: "utf-8" },
  );
  if (result.status !== 0) return undefined;

  const output = `${result.stdout}\n${result.stderr}`;
  const match = output.match(/average:([0-9.]+|inf)/);
  if (!match) return undefined;

  return match[1] === "inf" ? "inf" : Number(match[1]);
}

function psnrValue(psnr: PsnrDb | undefined): number | undefined {
  if (psnr === undefined) return undefined;
  return psnr === "inf" ? Number.POSITIVE_INFINITY : psnr;
}

function classifyPsnr(...values: (PsnrDb | undefined)[]): "excellent" | "review" | "mismatch" {
  const numericValues = values
    .map((value) => psnrValue(value))
    .filter((value): value is number => value !== undefined);
  if (numericValues.length === 0) return "mismatch";
  const floor = Math.min(...numericValues);
  return floor >= 40 ? "excellent" : floor >= 30 ? "review" : "mismatch";
}

function computeFidelity({
  referencePosterPath,
  nativePosterPath,
  referenceVideoPath,
  nativeVideoPath,
}: {
  referencePosterPath: string;
  nativePosterPath: string;
  referenceVideoPath: string;
  nativeVideoPath: string;
}): FixtureResult["fidelity"] | undefined {
  const posterPsnrDb = computePsnrDb(referencePosterPath, nativePosterPath);
  if (posterPsnrDb === undefined) return undefined;
  const sampledPsnrDb = computePsnrDb(referenceVideoPath, nativeVideoPath);

  return {
    posterPsnrDb,
    sampledPsnrDb,
    status: classifyPsnr(posterPsnrDb, sampledPsnrDb),
  };
}

function formatPsnr(psnr: PsnrDb | undefined): string {
  if (psnr === undefined) return "n/a";
  return psnr === "inf" ? "inf" : `${psnr.toFixed(2)} dB`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function artifactRel(root: string, path: string): string {
  return relative(root, path).split("/").map(encodeURIComponent).join("/");
}

function writeReport(results: FixtureResult[], artifactsDir: string, maxDuration: number): void {
  const counts = {
    nativePass: results.filter((r) => r.status === "native-pass").length,
    nativeReview: results.filter((r) => r.status === "native-review").length,
    fallbackRequired: results.filter((r) => r.status === "fallback-required").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  const totals = results.reduce(
    (acc, result) => {
      acc.cdp += result.cdp?.elapsedMs ?? 0;
      acc.auto += result.auto?.elapsedMs ?? 0;
      if (result.native) {
        const frames = Math.max(1, Math.ceil(result.fps * result.sampleDuration));
        acc.native += result.native.totalElapsedMs;
        acc.nativeExtraction += result.native.extractionMs;
        acc.nativeRender += result.native.renderElapsedMs;
        acc.nativePaint += result.native.avgPaintMs * frames;
      }
      return acc;
    },
    { cdp: 0, auto: 0, native: 0, nativeExtraction: 0, nativeRender: 0, nativePaint: 0 },
  );
  const totalAutoSpeedup =
    totals.cdp > 0 && totals.auto > 0 ? Number((totals.cdp / totals.auto).toFixed(2)) : null;
  const totalNativeSpeedup =
    totals.cdp > 0 && totals.native > 0 ? Number((totals.cdp / totals.native).toFixed(2)) : null;

  const rows = results
    .map((result) => {
      const fixtureDir = join(artifactsDir, result.id);
      const nativeSpeedup =
        result.cdp && result.native
          ? Number((result.cdp.elapsedMs / result.native.totalElapsedMs).toFixed(2))
          : null;
      const autoSpeedup =
        result.cdp && result.auto
          ? Number((result.cdp.elapsedMs / result.auto.elapsedMs).toFixed(2))
          : null;
      const posterPsnr = formatPsnr(result.fidelity?.posterPsnrDb);
      const sampledPsnr = formatPsnr(result.fidelity?.sampledPsnrDb);
      const cdpPoster = existsSync(join(fixtureDir, "cdp.jpg"))
        ? `<img src="${artifactRel(artifactsDir, join(fixtureDir, "cdp.jpg"))}" alt="CDP poster for ${escapeHtml(result.id)}" />`
        : `<div class="placeholder">CDP unavailable</div>`;
      const autoPoster = existsSync(join(fixtureDir, "auto.jpg"))
        ? `<img src="${artifactRel(artifactsDir, join(fixtureDir, "auto.jpg"))}" alt="Auto backend poster for ${escapeHtml(result.id)}" />`
        : `<div class="placeholder">Auto output unavailable</div>`;
      const cdpVideo = result.cdp
        ? `<video src="${artifactRel(artifactsDir, result.cdp.outputPath)}" controls muted loop playsinline></video>`
        : "";
      const autoVideo = result.auto
        ? `<video src="${artifactRel(artifactsDir, result.auto.outputPath)}" controls muted loop playsinline></video>`
        : "";
      const warnings = result.warnings.length
        ? `<ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : `<p>No native coverage warnings recorded.</p>`;
      const supportReasons = result.support?.reasons.length
        ? `<ul>${result.support.reasons
            .map((reason) => `<li>${escapeHtml(formatSupportReason(reason))}</li>`)
            .join("")}</ul>`
        : `<p>Support detector found no fallback-required features.</p>`;
      const error = result.error ? `<pre>${escapeHtml(result.error)}</pre>` : "";

      return `<article class="case ${result.status}">
        <header>
          <div>
            <h2>${escapeHtml(result.id)}</h2>
            <p>${escapeHtml(result.name)}</p>
          </div>
          <span class="status">${result.status}</span>
        </header>
        <div class="meta">
          <span>${result.width}x${result.height}</span>
          <span>${result.fps}fps</span>
          <span>${result.sampleDuration.toFixed(2)}s sampled</span>
          ${result.cdp ? `<span>CDP ${result.cdp.elapsedMs}ms</span>` : ""}
          ${
            result.native
              ? `<span>Native ${result.native.totalElapsedMs}ms</span>
          <span>Extract ${result.native.extractionMs}ms</span>
          <span>Render ${result.native.renderElapsedMs}ms</span>
          <span>Avg paint ${result.native.avgPaintMs.toFixed(2)}ms</span>`
              : ""
          }
          ${result.auto ? `<span>Auto ${result.auto.elapsedMs}ms (${result.auto.backend})</span>` : ""}
          ${nativeSpeedup ? `<span>${nativeSpeedup}x native speed</span>` : ""}
          ${autoSpeedup ? `<span>${autoSpeedup}x auto speed</span>` : ""}
          <span>Poster PSNR ${posterPsnr}</span>
          <span>Sampled PSNR ${sampledPsnr}</span>
          ${result.fidelity ? `<span>Fidelity ${result.fidelity.status}</span>` : ""}
        </div>
        <div class="comparison">
          <section>
            <h3>CDP</h3>
            ${cdpPoster}
            ${cdpVideo}
          </section>
          <section>
            <h3>Auto Output</h3>
            ${autoPoster}
            ${autoVideo}
          </section>
        </div>
        <details>
          <summary>Notes</summary>
          <p>Poster PSNR compares one sampled CDP frame against auto output. Sampled PSNR compares the full clipped video segment rendered by both backends. Inspect the side-by-side videos for final visual signoff.</p>
          ${supportReasons}
          ${warnings}
          ${error}
        </details>
      </article>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Native Renderer Regression Comparison</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111315;
        color: #f4f1ea;
      }
      body { margin: 0; }
      main { width: min(1440px, calc(100vw - 48px)); margin: 0 auto; padding: 28px 0 48px; }
      h1 { margin: 0 0 12px; font-size: 30px; }
      .dek { color: #cfc7b8; margin: 0 0 18px; line-height: 1.5; max-width: 920px; }
      .summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 24px; }
      .summary span, .meta span {
        border: 1px solid #3e4544;
        background: #1d2322;
        border-radius: 6px;
        padding: 8px 10px;
        color: #dfd8cc;
        font-weight: 700;
      }
      .case { border-top: 1px solid #3e4544; padding: 24px 0; }
      .case header { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
      h2 { margin: 0; font-size: 22px; }
      h2 + p { margin: 4px 0 0; color: #cfc7b8; }
      .status { border-radius: 999px; padding: 7px 10px; text-transform: uppercase; font-weight: 900; font-size: 12px; }
      .native-pass .status { background: #123d2c; color: #7bf2bc; }
      .native-review .status { background: #453814; color: #ffd86b; }
      .fallback-required .status { background: #233149; color: #9ec3ff; }
      .failed .status { background: #4a1d25; color: #ff9aaa; }
      .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; font-size: 13px; }
      .comparison { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
      section { min-width: 0; }
      h3 { margin: 0 0 8px; color: #f4f1ea; }
      img, video {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: contain;
        background: #000;
        border: 1px solid #3e4544;
      }
      video { margin-top: 8px; }
      .placeholder {
        display: grid;
        place-items: center;
        aspect-ratio: 16 / 9;
        background: #1c2020;
        border: 1px solid #3e4544;
        color: #cfc7b8;
      }
      details { margin-top: 12px; color: #dfd8cc; }
      pre {
        overflow: auto;
        white-space: pre-wrap;
        background: #1c2020;
        border: 1px solid #3e4544;
        border-radius: 6px;
        padding: 12px;
      }
      @media (max-width: 860px) {
        .comparison { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Native Renderer Regression Comparison</h1>
      <p class="dek">This report renders each fixture through the existing Chrome CDP reference path and the production auto backend. Auto uses Rust/Skia native rendering only for supported fixtures and falls back to Chrome when the support detector finds browser features the native compositor cannot prove faithful yet.</p>
      <div class="summary">
        <span>${results.length} fixtures</span>
        <span>${counts.nativePass} native-pass</span>
        <span>${counts.nativeReview} native-review</span>
        <span>${counts.fallbackRequired} fallback-required</span>
        <span>${counts.failed} failed</span>
        ${totalAutoSpeedup ? `<span>${totalAutoSpeedup}x aggregate auto speed</span>` : ""}
        ${totalNativeSpeedup ? `<span>${totalNativeSpeedup}x native-only speed</span>` : ""}
        <span>CDP ${totals.cdp}ms</span>
        <span>Auto ${totals.auto}ms</span>
        <span>Native ${totals.native}ms</span>
        <span>Native extraction ${totals.nativeExtraction}ms</span>
        <span>Native render ${totals.nativeRender}ms</span>
        <span>Native paint ${totals.nativePaint.toFixed(2)}ms</span>
        <span>first ${maxDuration}s sampled per fixture</span>
      </div>
      ${rows}
    </main>
  </body>
</html>`;

  writeFileSync(join(artifactsDir, "index.html"), html, "utf-8");
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
  const artifactsDir = resolve(
    arg("--artifacts", join(repoRoot, `qa-artifacts/native-regression-comparison-${Date.now()}`)),
  );
  const maxDuration = Number(arg("--max-duration", "1"));
  const quality = Number(arg("--quality", "80"));
  const selectedFixtures = arg("--fixtures", "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const limit = Number(arg("--limit", "0"));
  const keep = flag("--keep");

  if (!keep && existsSync(artifactsDir)) rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(artifactsDir, { recursive: true });

  const fixtures = discoverFixtures(
    join(repoRoot, "packages/producer/tests"),
    selectedFixtures,
  ).slice(0, limit > 0 ? limit : undefined);
  if (fixtures.length === 0) {
    throw new Error("No fixtures found");
  }

  runChecked(
    "cargo",
    ["build", "--release", "--bin", "render_native"],
    join(repoRoot, "packages/native-renderer"),
  );

  const browserInfo = (await ensureBrowser()) as BrowserInfo;
  const cliRequire = createRequire(join(repoRoot, "packages/cli/package.json"));
  const puppeteer = cliRequire("puppeteer-core") as PuppeteerLike;
  const browser = await puppeteer.launch({
    executablePath: browserInfo.executablePath,
    headless: true,
    args: ["--allow-file-access-from-files", "--disable-web-security"],
  });

  const results: FixtureResult[] = [];

  try {
    for (const fixture of fixtures) {
      const fixtureDir = join(artifactsDir, fixture.id);
      const compiledDir = join(fixtureDir, "compiled");
      mkdirSync(compiledDir, { recursive: true });
      writeFileSync(
        join(compiledDir, "index.html"),
        readFileSync(fixture.compiledHtmlPath, "utf-8"),
      );

      const server = await createFileServer({ projectDir: fixture.srcDir, compiledDir });
      const url = `${server.url}/index.html`;
      const result: FixtureResult = {
        id: fixture.id,
        name: fixture.meta.name,
        status: "failed",
        warnings: [],
        fps: fixture.meta.renderConfig.fps,
        duration: 0,
        sampleDuration: 0,
        width: 0,
        height: 0,
      };

      try {
        const page = await browser.newPage();
        let scene: ExtractedScene | null = null;
        let nativeExtractionMs = 0;
        try {
          await page.goto(url, { waitUntil: "load", timeout: 90_000 });
          await page.waitForFunction(`!!(window.__hf && typeof window.__hf.seek === "function")`, {
            timeout: 45_000,
          });
          const metadata = await page.evaluate<{
            width: number;
            height: number;
            duration: number;
          }>(`(() => {
            const root = document.querySelector("[data-composition-id]");
            const hfDuration = Number(window.__hf?.duration ?? 0);
            return {
              width: Number(root?.getAttribute("data-width") ?? root?.clientWidth ?? 0),
              height: Number(root?.getAttribute("data-height") ?? root?.clientHeight ?? 0),
              duration: hfDuration > 0 ? hfDuration : Number(root?.getAttribute("data-duration") ?? 1),
            };
          })()`);

          result.width = metadata.width || 1920;
          result.height = metadata.height || 1080;
          result.duration = metadata.duration || 1;
          result.sampleDuration = Math.min(result.duration, maxDuration);

          result.support = await detectNativeSupport(page, result.width, result.height);
          writeFileSync(join(fixtureDir, "support.json"), JSON.stringify(result.support, null, 2));
          if (result.support.supported) {
            scene = await extractScene(page, result.width, result.height);
            rewriteLocalImageSources(scene, server.url, compiledDir, fixture.srcDir);
            result.warnings.push(...collectSceneWarnings(scene));

            const extractionStart = performance.now();
            const timeline = await bakeTimeline(page, result.fps, result.sampleDuration);
            nativeExtractionMs = Math.round(performance.now() - extractionStart);

            writeFileSync(join(fixtureDir, "scene.json"), JSON.stringify(scene, null, 2));
            writeFileSync(join(fixtureDir, "timeline.json"), JSON.stringify(timeline, null, 2));
          }
        } finally {
          await page.close();
        }

        const cdpOutputPath = join(fixtureDir, "cdp.mp4");
        const cdp = await renderCdpReference({
          browser,
          fps: result.fps,
          duration: result.sampleDuration,
          url,
          outputPath: cdpOutputPath,
          quality,
          width: result.width,
          height: result.height,
        });
        result.cdp = { outputPath: cdpOutputPath, ...cdp };

        const autoOutputPath = join(fixtureDir, "auto.mp4");
        if (!result.support?.supported) {
          copyFileSync(cdpOutputPath, autoOutputPath);
          result.auto = {
            outputPath: autoOutputPath,
            elapsedMs: cdp.elapsedMs,
            backend: "chrome-fallback",
          };
          result.status = "fallback-required";
        } else {
          if (!scene) throw new Error("native support was true, but no scene was extracted");
          const nativeStart = performance.now();
          const nativeStdout = runChecked(
            join(repoRoot, "packages/native-renderer/target/release/render_native"),
            [
              "--scene",
              join(fixtureDir, "scene.json"),
              "--timeline",
              join(fixtureDir, "timeline.json"),
              "--output",
              autoOutputPath,
              "--fps",
              String(result.fps),
              "--duration",
              String(result.sampleDuration),
              "--quality",
              String(quality),
            ],
            repoRoot,
          );
          const renderer = JSON.parse(nativeStdout) as { totalMs: number; avgPaintMs: number };
          const totalElapsedMs = Math.round(performance.now() - nativeStart) + nativeExtractionMs;
          result.native = {
            outputPath: autoOutputPath,
            extractionMs: nativeExtractionMs,
            renderElapsedMs: Math.round(renderer.totalMs ?? 0),
            totalElapsedMs,
            avgPaintMs: Number(renderer.avgPaintMs ?? 0),
          };
          result.auto = {
            outputPath: autoOutputPath,
            elapsedMs: totalElapsedMs,
            backend: "native",
          };
        }

        const posterTime = Math.min(0.5, Math.max(0, result.sampleDuration - 1 / result.fps));
        const cdpPosterPath = join(fixtureDir, "cdp.jpg");
        const autoPosterPath = join(fixtureDir, "auto.jpg");
        extractPoster(cdpOutputPath, cdpPosterPath, posterTime);
        extractPoster(autoOutputPath, autoPosterPath, posterTime);
        result.fidelity = computeFidelity({
          referencePosterPath: cdpPosterPath,
          nativePosterPath: autoPosterPath,
          referenceVideoPath: cdpOutputPath,
          nativeVideoPath: autoOutputPath,
        });

        if (result.status !== "fallback-required") {
          result.status =
            result.warnings.length > 0 || result.fidelity?.status !== "excellent"
              ? "native-review"
              : "native-pass";
        }
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        result.status = "failed";
      } finally {
        server.close();
      }

      results.push(result);
      writeFileSync(join(artifactsDir, "results.json"), JSON.stringify(results, null, 2));
      console.log(
        JSON.stringify({
          id: result.id,
          status: result.status,
          cdpMs: result.cdp?.elapsedMs ?? null,
          nativeMs: result.native?.totalElapsedMs ?? null,
          autoMs: result.auto?.elapsedMs ?? null,
          autoBackend: result.auto?.backend ?? null,
          posterPsnrDb: result.fidelity?.posterPsnrDb ?? null,
          sampledPsnrDb: result.fidelity?.sampledPsnrDb ?? null,
          fidelityStatus: result.fidelity?.status ?? null,
          warnings: result.warnings,
          supportReasons: result.support?.reasons.map(formatSupportReason) ?? [],
          error: result.error ?? null,
        }),
      );
    }
  } finally {
    await browser.close();
  }

  writeReport(results, artifactsDir, maxDuration);
  console.log(
    JSON.stringify({
      report: join(artifactsDir, "index.html"),
      results: join(artifactsDir, "results.json"),
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
