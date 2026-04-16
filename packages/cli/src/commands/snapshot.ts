import { defineCommand } from "citty";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, join, dirname, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveProject } from "../utils/project.js";
import { c } from "../ui/colors.js";
import type { Example } from "./_examples.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const examples: Example[] = [
  ["Capture 5 key frames from a composition", "snapshot captures/stripe"],
  ["Capture 10 evenly-spaced frames", "snapshot captures/stripe --frames 10"],
];

/**
 * Render key frames from a composition as PNG screenshots.
 * The agent can Read these to verify its output visually.
 */
async function captureSnapshots(
  projectDir: string,
  opts: { frames?: number; timeout?: number; at?: number[] },
): Promise<string[]> {
  const { bundleToSingleHtml } = await import("@hyperframes/core/compiler");
  const { ensureBrowser } = await import("../browser/manager.js");

  const numFrames = opts.frames ?? 5;

  // 1. Bundle
  let html = await bundleToSingleHtml(projectDir);

  // Inject local runtime if available
  const runtimePath = resolve(
    __dirname,
    "..",
    "..",
    "..",
    "core",
    "dist",
    "hyperframe.runtime.iife.js",
  );
  if (existsSync(runtimePath)) {
    const runtimeSource = readFileSync(runtimePath, "utf-8");
    html = html.replace(
      /<script[^>]*data-hyperframes-preview-runtime[^>]*src="[^"]*"[^>]*><\/script>/,
      () => `<script data-hyperframes-preview-runtime="1">${runtimeSource}</script>`,
    );
  }

  // 2. Start minimal file server
  const { createServer } = await import("node:http");
  const { getMimeType } = await import("@hyperframes/core/studio-api");

  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/" || url === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(html);
      return;
    }
    const filePath = resolve(projectDir, decodeURIComponent(url).replace(/^\//, ""));
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
    server.listen(0, () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : 0;
      if (!p) rejectPort(new Error("Failed to bind local HTTP server"));
      else resolvePort(p);
    });
    server.on("error", rejectPort);
  });

  const savedPaths: string[] = [];

  try {
    // 3. Launch headless Chrome
    const browser = await ensureBrowser();
    const puppeteer = await import("puppeteer-core");
    const chromeBrowser = await puppeteer.default.launch({
      headless: true,
      executablePath: browser.executablePath,
      args: [
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
      ],
    });

    try {
      const page = await chromeBrowser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      await page.goto(`http://127.0.0.1:${port}/`, {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });

      // Wait for runtime to initialize and sub-compositions to load
      const timeoutMs = opts.timeout ?? 5000;
      await page
        .waitForFunction(() => !!(window as any).__timelines || !!(window as any).__playerReady, {
          timeout: timeoutMs,
        })
        .catch(() => {});

      // Wait for sub-compositions to be mounted by the runtime
      // (they're fetched and injected asynchronously via data-composition-src)
      await page
        .waitForFunction(
          () => {
            const tls = (window as any).__timelines;
            if (!tls) return false;
            const keys = Object.keys(tls);
            // Wait until at least one sub-composition timeline is registered
            // (not counting "main" or empty registrations)
            return keys.length >= 2 || keys.some((k) => k !== "main");
          },
          { timeout: timeoutMs },
        )
        .catch(() => {});

      // Extra settle time for media, fonts, and animations to initialize
      await new Promise((r) => setTimeout(r, 1500));

      // Get composition duration
      const duration = await page.evaluate(() => {
        const win = window as any;
        const pd = win.__player?.duration;
        if (pd != null) return typeof pd === "function" ? pd() : pd;
        const root = document.querySelector("[data-composition-id][data-duration]");
        if (root) return parseFloat(root.getAttribute("data-duration") ?? "0");
        const tls = win.__timelines;
        if (tls) {
          for (const key in tls) {
            const d = tls[key]?.duration;
            if (d != null) return typeof d === "function" ? d() : d;
          }
        }
        return 0;
      });

      if (duration <= 0 && !opts.at?.length) {
        return [];
      }

      // Calculate seek positions — explicit timestamps or evenly spaced
      const positions: number[] = opts.at?.length
        ? opts.at
        : numFrames === 1
          ? [duration / 2]
          : Array.from({ length: numFrames }, (_, i) => (i / (numFrames - 1)) * duration);

      // Create output directory
      const snapshotDir = join(projectDir, "snapshots");
      mkdirSync(snapshotDir, { recursive: true });

      // Seek and capture each frame
      for (let i = 0; i < positions.length; i++) {
        const time = positions[i]!;

        await page.evaluate((t: number) => {
          const win = window as any;
          if (win.__player?.seek) {
            win.__player.seek(t);
          } else {
            const tls = win.__timelines;
            if (tls) {
              for (const key in tls) {
                if (tls[key]?.seek) {
                  tls[key].pause();
                  tls[key].seek(t);
                }
              }
            }
          }
        }, time);

        // Wait for rendering to settle after seek
        await page.evaluate(
          () =>
            new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
        );
        await new Promise((r) => setTimeout(r, 200));

        const timeLabel = opts.at?.length
          ? `${time.toFixed(1)}s`
          : `${Math.round((time / duration) * 100)}pct`;
        const filename = `frame-${String(i).padStart(2, "0")}-at-${timeLabel}.png`;
        const framePath = join(snapshotDir, filename);

        await page.screenshot({ path: framePath, type: "png" });
        savedPaths.push(`snapshots/${filename}`);
      }
    } finally {
      await chromeBrowser.close();
    }
  } finally {
    server.close();
  }

  return savedPaths;
}

export default defineCommand({
  meta: {
    name: "snapshot",
    description: "Capture key frames from a composition as PNG screenshots for visual verification",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    frames: {
      type: "string",
      description: "Number of evenly-spaced frames to capture (default: 5)",
      default: "5",
    },
    at: {
      type: "string",
      description: "Comma-separated timestamps in seconds (e.g., --at 3.0,10.5,18.0)",
    },
    timeout: {
      type: "string",
      description: "Ms to wait for runtime to initialize (default: 5000)",
      default: "5000",
    },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const frames = parseInt(args.frames as string, 10) || 5;
    const timeout = parseInt(args.timeout as string, 10) || 5000;
    const atTimestamps = args.at
      ? String(args.at)
          .split(",")
          .map((s) => parseFloat(s.trim()))
          .filter((n) => !isNaN(n))
      : undefined;

    const label = atTimestamps
      ? `${atTimestamps.length} frames at [${atTimestamps.map((t) => t.toFixed(1) + "s").join(", ")}]`
      : `${frames} frames`;
    console.log(`${c.accent("◆")}  Capturing ${label} from ${c.accent(project.name)}`);

    try {
      const paths = await captureSnapshots(project.dir, { frames, timeout, at: atTimestamps });

      if (paths.length === 0) {
        console.log(
          `\n${c.error("✗")} Could not determine composition duration — no frames captured`,
        );
        process.exit(1);
      }

      console.log(`\n${c.success("◇")}  ${paths.length} snapshots saved to snapshots/`);
      for (const p of paths) {
        console.log(`   ${p}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`\n${c.error("✗")} Snapshot failed: ${msg}`);
      process.exit(1);
    }
  },
});
