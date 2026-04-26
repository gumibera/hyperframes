// Polyfill esbuild's keepNames helper — tsx injects __name() wrappers but
// some transitive imports execute before the global is defined.
if (typeof (globalThis as Record<string, unknown>).__name !== "function") {
  (globalThis as Record<string, unknown>).__name = <T>(fn: T, _name: string): T => fn;
}

import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";

import type { Browser, Page } from "puppeteer-core";
import { extractScene } from "../../../native-renderer/src/scene/extract.js";
import {
  detectNativeSupport,
  type NativeUnsupportedReason,
  type NativeSupportReport,
} from "../../../native-renderer/src/scene/support.js";
import { bakeTimeline } from "../../../native-renderer/src/timeline/bake.js";

export type { NativeUnsupportedReason, NativeSupportReport };

export interface NativeRenderOptions {
  fps: 24 | 30 | 60;
  quality: "draft" | "standard" | "high";
  browserPath?: string;
  quiet: boolean;
}

export type NativeRenderResult =
  | {
      kind: "rendered";
      outputPath: string;
      elapsedMs: number;
      width: number;
      height: number;
      duration: number;
      totalFrames: number;
      renderer: NativeRendererStats;
      support: NativeSupportReport;
    }
  | {
      kind: "unsupported";
      support: NativeSupportReport;
    }
  | {
      kind: "unavailable";
      reasons: string[];
    };

export interface NativeRendererStats {
  frames: number;
  totalMs: number;
  avgPaintMs: number;
  outputPath: string;
}

interface CompositionMetadata {
  width: number;
  height: number;
  duration: number;
}

interface ServedProject {
  url: string;
  close: () => Promise<void>;
}

const NATIVE_UNAVAILABLE_REASON =
  "native renderer binary source is not available in this installation";

export function findNativeRendererRoot(): string | null {
  const thisDir = dirname(new URL(import.meta.url).pathname);
  const candidates = [
    resolve(thisDir, "../../../native-renderer"),
    resolve(thisDir, "../../native-renderer"),
    resolve(process.cwd(), "packages/native-renderer"),
  ];

  for (const candidate of candidates) {
    if (
      existsSync(join(candidate, "Cargo.toml")) &&
      existsSync(join(candidate, "src/bin/render_native.rs"))
    ) {
      return candidate;
    }
  }

  return null;
}

export function isNativeRendererAvailable(): boolean {
  return findNativeRendererRoot() !== null;
}

export function formatUnsupportedNativeFeatures(features: NativeUnsupportedReason[]): string {
  return features
    .map(
      (feature) =>
        `- ${feature.elementId}: ${feature.property}=${feature.value} (${feature.reason})`,
    )
    .join("\n");
}

export async function renderNativeProject(
  projectDir: string,
  outputPath: string,
  options: NativeRenderOptions,
): Promise<NativeRenderResult> {
  const nativeRoot = findNativeRendererRoot();
  if (!nativeRoot) {
    return { kind: "unavailable", reasons: [NATIVE_UNAVAILABLE_REASON] };
  }

  const elapsedStart = Date.now();
  const artifactsDir = mkdtempSync(join(tmpdir(), "hyperframes-native-"));
  const scenePath = join(artifactsDir, "scene.json");
  const timelinePath = join(artifactsDir, "timeline.json");

  let browser: Browser | undefined;
  let server: ServedProject | undefined;
  try {
    if (!options.quiet) {
      console.log("  Native renderer: extracting scene graph...");
    }

    server = await serveBundledProject(projectDir);
    const puppeteer = await import("puppeteer-core");
    browser = await puppeteer.default.launch({
      headless: true,
      executablePath: options.browserPath,
      args: ["--allow-file-access-from-files", "--disable-web-security", "--no-sandbox"],
    });

    const page = await browser.newPage();
    await page.goto(server.url, { waitUntil: "networkidle0", timeout: 30_000 });
    await waitForComposition(page);

    const metadata = await readCompositionMetadata(page);
    await page.setViewport({ width: metadata.width, height: metadata.height });
    await settlePage(page);

    const support = await detectNativeSupport(page, metadata.width, metadata.height);
    if (!support.supported) {
      return { kind: "unsupported", support };
    }

    const scene = await extractScene(page, metadata.width, metadata.height);
    const timeline = await bakeTimeline(page, options.fps, metadata.duration);
    writeFileSync(scenePath, JSON.stringify(scene, null, 2));
    writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));

    if (!options.quiet) {
      console.log("  Native renderer: building Rust binary...");
    }
    buildNativeBinary(nativeRoot, options.quiet);

    if (!options.quiet) {
      console.log("  Native renderer: painting and encoding...");
    }
    const raw = await runNativeBinary(nativeRoot, {
      scenePath,
      timelinePath,
      outputPath,
      fps: options.fps,
      duration: metadata.duration,
      quality: qualityNumber(options.quality),
    });
    const renderer = parseRendererStats(raw);

    return {
      kind: "rendered",
      outputPath,
      elapsedMs: Date.now() - elapsedStart,
      width: metadata.width,
      height: metadata.height,
      duration: metadata.duration,
      totalFrames: renderer.frames,
      renderer,
      support,
    };
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    rmSync(artifactsDir, { recursive: true, force: true });
  }
}

async function serveBundledProject(projectDir: string): Promise<ServedProject> {
  const html = await bundleProjectHtml(projectDir);
  const { getMimeType } = await import("@hyperframes/core/studio-api");

  const server = createServer((req, res) => {
    const rawUrl = req.url ?? "/";
    const parsed = new URL(rawUrl, "http://127.0.0.1");
    const pathname = decodeURIComponent(parsed.pathname);
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }

    const filePath = resolve(projectDir, pathname.replace(/^\//, ""));
    const rel = relative(projectDir, filePath);
    if (rel.startsWith("..") || isAbsolute(rel)) {
      res.writeHead(403);
      res.end();
      return;
    }

    if (existsSync(filePath)) {
      res.writeHead(200, { "Content-Type": getMimeType(filePath) });
      res.end(readFileSync(filePath));
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const port = await new Promise<number>((resolvePort, rejectPort) => {
    server.on("error", rejectPort);
    server.listen(0, () => {
      const address = server.address();
      const portNumber = typeof address === "object" && address ? address.port : 0;
      if (portNumber > 0) resolvePort(portNumber);
      else rejectPort(new Error("Failed to bind native renderer preview server"));
    });
  });

  return {
    url: `http://127.0.0.1:${port}/`,
    close: () =>
      new Promise<void>((resolveClose) => {
        server.close(() => resolveClose());
      }),
  };
}

async function bundleProjectHtml(projectDir: string): Promise<string> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  let html = await bundleToSingleHtml(projectDir);

  const runtimePath = findRuntimePath();
  if (runtimePath) {
    const runtimeSource = readFileSync(runtimePath, "utf-8");
    html = html.replace(
      /<script[^>]*data-hyperframes-preview-runtime[^>]*src="[^"]*"[^>]*><\/script>/,
      () => `<script data-hyperframes-preview-runtime="1">${runtimeSource}</script>`,
    );
  }

  return html;
}

function findRuntimePath(): string | null {
  const candidates = [
    resolve(
      dirname(new URL(import.meta.url).pathname),
      "../../../core/dist/hyperframe.runtime.iife.js",
    ),
    resolve(
      dirname(new URL(import.meta.url).pathname),
      "../../core/dist/hyperframe.runtime.iife.js",
    ),
    resolve(dirname(dirname(new URL(import.meta.url).pathname)), "hyperframe.runtime.iife.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function waitForComposition(page: Page): Promise<void> {
  await page.waitForSelector("[data-composition-id]", { timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const root = document.querySelector<HTMLElement>("[data-composition-id]");
      return Boolean(root && root.clientWidth > 0 && root.clientHeight > 0);
    },
    { timeout: 10_000 },
  );
}

async function settlePage(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
      if (!fonts?.ready) return Promise.resolve();
      return Promise.race([
        fonts.ready.then(() => undefined),
        new Promise<void>((resolveFonts) => setTimeout(resolveFonts, 500)),
      ]);
    })
    .catch(() => undefined);

  await page.evaluate(
    () =>
      new Promise<void>((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())),
      ),
  );
}

async function readCompositionMetadata(page: Page): Promise<CompositionMetadata> {
  return page.evaluate(() => {
    function positiveNumber(raw: string | number | undefined | null): number | null {
      const value = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    }

    const root = document.querySelector<HTMLElement>("[data-composition-id]");
    const hf = (window as unknown as { __hf?: { duration?: number } }).__hf;

    return {
      width: positiveNumber(root?.dataset.width) ?? positiveNumber(root?.clientWidth) ?? 1920,
      height: positiveNumber(root?.dataset.height) ?? positiveNumber(root?.clientHeight) ?? 1080,
      duration: positiveNumber(root?.dataset.duration) ?? positiveNumber(hf?.duration) ?? 1,
    };
  });
}

function buildNativeBinary(nativeRoot: string, quiet: boolean): void {
  execFileSync("cargo", ["build", "--release", "--bin", "render_native"], {
    cwd: nativeRoot,
    stdio: quiet ? "pipe" : "inherit",
    timeout: 600_000,
  });
}

function runNativeBinary(
  nativeRoot: string,
  options: {
    scenePath: string;
    timelinePath: string;
    outputPath: string;
    fps: number;
    duration: number;
    quality: number;
  },
): Promise<string> {
  const binaryPath = join(nativeRoot, "target/release/render_native");
  statSync(binaryPath);

  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(
      binaryPath,
      [
        "--scene",
        options.scenePath,
        "--timeline",
        options.timelinePath,
        "--output",
        options.outputPath,
        "--fps",
        String(options.fps),
        "--duration",
        String(options.duration),
        "--quality",
        String(options.quality),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectRun);
    child.on("close", (code) => {
      if (code === 0) {
        resolveRun(stdout.trim());
        return;
      }

      rejectRun(
        new Error(`native renderer exited with ${code ?? "unknown"}\n${stdout}\n${stderr}`),
      );
    });
  });
}

function parseRendererStats(raw: string): NativeRendererStats {
  const parsed: unknown = JSON.parse(raw);
  if (!isNativeRendererStats(parsed)) {
    throw new Error(`native renderer emitted invalid stats: ${raw}`);
  }
  return parsed;
}

function isNativeRendererStats(value: unknown): value is NativeRendererStats {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.frames === "number" &&
    typeof record.totalMs === "number" &&
    typeof record.avgPaintMs === "number" &&
    typeof record.outputPath === "string"
  );
}

function qualityNumber(quality: "draft" | "standard" | "high"): number {
  if (quality === "draft") return 65;
  if (quality === "high") return 92;
  return 80;
}
