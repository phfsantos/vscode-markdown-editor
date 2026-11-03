import { describe, expect, it, vi } from 'vitest';
import {
  authorizeWidgetCommand,
  type WidgetCommandPolicyPorts,
} from '../src/app/widgetCommandPolicy';

function ports(overrides: Partial<WidgetCommandPolicyPorts> = {}): WidgetCommandPolicyPorts {
  return {
    isWorkspaceTrusted: () => true,
    allowedCommands: () => [],
    confirm: vi.fn(async () => undefined),
    allowAlways: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('widget command policy', () => {
  it('denies every widget command in an untrusted workspace without prompting', async () => {
    const policy = ports({ isWorkspaceTrusted: () => false, allowedCommands: () => ['workbench.action.openSettings'] });

    await expect(authorizeWidgetCommand('workbench.action.openSettings', [], policy)).resolves.toBe('untrusted');
    expect(policy.confirm).not.toHaveBeenCalled();
  });

  it('denies a command that is not allowlisted when the user dismisses the confirmation', async () => {
    const policy = ports();

    await expect(authorizeWidgetCommand('workbench.action.terminal.sendSequence', [{ text: 'rm -rf ~\n' }], policy))
      .resolves.toBe('declined');
    expect(policy.confirm).toHaveBeenCalledWith({
      command: 'workbench.action.terminal.sendSequence',
      args: [{ text: 'rm -rf ~\n' }],
      canAlwaysAllow: false,
    });
  });

  it('runs an allowlisted command without args without prompting', async () => {
    const policy = ports({ allowedCommands: () => ['workbench.action.openSettings'] });

    await expect(authorizeWidgetCommand('workbench.action.openSettings', [], policy)).resolves.toBe('allowed');
    expect(policy.confirm).not.toHaveBeenCalled();
  });

  it('still confirms an allowlisted command when the document supplies args', async () => {
    const policy = ports({ allowedCommands: () => ['workbench.action.openSettings'] });

    await expect(authorizeWidgetCommand('workbench.action.openSettings', ['editor.fontSize'], policy))
      .resolves.toBe('declined');
    expect(policy.confirm).toHaveBeenCalledOnce();
  });

  it('runs a confirmed command once without changing the allowlist', async () => {
    const policy = ports({ confirm: vi.fn(async () => 'run' as const) });

    await expect(authorizeWidgetCommand('git.push', [], policy)).resolves.toBe('allowed');
    expect(policy.allowAlways).not.toHaveBeenCalled();
  });

  it('adds an argument-free command to the allowlist when the user chooses always allow', async () => {
    const policy = ports({ confirm: vi.fn(async () => 'always' as const) });

    await expect(authorizeWidgetCommand('git.push', [], policy)).resolves.toBe('allowed');
    expect(policy.confirm).toHaveBeenCalledWith({ command: 'git.push', args: [], canAlwaysAllow: true });
    expect(policy.allowAlways).toHaveBeenCalledWith('git.push');
  });

  it('rejects malformed command ids without prompting', async () => {
    const policy = ports();

    await expect(authorizeWidgetCommand('', [], policy)).resolves.toBe('declined');
    await expect(authorizeWidgetCommand('has spaces; rm', [], policy)).resolves.toBe('declined');
    expect(policy.confirm).not.toHaveBeenCalled();
  });
});
