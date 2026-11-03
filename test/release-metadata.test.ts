import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(__dirname, '..');
const validatorPath = path.join(rootDir, 'scripts', 'verify-release.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
const workflow = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'main.yml'), 'utf8');

describe('verifyReleaseTag', () => {
  const { verifyReleaseTag } = require(validatorPath) as {
    verifyReleaseTag: (tag: string, version: string) => void;
  };

  it('accepts only v<manifest version>', () => {
    expect(() => verifyReleaseTag('v0.5.11', '0.5.11')).not.toThrow();
  });

  it.each(['v0.5.12', '0.5.11', 'backup', ''])('rejects tag %j for version 0.5.11', (tag) => {
    expect(() => verifyReleaseTag(tag, '0.5.11')).toThrow(/v0\.5\.11/);
  });
});

describe('verify-release CLI', () => {
  const run = (tag: string) =>
    spawnSync(process.execPath, [validatorPath], {
      env: { ...process.env, GITHUB_REF_NAME: tag },
      encoding: 'utf8',
    });

  it('fails for an unrelated tag and names both values', () => {
    const result = run('backup');

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('backup');
    expect(result.stderr).toContain(`v${manifest.version}`);
  });

  it('passes for the tag matching the manifest version', () => {
    expect(run(`v${manifest.version}`).status).toBe(0);
  });
});

describe('release workflow wiring', () => {
  const stepIndex = (name: string) => {
    const index = workflow.indexOf(name);
    expect(index, name).toBeGreaterThan(-1);
    return index;
  };

  it('only triggers on v-prefixed tags', () => {
    expect(workflow).toMatch(/tags:\s*\n\s*- "v\*"/);
  });

  it('validates the tag before installing or publishing', () => {
    expect(stepIndex('node scripts/verify-release.cjs')).toBeLessThan(stepIndex('yarn --frozen-lockfile'));
  });

  it('publishes both registries after every test gate, reusing one VSIX', () => {
    const lastGate = Math.max(stepIndex('yarn lint'), stepIndex('yarn test\n'), stepIndex('yarn test:browser'));
    expect(lastGate).toBeLessThan(stepIndex('Publish to Open VSX Registry'));
    expect(stepIndex('Publish to Open VSX Registry')).toBeLessThan(stepIndex('Publish to Visual Studio Marketplace'));
    expect(workflow).toContain('extensionFile: ${{ steps.publishToOpenVSX.outputs.vsixPath }}');
  });

  it('has no legacy auto-bump-and-push publish script', () => {
    expect(manifest.scripts.pub).toBeUndefined();
  });
});
