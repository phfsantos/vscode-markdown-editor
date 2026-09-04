import * as path from "node:path";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      vditor: path.resolve(__dirname, "packages/media/node_modules/vditor"),
    },
  },
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
