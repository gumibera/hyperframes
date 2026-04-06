import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/primitives.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "remotion", "@remotion/player"],
  target: "es2022",
});
