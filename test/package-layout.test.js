const assert = require('assert');
const fs = require('fs');
const path = require('path');

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
  const activationEvents = new Set(packageJson.activationEvents || []);
  for (const commandId of AI_COMMANDS) {
    assert.ok(
      activationEvents.has(`onCommand:${commandId}`),
      `Expected activation event for ${commandId}`
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
  const expectedPatterns = [
    'out/**',
    '!out/media/**',
    '!out/sidebar/**',
    '!out/widgets/index.js',
    'out/**/*.map',
  ];

  for (const pattern of expectedPatterns) {
    assert.ok(
      vscodeIgnore.includes(pattern),
      `Expected .vscodeignore to contain ${pattern}`
    );
  }

  console.log('✅ testVsixIgnoreKeepsOnlyRuntimeAssets passed');
}

try {
  testExtensionEntryPointsUseBundle();
  testAiCommandsAndSettingsAreContributed();
  testAiActivationEventsAndMenuPlacementsAreContributed();
  testVsixIgnoreKeepsOnlyRuntimeAssets();
  console.log('✅ All package layout tests passed');
} catch (error) {
  console.error('❌ package layout tests failed');
  throw error;
}
