import { describe, expect, it, vi } from 'vitest';

type Disposable = { dispose(): void };

type RuntimeOptions = {
  diffCoordinator: Disposable;
  editorNavigation: Disposable;
  activeDocument: Disposable;
  relationshipAnalyzer: Disposable;
  disposables: Disposable[];
};

type RuntimeConstructor = new (options: RuntimeOptions) => Disposable;

async function loadRuntimeConstructor(): Promise<RuntimeConstructor> {
  const runtimeModule = (await import('../src/runtime/ExtensionRuntime')) as {
    ExtensionRuntime?: RuntimeConstructor;
  };

  if (typeof runtimeModule.ExtensionRuntime !== 'function') {
    throw new Error('ExtensionRuntime must be exported as a public class');
  }

  return runtimeModule.ExtensionRuntime;
}

function disposable() {
  return { dispose: vi.fn() };
}

function runtimeOptions() {
  return {
    diffCoordinator: disposable(),
    editorNavigation: disposable(),
    activeDocument: disposable(),
    relationshipAnalyzer: disposable(),
    disposables: [disposable(), disposable()],
  } satisfies RuntimeOptions;
}

describe('ExtensionRuntime public lifecycle', () => {
  it('disposes every runtime-owned port and registration exactly once', async () => {
    const ExtensionRuntime = await loadRuntimeConstructor();
    const options = runtimeOptions();
    const runtime = new ExtensionRuntime(options);

    runtime.dispose();
    runtime.dispose();

    expect(options.diffCoordinator.dispose).toHaveBeenCalledOnce();
    expect(options.editorNavigation.dispose).toHaveBeenCalledOnce();
    expect(options.activeDocument.dispose).toHaveBeenCalledOnce();
    expect(options.relationshipAnalyzer.dispose).toHaveBeenCalledOnce();
    options.disposables.forEach((registration) => {
      expect(registration.dispose).toHaveBeenCalledOnce();
    });
  });

  it('does not dispose resources owned by a different activation runtime', async () => {
    const ExtensionRuntime = await loadRuntimeConstructor();
    const first = runtimeOptions();
    const second = runtimeOptions();
    const firstRuntime = new ExtensionRuntime(first);
    const secondRuntime = new ExtensionRuntime(second);

    firstRuntime.dispose();

    expect(second.diffCoordinator.dispose).not.toHaveBeenCalled();
    expect(second.editorNavigation.dispose).not.toHaveBeenCalled();
    expect(second.activeDocument.dispose).not.toHaveBeenCalled();
    expect(second.relationshipAnalyzer.dispose).not.toHaveBeenCalled();
    second.disposables.forEach((registration) => {
      expect(registration.dispose).not.toHaveBeenCalled();
    });

    secondRuntime.dispose();
  });
});
