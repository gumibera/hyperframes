// Polyfill esbuild's __name helper. tsx injects __name() wrappers via
// keepNames but ESM hoisting means inline polyfills run too late.
// This CJS file is loaded via --require before any ESM evaluation.
if (typeof globalThis.__name !== "function") {
  globalThis.__name = function(fn) { return fn; };
}
