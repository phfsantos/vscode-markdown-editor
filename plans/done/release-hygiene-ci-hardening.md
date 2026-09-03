# Release Hygiene & CI Hardening (0.5.0 gate)

**Priority:** HIGH — blocks every other plan. **Role:** devops
**Created:** 2026-07-06 (codebase state audit)

## Problem / Context

The publish pipeline is broken and the manifest lies about compatibility:

- `.github/workflows/main.yml` — the Marketplace publish step consumes
  `steps.publishToOpenVSX.outputs.vsixPath`, but the OpenVSX step is declared
  **after** it, so the output is empty when the Marketplace step runs.
- CI runs Node 14 with `actions/checkout@v2`, and the gate is `npm test` →
  `"test": "echo 0"` — nothing is actually verified before publishing.
- `CHANGELOG.md` stops at 0.4.7 while `package.json` is at 0.4.15 — eight
  undocumented releases.
- `engines.vscode` declares `^1.47.0` but `src/extension.ts`,
  `src/app/EditorPanel.ts`, and `src/services/InlineSuggestionService.ts` use
  `vscode.lm` (requires 1.90+) and inline completions (1.68+). Users on old
  VS Code can install a build that breaks at runtime.
- User-facing settings enum has typos: `gtp-4o-mini`, `gtp-4o`
  (`markdown-editor.ai.modelName`).
- Repo bloat: 18 committed `.vsix` files (~25MB), `demo.gif` (2.4MB),
  junk duplicates (`media/logo copy.png`, `demo-workspace/Getting Started copy.md`,
  `test/testNumbers copy.md`). VSIX itself grew 788KB (0.2.10) → 8.9MB (0.4.15).

## Steps

1. Reorder `main.yml`: OpenVSX step (id `publishToOpenVSX`) **before** the
   Marketplace step that reuses its `vsixPath`; bump to `checkout@v4`,
   `setup-node@v4`, Node 20; install all three yarn roots (root,
   `packages/media`, `packages/widgets`).
2. Wire the real gate: `"test"` → run `check-types` + `test:unit`; CI fails on it.
3. Bump `engines.vscode` + `@types/vscode` to `^1.90.0`; verify activation on
   the declared minimum version.
4. Fix `ai.modelName` enum typos (`gtp-4o*` → `gpt-4o*`) with a settings
   migration/fallback for saved typo values.
5. Backfill CHANGELOG for 0.4.8–0.4.15 from git log; add Unreleased → 0.5.0.
6. `git rm` all `*.vsix`, `demo.gif` (move to GitHub Releases), and the
   `copy` junk files; add `*.vsix` to `.gitignore`.
7. Audit VSIX contents (`npx vsce ls`); trim `.vscodeignore` until VSIX < 2MB.
8. Tag and ship 0.5.0 through the fixed pipeline (Marketplace + Open VSX).

## Acceptance criteria

- [x] One tag push publishes the same VSIX to Marketplace and Open VSX
      (workflow rewritten & YAML-validated; the actual publish is user-gated —
      see follow-up plan "Ship 0.5.0 & VSIX slim-down follow-ups")
- [x] CI fails when typecheck or unit tests fail (`yarn test` observed failing
      on a real type error and a real test failure, then green 23/23)
- [x] engines matches every API used — true minimum turned out to be **1.95**
      (`lm.tools`), not the 1.90 this plan estimated; `@types/vscode` pinned `~1.95.0`
- [x] CHANGELOG covers every published version (0.4.8–0.4.14 consolidated —
      history was squashed at the "LLM Release" commit; 0.4.15 + 0.5.0 itemized)
- [ ] VSIX < 2MB — **not met**: 8.89MB → 6.76MB (sourcemap + stray images
      removed); the rest is runtime-required vendored render libs, deferred to
      the follow-up plan. No committed build artifacts remain ✔

## Files

`.github/workflows/main.yml`, `package.json`, `CHANGELOG.md`, `.vscodeignore`,
`src/services/InlineSuggestionService.ts`
