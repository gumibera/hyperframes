import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { ensureBrowser } from "../../cli/src/browser/manager.js";
import { extractScene } from "../src/scene/extract.js";
import { detectNativeSupport, type NativeSupportReport } from "../src/scene/support.js";
import { bakeTimeline } from "../src/timeline/bake.js";

interface ProofSummary {
  projectDir: string;
  artifactsDir: string;
  chrome: {
    outputPath: string;
    elapsedMs: number;
    frames: number;
    avgFrameMs: number;
    ffprobe: unknown;
  };
  native: {
    outputPath: string;
    extractionMs: number;
    renderElapsedMs: number;
    totalElapsedMs: number;
    renderer: unknown;
    ffprobe: unknown;
  };
  support: NativeSupportReport;
  speedup: {
    renderOnlyVsChrome: number;
    extractionPlusRenderVsChrome: number;
  };
}

function arg(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function ffprobe(path: string): unknown {
  const raw = execFileSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration,size",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf-8" },
  );
  return JSON.parse(raw);
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

async function renderChromeCdpReference({
  executablePath,
  fps,
  duration,
  projectDir,
  outputPath,
  puppeteer,
  quality,
  width,
  height,
}: {
  executablePath: string;
  fps: number;
  duration: number;
  projectDir: string;
  outputPath: string;
  puppeteer: {
    launch(options: { executablePath: string; headless: boolean; args: string[] }): Promise<{
      newPage(): Promise<{
        setViewport(viewport: { width: number; height: number }): Promise<void>;
        goto(url: string, options: { waitUntil: "networkidle0" }): Promise<unknown>;
        waitForFunction(pageFunction: string): Promise<unknown>;
        evaluate(pageFunction: string): Promise<unknown>;
        screenshot(options: { type: "jpeg"; quality: number }): Promise<Uint8Array>;
      }>;
      close(): Promise<void>;
    }>;
  };
  quality: number;
  width: number;
  height: number;
}): Promise<{ elapsedMs: number; frames: number; avgFrameMs: number }> {
  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ["--allow-file-access-from-files", "--disable-web-security"],
  });

  const frames = Math.ceil(fps * duration);
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

  const ffmpegDone = waitForProcess(ffmpeg, "ffmpeg chrome cdp reference");
  const start = performance.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.goto(pathToFileURL(join(projectDir, "index.html")).href, {
      waitUntil: "networkidle0",
    });
    await page.waitForFunction(`!!(window.__hf && typeof window.__hf.seek === "function")`);

    for (let frame = 0; frame < frames; frame++) {
      const time = frame / fps;
      await page.evaluate(`void(window.__hf.seek(${JSON.stringify(time)}))`);
      const jpeg = await page.screenshot({ type: "jpeg", quality });
      await writeFrame(ffmpeg.stdin, jpeg);
    }
  } finally {
    ffmpeg.stdin.end();
    await browser.close();
  }
  await ffmpegDone;

  const elapsedMs = Math.round(performance.now() - start);
  return {
    elapsedMs,
    frames,
    avgFrameMs: Number((elapsedMs / frames).toFixed(2)),
  };
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(new URL(import.meta.url).pathname), "../../..");
  const projectDir = resolve(
    arg("--project", join(repoRoot, "packages/native-renderer/fixtures/simple-native")),
  );
  const artifactsDir = resolve(
    arg("--artifacts", join(repoRoot, "qa-artifacts/native-renderer-proof")),
  );
  const fps = Number(arg("--fps", "30"));
  const quality = Number(arg("--quality", "80"));
  mkdirSync(artifactsDir, { recursive: true });
  const cliRequire = createRequire(join(repoRoot, "packages/cli/package.json"));
  const puppeteer = cliRequire("puppeteer-core");

  const scenePath = join(artifactsDir, "scene.json");
  const timelinePath = join(artifactsDir, "timeline.json");
  const supportPath = join(artifactsDir, "support.json");
  const nativeOutputPath = join(artifactsDir, "native.mp4");
  const chromeOutputPath = join(artifactsDir, "chrome-cdp.mp4");
  const summaryPath = join(artifactsDir, "summary.json");

  const browserInfo = await ensureBrowser();
  const browser = await puppeteer.launch({
    executablePath: browserInfo.executablePath,
    headless: true,
    args: ["--allow-file-access-from-files", "--disable-web-security"],
  });

  let width = 0;
  let height = 0;
  let duration = 0;
  let extractionMs = 0;
  let support: NativeSupportReport = { supported: false, reasons: [] };
  try {
    const page = await browser.newPage();
    const htmlPath = join(projectDir, "index.html");
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => {
      const hf = (window as unknown as { __hf?: { seek?: unknown } }).__hf;
      return Boolean(hf && typeof hf.seek === "function");
    });

    const metadata = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>("[data-composition-id]");
      const hf = (window as unknown as { __hf?: { duration?: number } }).__hf;
      return {
        width: Number(root?.dataset.width ?? root?.clientWidth ?? 0),
        height: Number(root?.dataset.height ?? root?.clientHeight ?? 0),
        duration: Number(root?.dataset.duration ?? hf?.duration ?? 1),
      };
    });
    width = metadata.width;
    height = metadata.height;
    duration = metadata.duration;

    support = await detectNativeSupport(page, width, height);
    writeFileSync(supportPath, JSON.stringify(support, null, 2));
    if (!support.supported && !hasFlag("--allow-unsupported")) {
      throw new Error(
        "Native renderer support check failed:\n" +
          support.reasons
            .map(
              (reason) =>
                `- ${reason.elementId}: ${reason.property}=${reason.value} (${reason.reason})`,
            )
            .join("\n"),
      );
    }

    const extractionStart = performance.now();
    const scene = await extractScene(page, width, height);
    const timeline = await bakeTimeline(page, fps, duration);
    extractionMs = Math.round(performance.now() - extractionStart);

    writeFileSync(scenePath, JSON.stringify(scene, null, 2));
    writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));
  } finally {
    await browser.close();
  }

  runChecked(
    "cargo",
    ["build", "--release", "--bin", "render_native"],
    join(repoRoot, "packages/native-renderer"),
  );

  const nativeStart = performance.now();
  const nativeStdout = runChecked(
    join(repoRoot, "packages/native-renderer/target/release/render_native"),
    [
      "--scene",
      scenePath,
      "--timeline",
      timelinePath,
      "--output",
      nativeOutputPath,
      "--fps",
      String(fps),
      "--duration",
      String(duration),
      "--quality",
      String(quality),
    ],
    repoRoot,
  );
  const nativeTotalElapsedMs = Math.round(performance.now() - nativeStart) + extractionMs;
  const renderer = JSON.parse(nativeStdout);

  const chrome = await renderChromeCdpReference({
    executablePath: browserInfo.executablePath,
    fps,
    duration,
    projectDir,
    outputPath: chromeOutputPath,
    puppeteer,
    quality,
    width,
    height,
  });

  const nativeRenderElapsedMs = Math.round(renderer.totalMs ?? 0);
  const summary: ProofSummary = {
    projectDir,
    artifactsDir,
    chrome: {
      outputPath: chromeOutputPath,
      elapsedMs: chrome.elapsedMs,
      frames: chrome.frames,
      avgFrameMs: chrome.avgFrameMs,
      ffprobe: ffprobe(chromeOutputPath),
    },
    native: {
      outputPath: nativeOutputPath,
      extractionMs,
      renderElapsedMs: nativeRenderElapsedMs,
      totalElapsedMs: nativeTotalElapsedMs,
      renderer,
      ffprobe: ffprobe(nativeOutputPath),
    },
    support,
    speedup: {
      renderOnlyVsChrome: Number((chrome.elapsedMs / nativeRenderElapsedMs).toFixed(2)),
      extractionPlusRenderVsChrome: Number((chrome.elapsedMs / nativeTotalElapsedMs).toFixed(2)),
    },
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  process.stdout.write(readFileSync(summaryPath, "utf-8") + "\n");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
