const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'GraphViewPanel.ts'), 'utf8');

function expectIncludes(s, sub) {
  assert.ok(s.includes(sub), `Expected to include: ${sub}`);
}

// Basic test: ensure GraphViewPanel posts 'controlsState' and handles 'ready' message
expectIncludes(src, "_panel.webview.postMessage({\n      type: 'controlsState',\n");
expectIncludes(src, "case 'ready':\n            await this._syncControls();\n            await this._regenerateGraph();\n            break;");

console.log('✅ GraphViewPanel basic source checks passed');
