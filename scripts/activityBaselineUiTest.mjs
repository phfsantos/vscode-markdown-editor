/** Narrow real-window activity checks for the minimum supported VS Code 1.95.0.
 * Set MARKDOWN_UI_CODE, MARKDOWN_UI_DRIVER and MARKDOWN_UI_TOOLS to local tools.
 * --skip-build reuses current dist/out assets, copied into a fresh installation.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.argv.includes('--clean-child')) {
  if (!process.argv.includes('--skip-build')) {
    for (const args of [['build:extension'], ['--cwd', 'packages/media', 'build']]) {
      const result = spawnSync('yarn', args, { cwd: root, stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status ?? 1);
    }
  }
  const sandbox = mkdtempSync('/private/tmp/md-baseline195-ui-');
  for (const name of ['home', 'workspace', 'extensions', 'chromedriver-mac-x64']) mkdirSync(path.join(sandbox, name));
  writeFileSync(path.join(sandbox, 'workspace/tasks.md'), '- [ ] Same\n- [ ] Same\n');
  const provider = path.join(sandbox, 'extensions/phfsantos.markdown-editor-0.5.11');
  mkdirSync(provider);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  delete manifest.scripts;
  writeFileSync(path.join(provider, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const name of ['dist', 'out/media', 'out/widgets/index.js', 'out/sidebar', 'media/logo.png', 'media/sidebar-icon.svg']) {
    const source = path.join(root, name);
    if (existsSync(source)) cpSync(source, path.join(provider, name), { recursive: true });
  }
  // A diagnostic old bundle can prove this harness fails before editor opening.
  if (process.env.MARKDOWN_BASELINE195_BUNDLE) cpSync(process.env.MARKDOWN_BASELINE195_BUNDLE, path.join(provider, 'dist/extension.js'));
  for (const fixture of ['agent-activity-consumer', 'agent-activity-baseline-ui']) cpSync(path.join(root, 'test/fixtures', fixture), path.join(sandbox, 'extensions/markdown-studio-tests.' + fixture + '-0.0.1'), { recursive: true });
  if (!process.env.MARKDOWN_UI_DRIVER) throw new Error('Set MARKDOWN_UI_DRIVER to a Chromium128 ChromeDriver executable');
  cpSync(process.env.MARKDOWN_UI_DRIVER, path.join(sandbox, 'chromedriver-mac-x64/chromedriver'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_')));
  Object.assign(env, { HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home'), TEST_RESOURCES: sandbox, EXTENSIONS_FOLDER: path.join(sandbox, 'extensions'), MARKDOWN_BASELINE195_WORKSPACE: path.join(sandbox, 'workspace'), MARKDOWN_BASELINE195_PROVIDER: provider });
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--clean-child'], { cwd: root, env, stdio: 'inherit', timeout: 240000 });
  console.log(JSON.stringify({ sandbox, status: result.status, signal: result.signal, error: result.error?.message }));
  process.exit(result.status ?? 1);
}
const toolsRoot = process.env.MARKDOWN_UI_TOOLS ?? path.join(root, 'test/ui');
const require = createRequire(path.join(toolsRoot, 'package.json'));
const { VSBrowser, ReleaseQuality } = require('vscode-extension-tester');
const Mocha = require('mocha');
const code = process.env.MARKDOWN_UI_CODE;
if (!code) throw new Error('Set MARKDOWN_UI_CODE to a complete official VS Code1.95.0 executable');
const appDir = path.resolve(path.dirname(code), '../Resources/app');
const metadata = JSON.parse(readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const product = JSON.parse(readFileSync(path.join(appDir, 'product.json'), 'utf8'));
if (metadata.version !== '1.95.0') throw new Error(`Expected1.95.0, got ${metadata.version}`);
const artifacts = path.join(root, 'docs/testing/artifacts/agent-activity-matrix');
mkdirSync(artifacts, { recursive: true });
process.env.MARKDOWN_BASELINE195_ARTIFACTS = artifacts;
const browser = new VSBrowser(metadata.version, ReleaseQuality.Stable, {
  'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false,
  'workbench.editor.decorations.badges': true, 'workbench.editor.decorations.colors': true,
  'explorer.decorations.badges': true, 'git.decorations.enabled': false,
  'markdown-editor.ai.enable': false, 'markdown-editor.ai.enableInlineSuggestions': false,
  'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false,
});
const mocha = new Mocha({ timeout: 45000, grep: process.argv.includes('--grep') ? process.argv[process.argv.indexOf('--grep') + 1] : undefined });
mocha.addFile(path.join(root, 'test/ui/activityBaseline195.test.cjs'));
let failures;
try {
  await browser.start(code, [process.env.MARKDOWN_BASELINE195_WORKSPACE]);
  await browser.waitForWorkbench();
  await mocha.loadFilesAsync();
  failures = await new Promise(resolve => mocha.run(resolve));
  process.exitCode = failures ? 1 : 0;
} finally {
  const prefix = process.env.MARKDOWN_BASELINE195_PREFIX ?? 'isolation195-ui';
  const result = { version: metadata.version, commit: product.commit, failures, timestamp: new Date().toISOString(), workspace: process.env.MARKDOWN_BASELINE195_WORKSPACE,
    providerBundleSha256: createHash('sha256').update(readFileSync(path.join(process.env.MARKDOWN_BASELINE195_PROVIDER, 'dist/extension.js'))).digest('hex'),
    states: globalThis.baseline195States ?? [] };
  writeFileSync(path.join(artifacts, prefix + '-result.json'), JSON.stringify(result, null, 2));
  await browser.quit();
}
