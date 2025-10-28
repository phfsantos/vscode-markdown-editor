const path = require('path');

console.log('🧪 Running markdown-editor test suite...\n');

const tests = [
  'tagmanager.test.js',
  'link-resolver.test.js',
  'embed-handler.test.js',
  'relationship-analyzer.test.js',
];

let passed = 0;
let failed = 0;

for (const testFile of tests) {
  console.log(`\n📝 Running ${testFile}...`);
  try {
    require(path.join(__dirname, testFile));
    passed++;
  } catch (e) {
    console.error(`❌ ${testFile} failed:`, e.message);
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
