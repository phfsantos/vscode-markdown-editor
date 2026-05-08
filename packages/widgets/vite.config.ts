import { webcrypto } from 'node:crypto';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

const cryptoCompat = globalThis as typeof globalThis & {
  crypto?: Crypto;
};

if (!cryptoCompat.crypto?.getRandomValues) {
  cryptoCompat.crypto = webcrypto as Crypto;
}

// https://vitejs.dev/config/
export default defineConfig({
  // Define process.env.NODE_ENV for React - required for browser bundles
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': JSON.stringify({})
  },
  plugins: [
    react(),
    dts({
      insertTypesEntry: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx']
    })
  ],
  build: {
    outDir: '../../out/widgets',
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      // Use lowercase 'markdownWidgets' to match widget-integration.ts expectation
      name: 'markdownWidgets',
      formats: ['es', 'umd'],
      fileName: (format) => `index.${format === 'es' ? 'mjs' : 'js'}`
    },
    // Don't externalize React - bundle it for standalone webview use
    rollupOptions: {
      output: {
        // Ensure React is bundled, not externalized
      }
    },
    sourcemap: true,
    minify: false
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    coverage: {
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.ts',
        '**/*.test.tsx'
      ]
    }
  }
});
