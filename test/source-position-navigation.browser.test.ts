import { afterEach, expect, test, vi } from 'vitest';
import { SourcePositionNavigationController } from '../packages/media/src/source-position-navigation';

afterEach(() => {
  document.querySelector('.vditor-ir')?.remove();
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

function mountEditor(html = '<p>First</p><p>Second</p>'): HTMLElement {
  const host = document.createElement('div');
  host.className = 'vditor-ir';
  host.innerHTML = `<div class="vditor-reset" contenteditable="true">${html}</div>`;
  document.body.append(host);
  return host.firstElementChild as HTMLElement;
}

test('reveals the mapped block and places an exact collapsed caret without changing content', async () => {
  const root = mountEditor();
  const target = root.querySelectorAll<HTMLElement>('p')[1];
  const before = root.innerHTML;
  const scrollIntoView = vi.fn();
  const animation = { cancel: vi.fn() } as unknown as Animation;
  const animate = vi.fn(() => animation);
  target.scrollIntoView = scrollIntoView;
  target.animate = animate;

  const controller = new SourcePositionNavigationController({
    getMarkdown: () => 'First\n\nSecond',
    requestFrame: async () => undefined,
    matchMedia: () => ({ matches: false } as MediaQueryList),
  });
  const result = await controller.reveal({
    position: { line: 2, character: 3 },
    reveal: 'center',
    highlight: true,
    origin: 'command',
  });

  expect(result.status).toBe('revealed');
  expect(result.match).toMatchObject({ renderedLine: 1, renderedCharacter: 3 });
  expect(window.getSelection()?.isCollapsed).toBe(true);
  expect(window.getSelection()?.anchorNode?.textContent).toBe('Second');
  expect(window.getSelection()?.anchorOffset).toBe(3);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
  expect(animate).toHaveBeenCalledOnce();
  expect(root.innerHTML).toBe(before);
});

test('uses nearest visible caret fallback and disables motion for reduced-motion users', async () => {
  const root = mountEditor('<p><strong>bold</strong></p>');
  const target = root.querySelector<HTMLElement>('p')!;
  const scrollIntoView = vi.fn();
  target.scrollIntoView = scrollIntoView;
  target.animate = vi.fn();

  const controller = new SourcePositionNavigationController({
    getMarkdown: () => '**bold**',
    requestFrame: async () => undefined,
    matchMedia: () => ({ matches: true } as MediaQueryList),
  });
  const result = await controller.reveal({
    position: { line: 0, character: 1 },
    reveal: 'center',
    highlight: true,
    origin: 'markdown-link',
  });

  expect(result.match).toMatchObject({ renderedCharacter: 0, confidence: 'nearest', reason: 'hidden-syntax' });
  expect(window.getSelection()?.anchorOffset).toBe(0);
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' });
  expect(target.animate).not.toHaveBeenCalled();
});

test('waits a bounded number of frames for the rendered editor', async () => {
  let frames = 0;
  const controller = new SourcePositionNavigationController({
    getMarkdown: () => 'Later',
    maxReadyFrames: 2,
    requestFrame: async () => {
      frames += 1;
      if (frames === 1) mountEditor('<p>Later</p>');
    },
    matchMedia: () => ({ matches: true } as MediaQueryList),
  });

  expect((await controller.reveal({
    position: { line: 0, character: 0 },
    reveal: 'center',
    highlight: false,
    origin: 'uri-handler',
  })).status).toBe('revealed');
  expect(frames).toBe(1);

  document.querySelector('.vditor-ir')?.remove();
  expect((await controller.reveal({
    position: { line: 0, character: 0 },
    reveal: 'center',
    highlight: false,
    origin: 'uri-handler',
  })).status).toBe('not-found');
  expect(frames).toBe(3);
});

test('cancels the previous transient highlight before starting another', async () => {
  const root = mountEditor('<p>Only</p>');
  const target = root.querySelector<HTMLElement>('p')!;
  target.scrollIntoView = vi.fn();
  const first = { cancel: vi.fn() } as unknown as Animation;
  const second = { cancel: vi.fn() } as unknown as Animation;
  target.animate = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const controller = new SourcePositionNavigationController({
    getMarkdown: () => 'Only',
    requestFrame: async () => undefined,
    matchMedia: () => ({ matches: false } as MediaQueryList),
  });
  const request = {
    position: { line: 0, character: 0 },
    reveal: 'center' as const,
    highlight: true,
    origin: 'command' as const,
  };

  await controller.reveal(request);
  await controller.reveal(request);

  expect(first.cancel).toHaveBeenCalledOnce();
});

test('maps a real multi-cell table row whose DOM text concatenates cells', async () => {
  const root = mountEditor('<table><tbody><tr><td>A</td><td>1</td></tr></tbody></table>');
  const before = root.innerHTML;
  const row = root.querySelector<HTMLTableRowElement>('tr')!;
  row.scrollIntoView = vi.fn();
  const controller = new SourcePositionNavigationController({
    getMarkdown: () => '| A | 1 |',
    requestFrame: async () => undefined,
    matchMedia: () => ({ matches: true } as MediaQueryList),
  });

  const result = await controller.reveal({
    position: { line: 0, character: 6 },
    reveal: 'center',
    highlight: false,
    origin: 'markdown-link',
  });

  expect(row.textContent).toBe('A1');
  expect(result.match).toMatchObject({ renderedLine: 0, renderedCharacter: 1, confidence: 'exact' });
  expect(root.innerHTML).toBe(before);
});

test('does not let an older delayed reveal overwrite a newer request', async () => {
  let releaseFirstFrame: (() => void) | undefined;
  const controller = new SourcePositionNavigationController({
    getMarkdown: () => 'Old\nNew',
    maxReadyFrames: 2,
    requestFrame: () => new Promise<void>(resolve => {
      releaseFirstFrame = resolve;
    }),
    matchMedia: () => ({ matches: true } as MediaQueryList),
  });
  const request = (line: number) => ({
    position: { line, character: 1 },
    reveal: 'center' as const,
    highlight: false,
    origin: 'command' as const,
  });

  const older = controller.reveal(request(0));
  await vi.waitFor(() => expect(releaseFirstFrame).toBeTypeOf('function'));
  const root = mountEditor('<p>Old</p><p>New</p>');
  root.querySelectorAll<HTMLElement>('p').forEach(element => { element.scrollIntoView = vi.fn(); });
  const newer = await controller.reveal(request(1));
  releaseFirstFrame?.();
  const stale = await older;

  expect(newer.status).toBe('revealed');
  expect(stale.status).toBe('superseded');
  expect(window.getSelection()?.anchorNode?.textContent).toBe('New');
  expect(window.getSelection()?.anchorOffset).toBe(1);
});
