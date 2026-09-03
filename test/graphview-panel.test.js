import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'app', 'GraphViewPanel.ts'), 'utf8');

function expectIncludes(s, sub) {
  assert.ok(s.includes(sub), `Expected to include: ${sub}`);
}

test('GraphViewPanel posts controlsState and handles the ready message', () => {
  expectIncludes(src, "_panel.webview.postMessage({\n      type: 'controlsState',\n");
  expectIncludes(src, "case 'ready':\n            await this._syncControls();\n            await this._regenerateGraph();\n            break;");
});
