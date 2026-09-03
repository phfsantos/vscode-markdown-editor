import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8')
);
const vscodeIgnore = fs.readFileSync(
  path.join(rootDir, '.vscodeignore'),
  'utf8'
);

const AI_COMMANDS = [
  'markdown-editor.copyAiContext',
  'markdown-editor.insertAiContext',
  'markdown-editor.insertAiTemplate',
  'markdown-editor.openAiChat',
  'markdown-editor.validateAiMarkdown',
];

const AI_FILE_WHEN = 'resourceFilename =~ /(?:\\.agent\\.md$|\\.prompt\\.md$|^SKILL\\.md$)/i';
const AI_EDITOR_WHEN = `editorLangId == markdown && ${AI_FILE_WHEN}`;

function testExtensionEntryPointsUseBundle() {
  assert.strictEqual(packageJson.main, './dist/extension.js');
  assert.strictEqual(packageJson.scripts.compile, 'node esbuild.js');
  assert.strictEqual(
    packageJson.scripts['build:extension'],
    'node esbuild.js --production'
  );

  console.log('✅ testExtensionEntryPointsUseBundle passed');
}

function testAiCommandsAndSettingsAreContributed() {
  const commands = packageJson.contributes.commands || [];
  const commandIds = new Set(commands.map((entry) => entry.command));

  for (const commandId of AI_COMMANDS) {
    assert.ok(commandIds.has(commandId), `Expected AI command contribution for ${commandId}`);
  }

  const properties = packageJson.contributes.configuration?.properties || {};
  const expectedSettings = {
    'markdown-editor.ai.enable': { type: 'boolean', default: true, scope: 'resource' },
    'markdown-editor.ai.enableAffordances': { type: 'boolean', default: true, scope: 'resource' },
    'markdown-editor.ai.enableChatInterop': { type: 'boolean', default: true, scope: 'resource' },
    'markdown-editor.ai.provider': { type: 'string', default: 'copilotChat', scope: 'resource' },
    'markdown-editor.ai.maxContextItems': { type: 'number', default: 5, scope: 'resource' },
    'markdown-editor.ai.maxContextChars': { type: 'number', default: 6000, scope: 'resource' },
  };

  for (const [key, expected] of Object.entries(expectedSettings)) {
    assert.ok(properties[key], `Expected configuration contribution for ${key}`);
    assert.strictEqual(properties[key].type, expected.type, `${key} should use the expected type`);
    assert.strictEqual(properties[key].default, expected.default, `${key} should use the expected default`);
    assert.strictEqual(properties[key].scope, expected.scope, `${key} should use resource scope`);
  }

  console.log('✅ testAiCommandsAndSettingsAreContributed passed');
}

function testAiActivationEventsAndMenuPlacementsAreContributed() {
  // Since VS Code 1.74, onCommand/onView activation events are auto-generated
  // from contribution declarations; the manifest must not redeclare them, and
  // the commands themselves must be contributed (checked in the previous test).
  const activationEvents = new Set(packageJson.activationEvents || []);
  for (const commandId of AI_COMMANDS) {
    assert.ok(
      !activationEvents.has(`onCommand:${commandId}`),
      `Redundant explicit activation event for ${commandId} (auto-generated since VS Code 1.74)`
    );
  }
  for (const language of ['chatagent', 'skill', 'prompt']) {
    assert.ok(
      activationEvents.has(`onLanguage:${language}`),
      `Expected onLanguage activation event for ${language}`
    );
  }

  const menus = packageJson.contributes.menus || {};
  const assertMenuContains = (menuId, commandId, when) => {
    const entry = (menus[menuId] || []).find((item) => item.command === commandId);
    assert.ok(entry, `Expected ${commandId} in ${menuId}`);
    if (when) {
      assert.strictEqual(entry.when, when, `Expected ${commandId} in ${menuId} to use ${when}`);
    }
  };

  for (const commandId of AI_COMMANDS) {
    assertMenuContains('commandPalette', commandId, AI_EDITOR_WHEN);
    assertMenuContains('editor/context', commandId, AI_EDITOR_WHEN);
  }

  for (const commandId of [
    'markdown-editor.copyAiContext',
    'markdown-editor.openAiChat',
    'markdown-editor.validateAiMarkdown',
  ]) {
    assertMenuContains('explorer/context', commandId, AI_FILE_WHEN);
    assertMenuContains('editor/title', commandId, AI_EDITOR_WHEN);
  }

  console.log('✅ testAiActivationEventsAndMenuPlacementsAreContributed passed');
}

function testVsixIgnoreKeepsOnlyRuntimeAssets() {
  // vsce negation patterns override ignore patterns regardless of order, so
  // broad negations like !out/media/** would re-include sourcemaps. The
  // un-ignores must stay type-specific (never matching *.map).
  const expectedPatterns = [
    'out/**',
    '!out/media/**/*.js',
    '!out/media/**/*.css',
    '!out/sidebar/**/*.js',
    '!out/widgets/index.js',
    '*.map',
  ];

  for (const pattern of expectedPatterns) {
    assert.ok(
      vscodeIgnore.includes(pattern),
      `Expected .vscodeignore to contain ${pattern}`
    );
  }

  const negationsMatchingMaps = vscodeIgnore
    .split('\n')
    .filter((line) => line.startsWith('!') && line.includes('*.map'));
  assert.strictEqual(
    negationsMatchingMaps.length,
    0,
    'Negation patterns must never re-include sourcemaps'
  );

  console.log('✅ testVsixIgnoreKeepsOnlyRuntimeAssets passed');
}

test('extension entry points use bundle', testExtensionEntryPointsUseBundle);
test('AI commands and settings are contributed', testAiCommandsAndSettingsAreContributed);
test('AI activation events and menu placements are contributed', testAiActivationEventsAndMenuPlacementsAreContributed);
test('.vscodeignore keeps only runtime assets', testVsixIgnoreKeepsOnlyRuntimeAssets);
