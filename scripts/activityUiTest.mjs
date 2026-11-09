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
const storage = path.join(root, '.extest/activity');
const code = process.env.MARKDOWN_UI_CODE ?? path.join(storage, 'Visual Studio Code.app/Contents/MacOS/Code');
const driver = process.env.MARKDOWN_UI_DRIVER ?? path.join(storage, 'chromedriver-mac-x64/chromedriver');
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'ELECTRON_RUN_AS_NODE' && !key.startsWith('VSCODE_')));
const sandbox = mkdtempSync(path.join(os.tmpdir(), 'md-ui-'));
const workspace = path.join(sandbox, 'workspace');
mkdirSync(workspace); mkdirSync(path.join(sandbox, 'home'));
for (const [name, content] of Object.entries({ 'tasks.md': '- [ ] Same\n- [ ] Same\n', 'other.md': 'Other document.\n', 'unrelated.txt': 'Unrelated.\n' })) writeFileSync(path.join(workspace, name), content);
// A disposable repository supplies real built-in Git decorations.
writeFileSync(path.join(workspace,'tasks.md'), '- [ ] Same\n- [ ] Same\nCommitted text.\n');
for (const args of [['init','--quiet'],['add','.'],['-c','user.name=Activity Test','-c','user.email=activity@example.invalid','commit','--quiet','-m','fixture']]) {
  const result=spawnSync('git',args,{cwd:workspace,encoding:'utf8'});
  if(result.status!==0) throw new Error(result.stderr);
}
writeFileSync(path.join(workspace,'tasks.md'), '- [ ] Same\n- [ ] Same\n');
mkdirSync(storage, { recursive: true });
process.env.TEST_RESOURCES = storage;
process.env.EXTENSIONS_FOLDER = path.join(storage, 'extensions');
process.env.MARKDOWN_UI_WORKSPACE = workspace;
process.env.MARKDOWN_UI_TOOLS = toolsRoot;
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
if (!process.argv.includes('--skip-setup')) {
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
  writeFileSync(path.join(staging, 'package.json'), JSON.stringify(manifest, null, 2));
  for (const name of ['dist', 'out/media', 'out/widgets/index.js', 'out/sidebar', 'media/logo.png', 'media/sidebar-icon.svg', 'README.md', 'LICENSE']) {
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
rmSync(path.join(extensions, 'markdown-studio-tests.agent-activity-consumer-0.0.1'), { recursive: true, force: true });
rmSync(path.join(extensions, 'markdown-studio-tests.activity-ui-driver-0.0.1'), { recursive: true, force: true });
cpSync(path.join(root, 'test/fixtures/agent-activity-consumer'), path.join(extensions, 'markdown-studio-tests.agent-activity-consumer-0.0.1'), { recursive: true });
cpSync(path.join(root, 'test/ui/activity-driver'), path.join(extensions, 'markdown-studio-tests.activity-ui-driver-0.0.1'), { recursive: true });
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
  'files.simpleDialog.enable': true, 'git.decorations.enabled': false,
  'window.restoreWindows': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off',
});
const mocha = new Mocha({ timeout: 60000, grep: process.argv.includes('--grep') ? process.argv[process.argv.indexOf('--grep') + 1] : undefined });
mocha.addFile(path.join(root, 'test/ui/agentActivity.test.cjs'));
try {
  await browser.start(code, [workspace]);
  await browser.waitForWorkbench();
  await mocha.loadFilesAsync();
  const failures = await new Promise(resolve => mocha.run(resolve));
  writeFileSync(path.join(storage, 'result.json'), JSON.stringify({ version: appMetadata.version, failures, workspace, timestamp: new Date().toISOString() }, null, 2));
  process.exitCode = failures ? 1 : 0;
} finally { await browser.quit(); }
