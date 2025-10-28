const { execFileSync } = require('child_process');
const path = require('path');
console.log('Running TagManager tests...');
try {
  require('./tagmanager.test.js');
  console.log('Unit tests completed');
  process.exit(0);
} catch (e) {
  console.error('Unit tests failed', e);
  process.exit(1);
}
