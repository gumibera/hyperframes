import { defineCommand } from "citty";
import { resolve } from "node:path";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Capture a website", "hyperframes capture https://stripe.com"],
  ["Capture to a specific directory", "hyperframes capture https://linear.app -o linear-video"],
  ["Capture with section compositions", "hyperframes capture https://notion.com --split"],
  ["JSON output for AI agents", "hyperframes capture https://example.com --json"],
];

export default defineCommand({
  meta: {
    name: "capture",
    description: "Capture a website as editable HyperFrames components",
  },
  args: {
    url: {
      type: "positional",
      description: "Website URL to capture",
      required: true,
    },
    output: {
      type: "string",
      description: "Output directory name",
      alias: "o",
    },
    "skip-assets": {
      type: "boolean",
      description: "Skip downloading assets (images, SVGs)",
      default: false,
    },
    split: {
      type: "boolean",
      description: "Split page into per-section HyperFrames compositions",
      default: false,
    },
    "skip-verify": {
      type: "boolean",
      description: "Skip section verification (when using --split)",
      default: false,
    },
    "max-screenshots": {
      type: "string",
      description: "Maximum screenshots to capture (default: 24)",
    },
    "max-sections": {
      type: "string",
      description: "Maximum sections to extract (default: 12)",
    },
    timeout: {
      type: "string",
      description: "Page load timeout in ms (default: 30000)",
    },
    json: {
      type: "boolean",
      description: "Output JSON (for AI agents / programmatic use)",
      default: false,
    },
  },
  async run({ args }) {
    const url = args.url as string;

    // Validate URL
    try {
      new URL(url);
    } catch {
      console.error(`Invalid URL: ${url}`);
      process.exit(1);
    }

    // Determine output directory — default to captures/<hostname> to keep repo root clean
    let outputName = args.output as string | undefined;
    if (!outputName) {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      outputName = `captures/${hostname.replace(/\./g, "-")}`;
    }
    const outputDir = resolve(outputName);

    const isJson = args.json as boolean;

    if (!isJson) {
      const { c } = await import("../ui/colors.js");
      console.log();
      console.log(c.dim("◆") + "  Capturing " + c.bold(url));
      console.log();
    }

    const { captureWebsite } = await import("../capture/index.js");

    try {
      const result = await captureWebsite(
        {
          url,
          outputDir,
          skipAssets: args["skip-assets"] as boolean,
          skipSplit: !(args.split as boolean),
          skipVerify: args["skip-verify"] as boolean,
          maxScreenshots: args["max-screenshots"]
            ? parseInt(args["max-screenshots"] as string)
            : undefined,
          maxSections: args["max-sections"] ? parseInt(args["max-sections"] as string) : undefined,
          timeout: args.timeout ? parseInt(args.timeout as string) : undefined,
          json: isJson,
        },
        isJson
          ? undefined
          : (stage: string, detail?: string) => {
              const stages: Record<string, string> = {
                browser: "  Launching browser...",
                navigate: "  Loading page...",
                extract: "  Extracting HTML & CSS...",
                tokens: "  Extracting design tokens...",
                screenshots: "  Capturing screenshots...",
                assets: "  Downloading assets...",
                style: "  Generating visual style...",
                done: "  Done",
              };
              const label = stages[stage] || `  ${stage}`;
              console.log(detail ? `${label} ${detail}` : label);
            },
      );

      if (isJson) {
        // Output structured JSON for Claude Code / programmatic use
        console.log(
          JSON.stringify(
            {
              ok: result.ok,
              projectDir: result.projectDir,
              url: result.url,
              title: result.title,
              screenshots: result.screenshots.length,
              assets: result.assets.length,
              detectedSections: result.tokens.sections.length,
              compositions: result.sections?.length ?? 0,
              fonts: result.tokens.fonts,
              animations: result.animationCatalog?.summary,
              warnings: result.warnings,
            },
            null,
            2,
          ),
        );
      } else {
        const { c } = await import("../ui/colors.js");
        console.log();
        console.log(c.success("◇") + `  Captured ${c.bold(result.title)} → ${c.dim(outputDir)}`);
        console.log();
        console.log(`  ${c.dim("Screenshots:")} ${result.screenshots.length}`);
        console.log(`  ${c.dim("Assets:")} ${result.assets.length}`);
        console.log(`  ${c.dim("Sections:")} ${result.tokens.sections.length}`);
        console.log(`  ${c.dim("Fonts:")} ${result.tokens.fonts.join(", ")}`);
        if (result.warnings.length > 0) {
          console.log();
          for (const w of result.warnings) {
            console.log(`  ${c.warn("⚠")} ${w}`);
          }
        }
        console.log();
      }
    } catch (err) {
      if (isJson) {
        console.log(
          JSON.stringify({
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      } else {
        console.error(`\n  ✗ Capture failed: ${err}\n`);
      }
      process.exit(1);
    }
  },
});
