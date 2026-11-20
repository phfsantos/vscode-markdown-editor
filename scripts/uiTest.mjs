/** Isolated ExTester runner. Install optional tools with npm --prefix test/ui install. */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = process.env.MARKDOWN_UI_TOOLS ?? path.join(root, 'test/ui');
const require = createRequire(path.join(toolsRoot, 'package.json'));
// MARKDOWN_UI_STORAGE: a separate tester storage (extensions, settings, results) per VS Code version.
const storage = process.env.MARKDOWN_UI_STORAGE ?? path.join(root, '.extest');
const code = process.env.MARKDOWN_UI_CODE ?? path.join(storage, 'Visual Studio Code.app/Contents/MacOS/Code');
const driver = process.env.MARKDOWN_UI_DRIVER ?? path.join(storage, 'chromedriver-mac-x64/chromedriver');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_')));
const sandbox = mkdtempSync(path.join(os.tmpdir(), 'md-ui-'));
const workspace = path.join(sandbox, 'workspace');
mkdirSync(workspace); mkdirSync(path.join(sandbox, 'home'));
for (const [name, content] of Object.entries({ 'tasks.md': '- [ ] **Ship**\n', 'other.md': 'Other document.\n', 'unrelated.txt': 'Unrelated.\n' })) writeFileSync(path.join(workspace, name), content);
// Diff fixtures: diff.md is committed then modified (Git working-tree diff); compare/{left,right}/diff.md are
// same-named files in different folders (file<->file compare); pending.md gets a fake chat-editing baseline.
const diffFixture = createRequire(import.meta.url)('../test/ui/diffFixture.cjs');
writeFileSync(path.join(workspace, 'diff.md'), diffFixture.original);
writeFileSync(path.join(workspace, 'second.md'), '# Second file\n\nUnchanged.\n');
writeFileSync(path.join(workspace, 'pending.md'), diffFixture.pendingModified);
for (const [side, text] of [['left', diffFixture.original], ['right', diffFixture.modified]]) {
  mkdirSync(path.join(workspace, 'compare', side), { recursive: true });
  writeFileSync(path.join(workspace, 'compare', side, 'diff.md'), text);
}
const git = (...args) => {
  const result = spawnSync('git', ['-c', 'user.name=UI Test', '-c', 'user.email=ui@test.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: workspace, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
};
git('init', '-q'); git('add', 'diff.md', 'second.md'); git('commit', '-qm', 'fixture');
writeFileSync(path.join(workspace, 'diff.md'), diffFixture.modified);
mkdirSync(storage, { recursive: true });
process.env.TEST_RESOURCES = storage;
process.env.EXTENSIONS_FOLDER = path.join(storage, 'extensions');
process.env.MARKDOWN_UI_WORKSPACE = workspace;
process.env.MARKDOWN_UI_TOOLS = toolsRoot;
process.env.MARKDOWN_UI_DIFF_FIXTURE = path.join(root, 'test/ui/diffFixture.cjs');
// Re-exec with a clean VS Code environment before loading Electron/WebDriver tools.
if (!process.argv.includes('--clean-child')) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--clean-child'], {
    cwd: root, stdio: 'inherit', env: { ...env, HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home') },
  });
  process.exit(result.status ?? 1);
}
const { ExTester, VSBrowser, ReleaseQuality } = require('vscode-extension-tester');
const Mocha = require('mocha');
const extensions = process.env.EXTENSIONS_FOLDER;
mkdirSync(extensions, { recursive: true });
// MARKDOWN_UI_TEST_VSIX: test this already-built artifact (the release gate) instead of building one.
const suppliedVsix = process.env.MARKDOWN_UI_TEST_VSIX;
if (suppliedVsix && !process.argv.includes('--skip-setup')) {
  if (!existsSync(suppliedVsix)) throw new Error(`MARKDOWN_UI_TEST_VSIX does not exist: ${suppliedVsix}`);
  rmSync(path.join(storage, 'vsix'), { recursive: true, force: true });
  rmSync(path.join(extensions, 'phfsantos.markdown-editor-0.5.11'), { recursive: true, force: true });
  const unzip = spawnSync('unzip', ['-oq', suppliedVsix, '-d', path.join(storage, 'vsix')]);
  if (unzip.status !== 0) throw new Error('VSIX extraction failed');
  cpSync(path.join(storage, 'vsix/extension'), path.join(extensions, 'phfsantos.markdown-editor-0.5.11'), { recursive: true });
} else if (!process.argv.includes('--skip-setup')) {
  // Fresh production assets; never exercise an old installed build after source edits.
  for (const args of [['build:extension'], ['--cwd','packages/media','build']]) {
    const result = spawnSync('yarn', args, { cwd: root, stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  const vsce = require('@vscode/vsce');
  const vsix = path.join(storage, 'markdown-studio.vsix');
  const staging = path.join(sandbox, 'package'); mkdirSync(staging);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  // The prepublish build already ran above; stage only files that can ship at runtime.
  delete manifest.scripts;
  // Experiment hook (diff-view ADR): stage the VSIX with another customEditors priority, e.g.
  // MARKDOWN_UI_EDITOR_PRIORITY='{"textEditor":"default","diffEditor":"default"}'. Never touches package.json.
  if (process.env.MARKDOWN_UI_EDITOR_PRIORITY) {
    const value = process.env.MARKDOWN_UI_EDITOR_PRIORITY;
    manifest.contributes.customEditors[0].priority = value.startsWith('{') ? JSON.parse(value) : value;
  }
  writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const name of [
    'dist', 'out/media', 'out/widgets/index.js', 'out/sidebar',
    'media/logo.png', 'media/sidebar-icon.svg', 'media/graph-view.js', 'media/graph-view.css',
    'README.md', 'LICENSE',
  ]) {
    const source = path.join(root, name);
    if (existsSync(source)) cpSync(source, path.join(staging, name), { recursive: true });
  }
  writeFileSync(path.join(staging, '.vscodeignore'), '**/*.map\n');
  await vsce.createVSIX({ cwd: staging, packagePath: vsix, dependencies: false, skipLicense: false });
  // VSIX extraction avoids invoking a running user's Code CLI.
  rmSync(path.join(storage, 'vsix'), { recursive: true, force: true });
  rmSync(path.join(extensions, 'phfsantos.markdown-editor-0.5.11'), { recursive: true, force: true });
  const unzip = spawnSync('unzip', ['-oq', vsix, '-d', path.join(storage, 'vsix')]);
  if (unzip.status !== 0) throw new Error('VSIX extraction failed');
  cpSync(path.join(storage, 'vsix/extension'), path.join(extensions, 'phfsantos.markdown-editor-0.5.11'), { recursive: true });

}
rmSync(path.join(extensions, 'markdown-studio-tests.agent-context-consumer-0.0.1'), { recursive: true, force: true });
rmSync(path.join(extensions, 'markdown-studio-tests.context-ui-driver-0.0.1'), { recursive: true, force: true });
cpSync(path.join(root, 'test/fixtures/agent-context-consumer'), path.join(extensions, 'markdown-studio-tests.agent-context-consumer-0.0.1'), { recursive: true });
cpSync(path.join(root, 'test/ui/driver'), path.join(extensions, 'markdown-studio-tests.context-ui-driver-0.0.1'), { recursive: true });
if ((!existsSync(code) || !existsSync(driver)) && !process.argv.includes('--skip-setup')) {
  const installer = new ExTester(storage, ReleaseQuality.Stable, extensions);
  if (!existsSync(code)) await installer.downloadCode('max');
  if (!existsSync(driver)) await installer.downloadChromeDriver('max');
}
if (!existsSync(code) || !existsSync(driver)) throw new Error('Set MARKDOWN_UI_CODE and MARKDOWN_UI_DRIVER to matching binaries, or run without --skip-setup to download them.');
const driverFolder = path.join(storage, 'chromedriver-mac-x64'); mkdirSync(driverFolder, { recursive: true });
if (path.resolve(driver) !== path.join(driverFolder, 'chromedriver')) cpSync(driver, path.join(driverFolder, 'chromedriver'));
const appMetadata = JSON.parse(readFileSync(path.resolve(path.dirname(code), '../Resources/app/package.json'), 'utf8'));
const browser = new VSBrowser(appMetadata.version, ReleaseQuality.Stable, {
  'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false,
  'workbench.editor.decorations.badges': true, 'workbench.editor.tabSizing': 'fit',
  'markdown-editor.ai.enable': false, 'markdown-editor.ai.enableInlineSuggestions': false,
  'window.restoreWindows': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
});
const mocha = new Mocha({ timeout: 60000, grep: process.argv.includes('--grep') ? process.argv[process.argv.indexOf('--grep') + 1] : undefined });
mocha.addFile(path.join(root, 'test/ui/editorContext.test.cjs'));
mocha.addFile(path.join(root, 'test/ui/diffView.test.cjs'));
try {
  await browser.start(code, [workspace]);
  await browser.waitForWorkbench();
  await mocha.loadFilesAsync();
  const results = [];
  const failures = await new Promise(resolve => {
    const runner = mocha.run(resolve);
    runner.on('test end', test => results.push({ title: test.fullTitle(), state: test.state, durationMs: test.duration, error: test.err?.message }));
  });
  writeFileSync(path.join(storage, 'result.json'), JSON.stringify({ version: appMetadata.version, failures, tests: results.length, results, workspace, timestamp: new Date().toISOString() }, null, 2));
  process.exitCode = failures ? 1 : 0;
} finally { await browser.quit(); }
