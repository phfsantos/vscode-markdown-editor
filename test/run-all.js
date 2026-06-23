const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 Running markdown-editor test suite...\n');

const tests = [
  'native-sidebar-regression.test.js',
  'package-layout.test.js',
  'tagmanager.test.js',
  'link-resolver.test.js',
  'embed-handler.test.js',
  'relationship-analyzer.test.js',
  'chat-editing-diff.test.js',
  'ai-markdown-workflow.test.js',
  'ai-markdown-webview.test.js',
  'diff-role-stats.test.js',
  'diff-support.test.js',
  'diff-algorithm-with-spacers.test.js',
  'diff-line-dom-mapper.test.js',
  'html-line-parser.test.js',
  'html-diff-support.test.js',
  'line-number-renderer.test.js',
  'line-number-wrap-positions.test.js',
  'clean-content-for-save.test.js',
  'clipboard-selection.test.js',
  'toolbar-open-text-editor.test.js',
  'widget-integration.test.js',
  'widget-commands.test.js',
];

let passed = 0;
let failed = 0;

for (const testFile of tests) {
  console.log(`\n📝 Running ${testFile}...`);
  try {
    const testPath = path.join(__dirname, testFile);
    execSync(`node "${testPath}"`, { stdio: 'inherit', cwd: __dirname });
    passed++;
  } catch (e) {
    console.error(`❌ ${testFile} failed`);
    failed++;
  }
}

console.log(`\n${'='.repeat(50)}`);
console.log('📊 Test Summary:');
console.log(`   ✅ Passed: ${passed}`);
console.log(`   ❌ Failed: ${failed}`);
console.log(`   Total: ${tests.length}`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✨ All tests passed!');
  process.exit(0);
}
