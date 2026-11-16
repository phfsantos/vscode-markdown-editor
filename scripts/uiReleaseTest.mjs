/** Native pre-release checks against an existing VSIX; never publishes. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolsRoot = process.env.MARKDOWN_UI_TOOLS ?? path.join(repo, 'test/ui');
const require = createRequire(path.join(toolsRoot, 'package.json'));
const vsix = process.env.MARKDOWN_UI_VSIX;
if (!vsix || !fs.existsSync(vsix)) throw new Error('Set MARKDOWN_UI_VSIX to the built VSIX to inspect and test.');
const storage = process.env.MARKDOWN_RELEASE_STORAGE ?? fs.mkdtempSync('/private/tmp/md-release-');
fs.mkdirSync(storage, { recursive: true });
if (!process.argv.includes('--clean-child')) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_')));
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2), '--clean-child'], { cwd: repo, stdio: 'inherit', env: { ...env, MARKDOWN_RELEASE_STORAGE: storage } });
  process.exit(child.status ?? 1);
}
const code = process.env.MARKDOWN_UI_CODE ?? path.join(repo, '.extest/Visual Studio Code.app/Contents/MacOS/Code');
const driver = process.env.MARKDOWN_UI_DRIVER ?? path.join(repo, '.extest/chromedriver-mac-x64/chromedriver');
for (const file of [code, driver]) if (!fs.existsSync(file)) throw new Error(`Missing native UI prerequisite: ${file}`);
const metadata = JSON.parse(fs.readFileSync(path.resolve(path.dirname(code), '../Resources/app/package.json')));
const workspace = path.join(storage, 'workspace');
const extensions = path.join(storage, 'extensions');
fs.mkdirSync(workspace); fs.mkdirSync(extensions); fs.mkdirSync(path.join(workspace, '.vscode'));
fs.writeFileSync(path.join(workspace, '.vscode/settings.json'), JSON.stringify({ 'workbench.editorAssociations': { '*.json': 'workspace.jsonEditor' } }));
const source = '# Markdown Studio\n\nConnected notes, directly in VS Code.\n\n## Release checklist\n\n- [ ] Review the release\n- [x] Preserve Markdown source\n\n## Connected knowledge\n\nExplore [[Release Notes]] and keep ideas organized with #release and #markdown.\n\n| Check | Result |\n| --- | --- |\n| Source fidelity | Preserved |\n| Connected notes | Ready |\n\n```javascript\nconst release = "Markdown Studio";\n```\n\n```mermaid\ngraph LR\n  Notes --> Links\n```\n';
for (const [name, text] of Object.entries({ 'Markdown Studio.md': source, 'Release Notes.md': '# Release Notes\n\nBack to [[Markdown Studio]]. #release\n', 'other.md': '# Another tab\n' })) fs.writeFileSync(path.join(workspace, name), text);
fs.writeFileSync(path.join(storage, 'original.md'), source);
process.env.MARKDOWN_UI_CODE = code; process.env.TEST_RESOURCES = storage; process.env.EXTENSIONS_FOLDER = extensions; process.env.MARKDOWN_UI_WORKSPACE = workspace; process.env.MARKDOWN_UI_TOOLS = toolsRoot;
fs.mkdirSync(path.join(storage, 'chromedriver-mac-x64')); fs.copyFileSync(driver, path.join(storage, 'chromedriver-mac-x64/chromedriver'));
// Install with the real CLI into the isolated extensions directory. No user profile is touched.
const cli = path.resolve(path.dirname(code), '../Resources/app/out/cli.js');
const install = spawnSync(code, [cli, '--user-data-dir', path.join(storage, 'settings'), '--extensions-dir', extensions, '--install-extension', process.env.MARKDOWN_RELEASE_PREVIOUS_VSIX ?? vsix, '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 });
fs.writeFileSync(path.join(storage, 'install.log'), `${install.stdout ?? ''}\n${install.stderr ?? ''}`);
if (install.status !== 0) throw new Error(`VSIX installation failed: ${install.error?.message ?? install.stderr}`);
const fixtureVsix = path.join(storage, 'release-driver.vsix');
await require('@vscode/vsce').createVSIX({ cwd: path.join(repo, 'test/ui/release-driver'), packagePath: fixtureVsix, dependencies: false, skipLicense: true, allowMissingRepository: true });
const fixtureInstall = spawnSync(code, [cli, '--user-data-dir', path.join(storage, 'settings'), '--extensions-dir', extensions, '--install-extension', fixtureVsix, '--force'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 });
fs.writeFileSync(path.join(storage, 'fixture-install.log'), `${fixtureInstall.stdout ?? ''}\n${fixtureInstall.stderr ?? ''}`);
if (fixtureInstall.status !== 0) throw new Error('Test-driver VSIX installation failed');
const { VSBrowser, ReleaseQuality } = require('vscode-extension-tester');
const Mocha = require('mocha');
const settings = { 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false, 'window.restoreWindows': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false, 'extensions.autoCheckUpdates': false, 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'markdown-editor.ai.enable': false, 'markdown-editor.ai.enableInlineSuggestions': false, 'workbench.editorAssociations': { '*.json': 'global.jsonEditor' } };
const browser = new VSBrowser(metadata.version, ReleaseQuality.Stable, settings);
const mocha = new Mocha({ timeout: 60000, grep: process.argv.includes('--grep') ? process.argv[process.argv.indexOf('--grep') + 1] : undefined });
mocha.addFile(path.join(repo, 'test/ui/releaseReadiness.test.cjs'));
console.log(JSON.stringify({ storage, version: metadata.version, vsix }));
try {
  await browser.start(code, [workspace]); await browser.waitForWorkbench(); await mocha.loadFilesAsync();
  let count = 0; const results = [];
  const failures = await new Promise(resolve => { const runner = mocha.run(resolve); runner.on('test end', test => { count++; results.push({ title: test.title, state: test.state, error: test.err?.message }); }); });
  fs.writeFileSync(path.join(storage, 'result.json'), JSON.stringify({ version: metadata.version, vsix, tests: count, failures, results }, null, 2));
  process.exitCode = failures || !count ? 1 : 0;
} finally { await browser.quit(); }
