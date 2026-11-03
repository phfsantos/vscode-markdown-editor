import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ButtonWidget } from '../ButtonWidget';
import type { IWidgetConfig } from '../../core/types';

function makeConfig(overrides: Record<string, unknown> = {}): IWidgetConfig {
  return { id: 'button-1', type: 'button', label: 'Run it', ...overrides } as unknown as IWidgetConfig;
}

function captureButtonActions() {
  const events: CustomEvent[] = [];
  const listener = (e: Event) => events.push(e as CustomEvent);
  document.addEventListener('button-action', listener);
  return { events, stop: () => document.removeEventListener('button-action', listener) };
}

describe('ButtonWidget vscode-command actions', () => {
  const postMessage = vi.fn();

  beforeEach(() => {
    (window as any).vscode = { postMessage };
  });

  afterEach(() => {
    delete (window as any).vscode;
    postMessage.mockReset();
  });

  it('emits one button-action carrying the command and args for the host bridge', async () => {
    const capture = captureButtonActions();
    render(
      <ButtonWidget
        config={makeConfig({
          actionType: 'vscode-command',
          action: 'open-settings',
          data: { command: 'workbench.action.openSettings', args: ['editor.fontSize'] },
        })}
        data={{}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run it/i }));
    });

    capture.stop();
    expect(capture.events).toHaveLength(1);
    expect(capture.events[0].detail).toMatchObject({
      actionType: 'vscode-command',
      action: 'open-settings',
      data: { command: 'workbench.action.openSettings', args: ['editor.fontSize'] },
      widgetId: 'button-1',
    });
  });

  it('does not post a second, off-protocol widget-action message itself', async () => {
    render(
      <ButtonWidget
        config={makeConfig({ actionType: 'vscode-command', data: { command: 'workbench.action.openSettings' } })}
        data={{}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /run it/i }));
    });

    expect(postMessage).not.toHaveBeenCalled();
  });
});
