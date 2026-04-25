import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
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
  goto(url: string, options: { waitUntil: "networkidle0"; timeout?: number }): Promise<unknown>;
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
  status: "pass" | "partial" | "failed";
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
}

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
    await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
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
    if (element.kind.type === "Video") warnings.add("video elements are extracted but not painted");
    if (element.kind.type === "Image" && /^https?:\/\//.test(element.kind.src)) {
      warnings.add("remote image URLs are not decoded by native renderer");
    }
    if (element.style.background_gradient) warnings.add("gradient extraction is partial");
    for (const child of element.children) visit(child);
  }

  for (const element of scene.elements) visit(element);
  return Array.from(warnings);
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
    if (element.kind.type === "Image") {
      element.kind.src = mapSrc(element.kind.src);
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
    pass: results.filter((r) => r.status === "pass").length,
    partial: results.filter((r) => r.status === "partial").length,
    failed: results.filter((r) => r.status === "failed").length,
  };
  const rows = results
    .map((result) => {
      const fixtureDir = join(artifactsDir, result.id);
      const cdpPoster = existsSync(join(fixtureDir, "cdp.jpg"))
        ? `<img src="${artifactRel(artifactsDir, join(fixtureDir, "cdp.jpg"))}" alt="CDP poster for ${escapeHtml(result.id)}" />`
        : `<div class="placeholder">CDP unavailable</div>`;
      const nativePoster = existsSync(join(fixtureDir, "native.jpg"))
        ? `<img src="${artifactRel(artifactsDir, join(fixtureDir, "native.jpg"))}" alt="Native poster for ${escapeHtml(result.id)}" />`
        : `<div class="placeholder">Native unavailable</div>`;
      const cdpVideo = result.cdp
        ? `<video src="${artifactRel(artifactsDir, result.cdp.outputPath)}" controls muted loop playsinline></video>`
        : "";
      const nativeVideo = result.native
        ? `<video src="${artifactRel(artifactsDir, result.native.outputPath)}" controls muted loop playsinline></video>`
        : "";
      const warnings = result.warnings.length
        ? `<ul>${result.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
        : `<p>No native coverage warnings recorded.</p>`;
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
          ${result.native ? `<span>Native ${result.native.totalElapsedMs}ms</span>` : ""}
        </div>
        <div class="comparison">
          <section>
            <h3>CDP</h3>
            ${cdpPoster}
            ${cdpVideo}
          </section>
          <section>
            <h3>Native</h3>
            ${nativePoster}
            ${nativeVideo}
          </section>
        </div>
        <details>
          <summary>Notes</summary>
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
        background: #0a0f1d;
        color: #f7f9fc;
      }
      body { margin: 0; }
      main { width: min(1440px, calc(100vw - 48px)); margin: 0 auto; padding: 28px 0 48px; }
      h1 { margin: 0 0 12px; font-size: 30px; }
      .summary { display: flex; gap: 10px; flex-wrap: wrap; margin: 0 0 24px; }
      .summary span, .meta span {
        border: 1px solid #33415c;
        background: #162136;
        border-radius: 6px;
        padding: 8px 10px;
        color: #cbd6eb;
        font-weight: 700;
      }
      .case { border-top: 1px solid #33415c; padding: 24px 0; }
      .case header { display: flex; justify-content: space-between; gap: 16px; align-items: start; }
      h2 { margin: 0; font-size: 22px; }
      h2 + p { margin: 4px 0 0; color: #aebbd1; }
      .status { border-radius: 999px; padding: 7px 10px; text-transform: uppercase; font-weight: 900; font-size: 12px; }
      .pass .status { background: #123d2c; color: #7bf2bc; }
      .partial .status { background: #453814; color: #ffd86b; }
      .failed .status { background: #4a1d25; color: #ff9aaa; }
      .meta { display: flex; gap: 8px; flex-wrap: wrap; margin: 14px 0; font-size: 13px; }
      .comparison { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 16px; }
      section { min-width: 0; }
      h3 { margin: 0 0 8px; color: #d9e4f8; }
      img, video {
        display: block;
        width: 100%;
        aspect-ratio: 16 / 9;
        object-fit: contain;
        background: #000;
        border: 1px solid #33415c;
      }
      video { margin-top: 8px; }
      .placeholder {
        display: grid;
        place-items: center;
        aspect-ratio: 16 / 9;
        background: #151b2a;
        border: 1px solid #33415c;
        color: #aebbd1;
      }
      details { margin-top: 12px; color: #cbd6eb; }
      pre {
        overflow: auto;
        white-space: pre-wrap;
        background: #151b2a;
        border: 1px solid #33415c;
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
      <div class="summary">
        <span>${results.length} fixtures</span>
        <span>${counts.pass} pass</span>
        <span>${counts.partial} partial</span>
        <span>${counts.failed} failed</span>
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
        let scene: ExtractedScene;
        let nativeExtractionMs = 0;
        try {
          await page.goto(url, { waitUntil: "networkidle0", timeout: 45_000 });
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

          scene = await extractScene(page, result.width, result.height);
          rewriteLocalImageSources(scene, server.url, compiledDir, fixture.srcDir);
          result.warnings.push(...collectSceneWarnings(scene));

          const extractionStart = performance.now();
          const timeline = await bakeTimeline(page, result.fps, result.sampleDuration);
          nativeExtractionMs = Math.round(performance.now() - extractionStart);

          writeFileSync(join(fixtureDir, "scene.json"), JSON.stringify(scene, null, 2));
          writeFileSync(join(fixtureDir, "timeline.json"), JSON.stringify(timeline, null, 2));
        } finally {
          await page.close();
        }

        const nativeOutputPath = join(fixtureDir, "native.mp4");
        const nativeStart = performance.now();
        const nativeStdout = runChecked(
          join(repoRoot, "packages/native-renderer/target/release/render_native"),
          [
            "--scene",
            join(fixtureDir, "scene.json"),
            "--timeline",
            join(fixtureDir, "timeline.json"),
            "--output",
            nativeOutputPath,
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
        result.native = {
          outputPath: nativeOutputPath,
          extractionMs: nativeExtractionMs,
          renderElapsedMs: Math.round(renderer.totalMs ?? 0),
          totalElapsedMs: Math.round(performance.now() - nativeStart) + nativeExtractionMs,
          avgPaintMs: Number(renderer.avgPaintMs ?? 0),
        };

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

        const posterTime = Math.min(0.5, Math.max(0, result.sampleDuration - 1 / result.fps));
        extractPoster(cdpOutputPath, join(fixtureDir, "cdp.jpg"), posterTime);
        extractPoster(nativeOutputPath, join(fixtureDir, "native.jpg"), posterTime);

        result.status = result.warnings.length > 0 ? "partial" : "pass";
      } catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        result.status = result.cdp || result.native ? "partial" : "failed";
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
          warnings: result.warnings,
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
