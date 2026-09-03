import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The real 'vscode' module only exists inside the extension host; unit
      // tests run against this shared, mutable mock instead.
      vscode: path.resolve(__dirname, 'test/mocks/vscode.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      // Core-logic scope measured by the suite; UI/host-bound modules
      // (EditorPanel, sidebar, calendar OAuth) need extension-host tests and
      // are excluded until those exist.
      include: [
        'src/app/chatEditingDiff.ts',
        'src/diff/**/*.ts',
        'src/services/modelNameNormalizer.ts',
        'src/services/AIMarkdownDetector.ts',
        'src/services/AIMarkdownWorkflowService.ts',
        'packages/media/src/line-number-renderer.ts',
        'packages/media/src/diff-line-dom-mapper.ts',
        'packages/media/src/clipboard-selection.js',
      ],
      thresholds: {
        lines: 50,
        functions: 50,
      },
    },
  },
});
