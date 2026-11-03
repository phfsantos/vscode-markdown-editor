# Release Identity and Packaging Gates Implementation Plan

> Execute with the `executing-plans` skill, task by task.

**Goal:** Make a release reproducible from one validated version tag and one verified VSIX, without accidental bumps or stale success claims.
**Architecture:** Validate release identity before installation/publishing; use the existing build/test commands and reuse the same packaged artifact for both registries. Retire the legacy auto-bump/push shortcut rather than creating another publishing path.
**Tech Stack:** GitHub Actions, Node.js, Yarn, Foy, Vitest, VSCE, HaaLeo/publish-vscode-extension.

## Confirmed problems and boundaries

- `.github/workflows/main.yml` publishes on **any tag** and does not check tag versus manifest version.
- `package.json`'s `pub` script builds, bumps patch, pushes `master` plus tags, then packages/publishes separately. It can race or disagree with tag-driven CI.
- Manifest version is 0.5.11; README advertises 0.4.7; changelog begins at 0.5.0 Unreleased; publishing checklist is prechecked for 0.4.7.
- CI already runs lint, `yarn test` (including type checks/core/unit/widgets), and browser tests. Preserve these gates and the existing Open VSX-first, Marketplace-second same-VSIX reuse.
- No publication or registry authentication occurs while implementing this plan unless separately authorized. Never print credentials.
- Existing ProjectMind plan `plan-1783416375809-d1rwgm` overlaps the `pub` cleanup. Update its evidence when executing, rather than implementing the same task twice.

## File structure first

| File | Responsibility |
|---|---|
| `scripts/verify-release.cjs` (new) | Pure tag/version validation plus a small CLI wrapper |
| `test/release-metadata.test.ts` (new) | Validator cases and workflow/script wiring checks |
| `.github/workflows/main.yml` | Tag filter, early validation, existing gates/publish ordering |
| `package.json` | Remove legacy `pub` script |
| `PUBLISHING_CHECKLIST.md` | One documented build/package/release path and artifact smoke checks |
| `CHANGELOG.md` | Accurate prospective release entry, coordinated with branding docs |
| `.vscodeignore` | Change only if actual packaged-file inspection demonstrates a problem |

## Task 1: Write a failing release-validator contract

**Owner:** qa. **Skill:** tdd.
**Files:** new validator/test files.

- [ ] Export `verifyReleaseTag(tag, version)` from the CommonJS validator module. It returns normally only for `tag === 'v' + version` and throws a clear error otherwise.
- [ ] In the test, use Node's `createRequire(import.meta.url)` to load the CommonJS export. Add these cases before implementation:

```ts
expect(() => verifyReleaseTag('v0.5.11', '0.5.11')).not.toThrow();
expect(() => verifyReleaseTag('v0.5.12', '0.5.11')).toThrow();
expect(() => verifyReleaseTag('0.5.11', '0.5.11')).toThrow();
expect(() => verifyReleaseTag('backup', '0.5.11')).toThrow();
expect(() => verifyReleaseTag('', '0.5.11')).toThrow();
```

- [ ] Add a CLI test with `spawnSync(process.execPath, ['scripts/verify-release.cjs'], { env: { ...process.env, GITHUB_REF_NAME: 'backup' } })`: expect nonzero exit and a diagnostic naming tag and manifest version.
- [ ] Add the successful CLI case using `v${manifest.version}`, read from the real manifest rather than a fixed version.
- [ ] Run `yarn vitest run test/release-metadata.test.ts` and confirm failure due to the missing validator.

## Task 2: Implement validation and wire the existing release job

**Owner:** devops/code. **Skill:** tdd; workflow edits are configuration exceptions.
**Files:** validator, workflow, manifest, metadata tests.

- [ ] Implement the pure validator with exact string comparison and an error identifying expected and actual tags. The CLI reads `package.json` from `__dirname/..`, consumes `GITHUB_REF_NAME`, and exits nonzero on error.
- [ ] Keep imports side-effect-free with `require.main === module`; no registry/network calls in the validator.
- [ ] Change the push tag filter to `v*`; the validator supplies exact manifest matching, since glob filtering is not semantic-version validation.
- [ ] Add `node scripts/verify-release.cjs` after checkout/setup-node and before dependency installation or any registry operation.
- [ ] Preserve frozen-lockfile installation, browser runtime installation, lint, test, browser test, Open VSX publish, and Marketplace reuse of `publishToOpenVSX.outputs.vsixPath`.
- [ ] Remove `scripts.pub` from `package.json`; do not replace it with another automatic version/tag/push command.
- [ ] Add workflow wiring assertions: validation precedes Install; the tag filter is `v*`; both registry steps follow tests; Marketplace consumes the exact Open VSX artifact; `scripts.pub` is absent. These protect the config wiring, not remote service behavior.
- [ ] Run `yarn vitest run test/release-metadata.test.ts test/package-layout.test.js`.

## Task 3: Verify artifact contents and document a repeatable release

**Owner:** devops/qa. **Skill:** test-generation; checklist edits are non-behavioral.
**Files:** checklist; ignore rules only if evidence requires them.

- [ ] Check for an installed VSCE executable before choosing packaging commands. The planning inspection found no `node_modules/.bin/vsce`. If neither local nor global tooling exists, add a compatible dev-only `@vscode/vsce` dependency and update the Yarn lockfile before installation; keep CI and documentation using a reproducible version.
- [ ] Run `yarn lint`, `yarn test`, `yarn test:browser`, and `yarn package`. Use `yarn playwright install --with-deps chromium` only when browser runtime installation is actually required.
- [ ] With the chosen VSCE tooling, run `vsce ls` and `vsce package --out markdown-studio-release.vsix` from the repository root. Do not overwrite an existing artifact; archive it first if that filename already exists. `yarn vsce` may be used if VSCE was added locally.
- [ ] Inspect archive entries with `unzip -l`; extract individual manifest/README/logo files with `unzip -p`. Verify extension entry point, built media/widgets, icon, and README assets, and no sources/maps/secrets accidentally included.
- [ ] Check rewritten README image URLs and their accessibility. Existing screenshot/GIF exclusions are not automatically bugs: VSCE may rewrite them to GitHub URLs. Include required local assets or correct stable public URLs only if the built README demonstrates a broken reference.
- [ ] Record VSIX byte size as evidence; do not impose the obsolete sub-3MB target or remove runtime renderers merely to meet it.
- [ ] Require a matching changelog entry for the chosen release version before publication, verified from actual history. Do not claim 0.5.1-0.5.11 were published merely because local VSIX files exist.
- [ ] Replace the checklist's unconditional success marks with fresh checks for tag/version equality, test results, artifact contents, clean-profile installation, upgrade behavior, and registry listing inspection.
- [ ] Document that an authorized release uses a deliberately chosen version and matching `v<version>` tag, and that the same VSIX goes to both registries. Do not run those outward-facing actions as a local smoke test.

## Acceptance criteria

- [ ] Nonmatching, unprefixed, missing, and unrelated tags fail validation before publishing; matching tags pass.
- [ ] The legacy `pub` path no longer bumps versions or pushes tags.
- [ ] Existing type/core/unit/widget/browser gates remain in the release workflow.
- [ ] Marketplace receives the exact VSIX produced for Open VSX.
- [ ] Packaged manifest, README, icon, runtime bundles, and media links pass inspection.
- [ ] Fresh build/test evidence and an installed-VSIX smoke test are recorded; actual remote publication remains pending until authorized and observed.

**Dependencies:** This automation improvement can ship independently. Coordinate manifest/docs edits with [the branding plan](./markdown-studio-release-consistency.md); execute shared-file tasks sequentially.

**Planning completion:** Inspected existing scripts, workflow, ignore rules, and release documents; defined a safe validator and packaging checks. No workflow, dependency, release version, tag, registry, or implementation was changed.
