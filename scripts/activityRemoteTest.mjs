// Real remote command transport: browser UI/worker + loopback VS Code Node server.
// Supply a server-web distribution via VSCODE_WEB_SERVER_ROOT (never a user server-data directory).
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = process.env.VSCODE_WEB_SERVER_ROOT;
if (!serverRoot) throw new Error('Set VSCODE_WEB_SERVER_ROOT to an extracted VS Code server-web distribution');
const root = await fs.mkdtemp('/private/tmp/markdown-studio-activity-remote-');
const workspace = path.join(root, 'workspace');
const extensions = path.join(root, 'extensions');
const reportPath = path.join(workspace, 'remote-context-report.json');
const token = crypto.randomBytes(24).toString('hex');
await fs.mkdir(workspace, { recursive: true });
await fs.mkdir(extensions);
await fs.writeFile(path.join(root, 'token'), token, { mode: 0o600 });
await fs.writeFile(path.join(workspace, 'tasks.md'), '- [ ] **Ship**\n\nAnother paragraph.\n');
await fs.writeFile(path.join(workspace, 'unrelated.txt'), 'An unrelated text document.\n');
const settings = { 'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false, 'git.enabled': false, 'security.workspace.trust.enabled': false,
  'markdown-editor.ai.enable': false, 'markdown-editor.ai.enableInlineSuggestions': false };
await fs.mkdir(path.join(workspace, '.vscode'));
await fs.writeFile(path.join(workspace, '.vscode/settings.json'), JSON.stringify(settings));
const providerPath = path.join(extensions, 'phfsantos.markdown-editor-0.5.11');
const vsix = process.env.VSCODE_PROVIDER_VSIX || path.join(repo, '.extest/activity/markdown-studio.vsix');
await fs.access(vsix);
await new Promise((resolve, reject) => {
  const unpack = spawn('/usr/bin/unzip', ['-q', vsix, '-d', path.join(root, 'package')]);
  unpack.on('error', reject);
  unpack.on('exit', code => code === 0 ? resolve() : reject(new Error(`VSIX extraction failed: ${code}`)));
});
await fs.rename(path.join(root, 'package/extension'), providerPath);
await fs.access(path.join(providerPath, 'out/media/main.js'));
// Test-only installation placement; no production manifest changes.
const providerManifest = JSON.parse(await fs.readFile(path.join(providerPath, 'package.json'), 'utf8'));
providerManifest.extensionKind = ['workspace'];
await fs.writeFile(path.join(providerPath, 'package.json'), JSON.stringify(providerManifest));
for (const name of ['agent-activity-remote-driver']) {
  await fs.cp(path.join(repo, 'test/fixtures', name), path.join(extensions, `markdown-studio-tests.${name}`), { recursive: true });
}
const env = { ...process.env };
for (const key of Object.keys(env)) if (key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('VSCODE_')) delete env[key];
let server, browser, output = '', serverLog = '';
const browserLog = [];
const redact = value => String(value).replaceAll(token, '[token]');
const timeout = async (fn, description, ms = 30000) => {
  const deadline = Date.now() + ms;
  let last;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch (error) {
      if (error.failFast) throw error;
      last = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out ${description}: ${last?.message || 'condition not met'}`);
};
try {
  server = spawn(path.join(serverRoot, 'node'), [path.join(serverRoot, 'out/server-main.js'),
    '--host', '127.0.0.1', '--port', '0', '--server-data-dir', path.join(root, 'server-data'),
    '--user-data-dir', path.join(root, 'user-data'), '--extensions-dir', extensions,
    '--connection-token-file', path.join(root, 'token'), '--default-folder', workspace,
    '--disable-workspace-trust', '--telemetry-level', 'off', '--accept-server-license-terms',
    '--enable-smoke-test-driver'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', data => { output += String(data); serverLog += redact(data); });
  server.stderr.on('data', data => { serverLog += redact(data); });
  const port = await timeout(() => output.match(/Extension host agent listening on (\d+)/)?.[1]
    || output.match(/Web UI available at http:\/\/localhost:(\d+)/)?.[1], 'server startup');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(redact(error.message)));
  page.on('console', message => browserLog.push({ type: message.type(), text: redact(message.text()) }));
  await page.goto(`http://127.0.0.1:${port}/?tkn=${token}&folder=${encodeURIComponent(workspace)}`);
  await page.locator('.monaco-workbench').waitFor({ timeout: 60000 });
  async function command(title) {
    await timeout(async () => {
      // Refresh the palette after extension scanning; an early query can retain builtin-only results.
      await page.keyboard.press('Escape');
      await page.keyboard.press('F1');
      const input = page.locator('.quick-input-widget input');
      await input.fill(`>${title}`);
      try {
        await page.getByRole('option').filter({ hasText: title }).first().waitFor({ timeout: 1000 });
        await page.keyboard.press('Enter');
        return true;
      } catch { return false; }
    }, `command registration: ${title}`, 30000);
  }
  await command('Remote Activity Test: Run');
  const report = await timeout(async () => {
    const value = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    if (value.status === 'failed') throw Object.assign(new Error(value.error), { failFast: true });
    return value.status === 'reported' ? value : undefined;
  }, 'remote activity reporting', 60000);
  const editorFrame = await timeout(async () => {
    for (const frame of page.frames()) if (await frame.locator('.vditor-ir input[type=checkbox]').count()) return frame;
  }, 'real remote Vditor content', 60000);
  const indicator = editorFrame.locator('.md-agent-task-indicator');
  await indicator.waitFor({ timeout: 15000 });
  if (await indicator.count() !== 1) throw new Error('Expected one remote task indicator');
  await page.screenshot({ path: path.join(root, 'remote-working.png') });
  async function checkStage(name, expectedState) {
    await command('Remote Activity Test: ' + name[0].toUpperCase() + name.slice(1));
    await timeout(async () => {
      const value = JSON.parse(await fs.readFile(reportPath, 'utf8'));
      if (value.status === 'failed') throw Object.assign(new Error(value.error), { failFast: true });
      return value.status === name;
    }, name + ' command');
    if (expectedState) await timeout(async () => (await indicator.getAttribute('data-state')) === expectedState, name + ' visible state');
    else await indicator.waitFor({ state: 'detached', timeout: 15000 });
  }
  await checkStage('update', 'review');
  await page.screenshot({ path: path.join(root, 'remote-review.png') });
  await checkStage('clear');
  await page.screenshot({ path: path.join(root, 'remote-clear.png') });
  await checkStage('expire', 'working');
  const expiryStart = Date.now();
  await indicator.waitFor({ state: 'detached', timeout: 125000 });
  report.expiryElapsedMs = Date.now() - expiryStart;
  report.status = 'passed';
  report.final = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  report.checks.push('one exact remote checkbox indicator, working→review update, clear and 120-second expiry visible across actual hosts');
  report.browserErrors = errors;
  await fs.writeFile(path.join(root, 'result.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: path.join(root, 'final.png') });
  console.log(JSON.stringify({ result: 'passed', root, report: path.join(root, 'result.json'), checks: report.checks }));
} catch (error) {
  console.error(redact(error.stack || error));
  console.error(`Remote validation artifacts: ${root}`);
  if (browser) {
    const pages = browser.contexts().flatMap(context => context.pages());
    await pages[0]?.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {});
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  server?.kill('SIGTERM');
  await fs.writeFile(path.join(root, 'server.log'), serverLog);
  await fs.writeFile(path.join(root, 'browser-log.json'), JSON.stringify(browserLog, null, 2));
}
