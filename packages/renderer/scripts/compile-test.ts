/**
 * Compile a single test composition via the producer's htmlCompiler.
 * Usage: npx tsx --esm packages/renderer/scripts/compile-test.ts <test-name>
 */
import { writeFileSync, mkdirSync, cpSync } from "node:fs";
import { resolve, join } from "node:path";
import { compileForRender } from "../../producer/src/services/htmlCompiler.js";
import { getVerifiedHyperframeRuntimeSource } from "../../producer/src/services/hyperframeRuntimeLoader.js";

const testName = process.argv[2];
if (!testName) {
  console.error("Usage: npx tsx packages/renderer/scripts/compile-test.ts <test-name>");
  process.exit(1);
}

const srcDir = resolve(`packages/producer/tests/${testName}/src`);
const htmlPath = join(srcDir, "index.html");
const outputDir = resolve(`renders/parity-regression/${testName}`);
mkdirSync(outputDir, { recursive: true });

console.log(`Compiling ${testName}...`);

// Copy all source assets to output dir so the composition can resolve relative paths
cpSync(srcDir, outputDir, { recursive: true, force: true });

const result = await compileForRender(srcDir, htmlPath, outputDir);

// Inject the HyperFrames runtime IIFE and the __player → __hf bridge.
// The producer's file server normally serves these separately,
// but for client-side rendering we need them inline.
const runtimeSource = getVerifiedHyperframeRuntimeSource();

// Bridge script: maps window.__player (set by runtime) → window.__hf (engine protocol)
const bridgeScript = `(function() {
  function getDeclaredDuration() {
    var root = document.querySelector('[data-composition-id]');
    if (!root) return 0;
    var d = Number(root.getAttribute('data-duration'));
    return Number.isFinite(d) && d > 0 ? d : 0;
  }
  function bridge() {
    var p = window.__player;
    if (!p || typeof p.renderSeek !== "function" || typeof p.getDuration !== "function") {
      return false;
    }
    window.__hf = {
      get duration() {
        var d = p.getDuration();
        return d > 0 ? d : getDeclaredDuration();
      },
      seek: function(t) { p.renderSeek(t); },
    };
    return true;
  }
  if (bridge()) return;
  var iv = setInterval(function() {
    if (bridge()) clearInterval(iv);
  }, 50);
})();`;

const runtimeTag = `<script data-hyperframes-render-runtime>${runtimeSource}</script>`;
const bridgeTag = `<script data-hyperframes-bridge>${bridgeScript}</script>`;
const htmlWithRuntime = result.html.replace("</body>", `${runtimeTag}\n${bridgeTag}\n</body>`);

writeFileSync(join(outputDir, "compiled.html"), htmlWithRuntime);
writeFileSync(
  join(outputDir, "compile-meta.json"),
  JSON.stringify(
    {
      width: result.width,
      height: result.height,
      staticDuration: result.staticDuration,
      videoCount: result.videos.length,
      audioCount: result.audios.length,
      htmlLength: result.html.length,
    },
    null,
    2,
  ),
);

console.log(
  JSON.stringify({
    ok: true,
    width: result.width,
    height: result.height,
    staticDuration: result.staticDuration,
    videos: result.videos.length,
    audios: result.audios.length,
    htmlLength: result.html.length,
  }),
);
