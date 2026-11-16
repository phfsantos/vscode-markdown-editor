# Markdown Studio release gates — 2026-11-14

Repository: /Users/pedrosantos/www/vscode-markdown-editor
Manifest: markdown-editor 0.5.14
Yarn: 1.22.22
Vitest: 4.1.10

| Command | Exit | Result | Evidence |
|---|---:|---|---|
| yarn lint | 0 | ESLint passed, 3.20s | lint.log |
| yarn test | 0 | Type checks passed; core 7 files/106 tests; root 76 files/677 tests; widgets 4 files/35 tests; 33.71s | test.log |
| yarn test:browser (sandbox) | 1 | No tests executed; local server bind denied, listen EPERM ::1:63315 | browser.log |
| yarn test:browser (approved escalation) | 0 | 14 files/155 tests; 18.14s Vitest, 19.30s Yarn | browser-unsandboxed.log |
| yarn package | 0 | Core, extension, media and widget bundles built; 36.16s | package.log |

Root unit coverage: statements 64.77% (1026/1584), branches 67.45% (794/1177), functions 74.26% (202/272), lines 62.98% (895/1421).

Warnings: Yarn reports the VS Code engine field as invalid (it is an extension host constraint); sandbox Yarn cache/global paths are not writable and it selects a temporary cache; Vite emits existing esbuild/oxc deprecation warnings and a widget outDir warning. None caused a failing gate.

No source or manifest edits made by this QA task. Generated build/coverage outputs were produced by project commands. No publication, tags, version changes, or registry authentication.

Limits: These commands do not verify VS Code chrome, installation/upgrade smoke behavior, remote listings, or archive contents. Orchestrator owns those checks.
