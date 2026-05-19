import { updateFrontmatterTools } from './tool-selector-modal';

let decoration: HTMLSpanElement | null = null;

export function isAgentFile(): boolean {
  const fileName =
    (window as any).currentDocumentFilename ||
    (window as any).__vditorCurrentFilename ||
    '';
  return fileName.toLowerCase().endsWith('.agent');
}

function parseToolsFromFrontmatter(content: string): string[] | null {
  const match = content.match(/^---[\r\n]+([\s\S]*?)[\r\n]+---/);
  if (!match) return null;

  const yaml = match[1];
  if (!yaml.match(/^tools\s*:/m)) return null;

  const inline = yaml.match(/^tools\s*:\s*\[([^\]]*)\]/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((t) => t.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }

  const block = yaml.match(/^tools\s*:\s*[\r\n]((?:[ \t]+-[ \t]*.+[\r\n]?)*)/m);
  if (block) {
    return block[1]
      .split('\n')
      .map((line) => line.replace(/^\s*-\s*/, '').replace(/["']/g, '').trim())
      .filter(Boolean);
  }

  return [];
}

function ensureStyles(): void {
  if (document.getElementById('tool-selector-styles')) return;
  const style = document.createElement('style');
  style.id = 'tool-selector-styles';
  style.textContent = `
    [data-tool-selector-widget] {
      display: block;
      font-size: 10px;
      color: var(--vscode-textLink-foreground, #3794ff);
      cursor: pointer;
      user-select: none;
      pointer-events: auto;
      font-style: italic;
      margin: 0;
      padding: 0;
      border: none;
      outline: none;
      background: none;
      line-height: 1.4;
    }
    [data-tool-selector-widget]:hover {
      text-decoration: underline;
      color: var(--vscode-textLink-activeForeground, #3794ff);
    }
  `;
  document.head.appendChild(style);
}

function findToolsInsertionPoint(): { node: Text; offset: number } | null {
  const vditorReset = document.querySelector('.vditor-ir .vditor-reset');
  if (!vditorReset) return null;

  const frontmatterEl = vditorReset.querySelector('[data-type="yaml-front-matter"]');
  if (!frontmatterEl) return null;

  const walker = document.createTreeWalker(frontmatterEl, NodeFilter.SHOW_TEXT, null);
  let textNode: Text | null;

  while ((textNode = walker.nextNode() as Text)) {
    const text = textNode.textContent || '';
    const match = /\n([ \t]*tools\s*:)/.exec(text);
    if (match && match.index !== undefined) {
      return { node: textNode, offset: match.index + 1 };
    }
  }

  return null;
}

function insertDecoration(retries = 4): void {
  if (!decoration) return;

  const pos = findToolsInsertionPoint();
  if (!pos) {
    if (retries > 0) setTimeout(() => insertDecoration(retries - 1), 150);
    return;
  }

  const { node, offset } = pos;
  const parent = node.parentNode;
  if (!parent) return;

  const after = node.splitText(offset);
  parent.insertBefore(decoration, after);

  if (retries > 0) {
    setTimeout(() => {
      if (decoration && !decoration.isConnected) insertDecoration(retries - 1);
    }, 100);
  }
}

function mountDecoration(): void {
  if (decoration && decoration.isConnected) return;

  decoration = null;
  ensureStyles();

  decoration = document.createElement('span');
  decoration.setAttribute('contenteditable', 'false');
  decoration.setAttribute('data-tool-selector-widget', 'true');
  decoration.textContent = '⚙ Configure Tools…';

  decoration.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  decoration.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const content = (window as any).vditor?.getValue?.() ?? '';
    const selectedTools = parseToolsFromFrontmatter(content) ?? [];
    (window as any).vscode?.postMessage({ command: 'openNativeToolSelector', selectedTools });
  });

  requestAnimationFrame(() => insertDecoration());
}

function unmountDecoration(): void {
  decoration?.remove();
  decoration = null;
}

export function removeDecorationElement(): void {
  unmountDecoration();
}

export function updateToolSelectorDecoration(): void {
  if (!isAgentFile()) {
    unmountDecoration();
    return;
  }

  const content: string = (window as any).vditor?.getValue?.() ?? '';
  const tools = parseToolsFromFrontmatter(content);

  if (tools === null) {
    unmountDecoration();
    return;
  }

  mountDecoration();
}

// Writes the new tool selection into the frontmatter and refreshes the decoration.
export function applySelectedTools(tools: string[]): void {
  const vditor = (window as any).vditor;
  if (!vditor) return;

  const content: string = vditor.getValue();
  const updated = updateFrontmatterTools(content, tools);

  vditor.setValue(updated);
  (window as any).vscode?.postMessage({ command: 'edit', content: updated });

  setTimeout(() => updateToolSelectorDecoration(), 150);
}

export function initToolSelector(): void {
  unmountDecoration();
  if (!isAgentFile()) return;
  updateToolSelectorDecoration();
}
