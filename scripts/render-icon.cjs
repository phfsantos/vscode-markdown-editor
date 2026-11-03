#!/usr/bin/env node
// Rasterizes media/marketplace-icon.svg into the 512x512 listing icon media/logo.png.
// Usage: yarn icon:render (needs Playwright Chromium: `npx playwright install chromium`).
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SIZE = 512;
const rootDir = path.resolve(__dirname, '..');
const source = path.join(rootDir, 'media', 'marketplace-icon.svg');
const target = path.join(rootDir, 'media', 'logo.png');

async function main() {
  const svg = fs.readFileSync(source, 'utf8');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
    await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: target, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
  } finally {
    await browser.close();
  }
  console.log(`Rendered ${path.relative(rootDir, target)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
