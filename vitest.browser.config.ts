import * as path from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { build } from "esbuild";

const clipboardSource = path.resolve(__dirname, "packages/media/src/clipboard-selection.js");

export default defineConfig({
  resolve: {
    alias: {
      vditor: path.resolve(__dirname, "packages/media/node_modules/vditor"),
    },
  },
  // Match the production bundler for this shared CommonJS source. Vite serves
  // relative source imports directly, so dependency optimization cannot convert it.
  plugins: [{
    name: "browser-clipboard-commonjs",
    enforce: "pre",
    async transform(_code, id) {
      if (id !== clipboardSource) return;
      const result = await build({
        stdin: { resolveDir: __dirname, contents: `export { getMarkdownClipboardText } from ${JSON.stringify(clipboardSource)};` },
        bundle: true,
        format: "esm",
        write: false,
        sourcemap: "inline",
      });
      return { code: result.outputFiles[0].text, map: null };
    },
  }],
  test: {
    include: ["test/**/*.browser.test.ts"],
    testTimeout: 20_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});
