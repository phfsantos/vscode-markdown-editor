const path = require('path');
const { execSync } = require('child_process');

console.log('🧪 Running markdown-editor test suite...\n');

const tests = [
  'tagmanager.test.js',
  'link-resolver.test.js',
  'embed-handler.test.js',
  'relationship-analyzer.test.js',
  'diff-support.test.js',
  'diff-algorithm-with-spacers.test.js',
  'clean-content-for-save.test.js',
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
console.log(`📊 Test Summary:`);
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
