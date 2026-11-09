/** Run the activity probe in an isolated VS Code 1.95 Development Host.
 * Download the official darwin/stable 1.95.0 archive into /private/tmp first.
 * Usage: node scripts/activityBaselineTest.mjs [/path/to/Visual Studio Code.app/Contents/MacOS/Electron] [--host-only|--document-only]
 * --host-only excludes Markdown Studio; --document-only activates it without activity calls.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = '/private/tmp/markdown-studio-vscode195/Visual Studio Code.app';
const hostOnly = process.argv.includes('--host-only');
const documentOnly = process.argv.includes('--document-only');
if (hostOnly && documentOnly) throw new Error('Choose --host-only or --document-only');
const binary = process.argv.slice(2).find(arg => !arg.startsWith('--')) ?? path.join(app, 'Contents/MacOS/Electron');
if (!existsSync(binary)) throw new Error(`Missing baseline executable: ${binary}`);
const metadataPath = path.resolve(path.dirname(binary), '../Resources/app/package.json');
const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
const product = JSON.parse(readFileSync(path.join(path.dirname(metadataPath), 'product.json'), 'utf8'));
if (metadata.version !== '1.95.0') throw new Error(`Expected VS Code 1.95.0, got ${metadata.version}`);
const sandbox = mkdtempSync('/private/tmp/markdown-studio-activity-baseline195-');
for (const name of ['home', 'user/User', 'extensions', 'workspace']) mkdirSync(path.join(sandbox, name), { recursive: true });
writeFileSync(path.join(sandbox, 'user/User/settings.json'), JSON.stringify({
  'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
  'security.workspace.trust.enabled': false, 'update.mode': 'none',
  'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false,
  'extensions.autoCheckUpdates': false, 'markdown-editor.ai.enable': false,
  'markdown-editor.ai.enableInlineSuggestions': false,
}));
const report = path.join(sandbox, 'activity-report.json');
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name !== 'ELECTRON_RUN_AS_NODE' && !name.startsWith('VSCODE_')));
Object.assign(env, { HOME: path.join(sandbox, 'home'), USERPROFILE: path.join(sandbox, 'home'), MARKDOWN_STUDIO_DIAGNOSTIC_OUTPUT: report,
  MARKDOWN_BASELINE_PROVIDER: hostOnly ? 'absent' : 'present' });
const args = [
  '--new-window', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust',
  `--user-data-dir=${path.join(sandbox, 'user')}`,
  `--extensions-dir=${path.join(sandbox, 'extensions')}`,
  ...(hostOnly ? [] : [`--extensionDevelopmentPath=${root}`]),
  `--extensionDevelopmentPath=${path.join(root, 'test/fixtures/agent-activity-consumer')}`,
  `--extensionTestsPath=${process.env.MARKDOWN_BASELINE_PROBE ?? path.join(root, `test/fixtures/agent-activity-consumer/${hostOnly || documentOnly ? 'host-probe' : 'baseline-probe'}.js`)}`,
  path.join(sandbox, 'workspace'),
];
console.log(JSON.stringify({ version: metadata.version, hostOnly, documentOnly, binary, sandbox, report }));
const result = spawnSync(binary, args, { cwd: root, env, encoding: 'utf8', timeout: 180000, killSignal: 'SIGKILL', maxBuffer: 8 * 1024 * 1024 });
writeFileSync(path.join(sandbox, 'host.log'), `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
let probe;
if (existsSync(report)) probe = JSON.parse(readFileSync(report, 'utf8'));
const progressPath = report + '.progress';
const summary = { version: metadata.version, commit: product.commit, platform: process.platform, arch: process.arch,
  providerBundleSha256: hostOnly ? undefined : createHash('sha256').update(readFileSync(path.join(root, 'dist/extension.js'))).digest('hex'),
  hostOnly, documentOnly, progressLog: existsSync(progressPath) ? progressPath : undefined, status: result.status, signal: result.signal,
  error: result.error?.message, report, hostLog: path.join(sandbox, 'host.log'),
  failure: probe?.failure, coldCommandActivation: probe?.coldCommandActivation,
  checks: probe?.checks, editorRuntime: probe?.editorRuntime, notes: probe?.notes, hostProbe: probe?.hostProbe };
writeFileSync(path.join(sandbox, 'result.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
process.exitCode = result.status === 0 && probe && !probe.failure && probe.editorRuntime !== 'blocked' ? 0 : 1;
