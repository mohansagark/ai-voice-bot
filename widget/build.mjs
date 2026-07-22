import { build } from "esbuild";
await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2020",
  outfile: "dist/ai-voice-bot.min.js",
});
console.log("built dist/ai-voice-bot.min.js");
