export interface AIMarkdownWebviewState {
  isAIMarkdown: boolean;
  kind: string;
  badgeLabel: string;
  description: string;
  suggestedSections: string[];
  relativePath: string;
  hasPendingChatEdits: boolean;
  availability: {
    enabled: boolean;
    affordancesEnabled: boolean;
    chatInteropEnabled: boolean;
    provider: string;
    providerInstalled: boolean;
    status: string;
    statusLabel: string;
    detail: string;
  };
}

interface AIMarkdownMessageTarget {
  postMessage(message: any): void;
}

let rootElement: HTMLDivElement | null = null;
let styleElement: HTMLStyleElement | null = null;
let noticeTimeout: number | undefined;
let isExpanded = false;

function ensureStyleElement(): void {
  if (styleElement) {
    return;
  }

  styleElement = document.createElement('style');
  styleElement.textContent = `
    #ai-markdown-panel {
      position: fixed;
      right: 20px;
      bottom: 20px;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      width: min(360px, calc(100vw - 32px));
      max-width: calc(100vw - 32px);
      z-index: 1200;
      pointer-events: none;
    }

    #ai-markdown-panel[data-expanded="true"] {
      width: min(360px, calc(100vw - 32px));
    }

    .ai-markdown-launcher,
    .ai-markdown-shell,
    .ai-markdown-notice {
      pointer-events: auto;
      background: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      border: 1px solid var(--vscode-panel-border, var(--vscode-editorWidget-border, rgba(127, 127, 127, 0.35)));
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    }

    .ai-markdown-launcher {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 44px;
      height: 44px;
      border-radius: 999px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      transition: transform 120ms ease, background 120ms ease;
    }

    .ai-markdown-launcher:hover {
      background: var(--vscode-button-hoverBackground);
      transform: translateY(-1px);
    }

    .ai-markdown-launcher:focus-visible,
    .ai-markdown-button:focus-visible,
    .ai-markdown-close:focus-visible {
      outline: 2px solid var(--vscode-focusBorder, var(--vscode-button-background));
      outline-offset: 2px;
    }

    .ai-markdown-launcher-icon {
      font-size: 18px;
      line-height: 1;
    }

    .ai-markdown-shell {
      width: 100%;
      border-radius: 14px;
      overflow: hidden;
    }

    .ai-markdown-header {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .ai-markdown-header-row {
      display: flex;
      gap: 8px;
      justify-content: space-between;
      align-items: flex-start;
    }

    .ai-markdown-heading {
      min-width: 0;
      flex: 1;
    }

    .ai-markdown-close {
      appearance: none;
      border: 0;
      background: transparent;
      color: var(--vscode-icon-foreground, var(--vscode-editor-foreground));
      border-radius: 6px;
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      flex: 0 0 auto;
    }

    .ai-markdown-close:hover {
      background: var(--vscode-toolbar-hoverBackground, rgba(127, 127, 127, 0.12));
    }

    .ai-markdown-badge,
    .ai-markdown-chip {
      display: inline-flex;
      align-items: center;
      border-radius: 999px;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .ai-markdown-badge {
      width: fit-content;
      background: var(--vscode-badge-background, var(--vscode-button-background));
      color: var(--vscode-badge-foreground, var(--vscode-button-foreground));
    }

    .ai-markdown-chip {
      margin-top: 2px;
      background: rgba(204, 167, 0, 0.18);
      color: var(--vscode-editorWarning-foreground, #cca700);
    }

    .ai-markdown-title {
      font-weight: 600;
      color: var(--vscode-editor-foreground);
      word-break: break-word;
    }

    .ai-markdown-description,
    .ai-markdown-status,
    .ai-markdown-sections,
    .ai-markdown-notice {
      color: var(--vscode-descriptionForeground, var(--vscode-editor-foreground));
      font-size: 12px;
      line-height: 1.45;
    }

    .ai-markdown-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      padding: 0 12px 12px;
      pointer-events: auto;
    }

    .ai-markdown-button {
      appearance: none;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-secondaryBackground, var(--vscode-button-background));
      color: var(--vscode-button-secondaryForeground, var(--vscode-button-foreground));
      border-radius: 8px;
      min-height: 34px;
      padding: 6px 10px;
      font-size: 12px;
      cursor: pointer;
      text-align: left;
    }

    .ai-markdown-button:hover {
      background: var(--vscode-button-secondaryHoverBackground, var(--vscode-button-hoverBackground));
    }

    .ai-markdown-button-primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .ai-markdown-button-primary:hover {
      background: var(--vscode-button-hoverBackground);
    }

    .ai-markdown-notice {
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
    }

    .ai-markdown-notice[data-level="warning"] {
      border-color: var(--vscode-editorWarning-border, var(--vscode-editorWarning-foreground, #cca700));
    }

    .ai-markdown-notice[data-level="error"] {
      border-color: var(--vscode-editorError-border, var(--vscode-errorForeground, #f14c4c));
    }

    @media (max-width: 640px) {
      #ai-markdown-panel {
        right: 12px;
        bottom: 12px;
        width: min(100vw - 24px, 360px);
        max-width: min(100vw - 24px, 360px);
      }

      .ai-markdown-actions {
        grid-template-columns: 1fr;
      }
    }
  `;
  document.head.appendChild(styleElement);
}

function ensureRootElement(): HTMLDivElement {
  ensureStyleElement();

  if (rootElement) {
    return rootElement;
  }

  rootElement = document.createElement('div');
  rootElement.id = 'ai-markdown-panel';
  rootElement.dataset.expanded = String(isExpanded);
  document.body.appendChild(rootElement);
  return rootElement;
}

function removeRootElement(): void {
  if (!rootElement) {
    return;
  }

  rootElement.remove();
  rootElement = null;
}

function createButton(
  label: string,
  action: string,
  target: AIMarkdownMessageTarget,
  emphasis: 'default' | 'primary' = 'default'
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `ai-markdown-button${emphasis === 'primary' ? ' ai-markdown-button-primary' : ''}`;
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', () => {
    target.postMessage({ command: 'requestAiAction', action });
  });
  return button;
}

function renderCollapsedLauncher(root: HTMLDivElement): void {
  const launcher = document.createElement('button');
  launcher.type = 'button';
  launcher.className = 'ai-markdown-launcher';
  launcher.setAttribute('aria-label', 'Open AI markdown tools');
  launcher.setAttribute('aria-expanded', 'false');
  launcher.title = 'Open AI markdown tools';
  launcher.innerHTML = '<span class="ai-markdown-launcher-icon" aria-hidden="true">🛠️</span>';
  launcher.addEventListener('click', () => {
    isExpanded = true;
    root.dataset.expanded = 'true';
    const state = (root as any).__aiState as AIMarkdownWebviewState | undefined;
    const target = (root as any).__aiTarget as AIMarkdownMessageTarget | undefined;
    if (state && target) {
      updateAIMarkdownUI(state, target);
    }
  });
  root.appendChild(launcher);
}

function setNotice(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  const root = ensureRootElement();
  let notice = root.querySelector('.ai-markdown-notice') as HTMLDivElement | null;
  if (!notice) {
    notice = document.createElement('div');
    notice.className = 'ai-markdown-notice';
    root.appendChild(notice);
  }

  notice.textContent = message;
  notice.setAttribute('data-level', level);

  if (noticeTimeout) {
    window.clearTimeout(noticeTimeout);
  }

  noticeTimeout = window.setTimeout(() => {
    notice?.remove();
  }, 4200);
}

export function updateAIMarkdownUI(
  state: AIMarkdownWebviewState | undefined,
  target: AIMarkdownMessageTarget
): void {
  if (!state?.isAIMarkdown || !state.availability?.affordancesEnabled) {
    removeRootElement();
    return;
  }

  const root = ensureRootElement();
  (root as any).__aiState = state;
  (root as any).__aiTarget = target;
  root.dataset.expanded = String(isExpanded);
  root.innerHTML = '';

  if (!isExpanded) {
    renderCollapsedLauncher(root);
    return;
  }

  const shell = document.createElement('section');
  shell.className = 'ai-markdown-shell';
  shell.setAttribute('aria-label', 'AI markdown tools');

  const header = document.createElement('div');
  header.className = 'ai-markdown-header';

  const row = document.createElement('div');
  row.className = 'ai-markdown-header-row';

  const heading = document.createElement('div');
  heading.className = 'ai-markdown-heading';

  const badge = document.createElement('span');
  badge.className = 'ai-markdown-badge';
  badge.textContent = state.badgeLabel || 'AI Markdown';

  const title = document.createElement('div');
  title.className = 'ai-markdown-title';
  title.textContent = state.relativePath || state.badgeLabel || 'AI Markdown';

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ai-markdown-close';
  closeButton.setAttribute('aria-label', 'Collapse AI markdown tools');
  closeButton.title = 'Collapse AI markdown tools';
  closeButton.innerHTML = '<span aria-hidden="true">×</span>';
  closeButton.addEventListener('click', () => {
    isExpanded = false;
    root.dataset.expanded = 'false';
    updateAIMarkdownUI(state, target);
  });

  heading.appendChild(badge);
  heading.appendChild(title);
  row.appendChild(heading);
  row.appendChild(closeButton);

  const description = document.createElement('div');
  description.className = 'ai-markdown-description';
  description.textContent = state.description || state.availability.statusLabel;

  const availability = document.createElement('div');
  availability.className = 'ai-markdown-status';
  availability.textContent = `${state.availability.statusLabel} ${state.availability.detail}`.trim();

  header.appendChild(row);
  header.appendChild(description);
  header.appendChild(availability);

  if (state.hasPendingChatEdits) {
    const pending = document.createElement('div');
    pending.className = 'ai-markdown-chip';
    pending.textContent = 'Pending AI edits detected in the current file.';
    header.appendChild(pending);
  }

  if (state.suggestedSections?.length) {
    const sections = document.createElement('div');
    sections.className = 'ai-markdown-sections';
    sections.textContent = `Suggested sections: ${state.suggestedSections.join(' · ')}`;
    header.appendChild(sections);
  }

  const actions = document.createElement('div');
  actions.className = 'ai-markdown-actions';
  actions.appendChild(createButton('Copy Context', 'copyContext', target, 'primary'));
  actions.appendChild(createButton('Insert Context', 'insertContext', target));
  actions.appendChild(createButton('Insert Template', 'insertTemplate', target));
  actions.appendChild(createButton('Open Chat', 'openChat', target));
  actions.appendChild(createButton('Open Graph', 'openGraph', target));
  actions.appendChild(createButton('Validate', 'validate', target));

  shell.appendChild(header);
  shell.appendChild(actions);
  root.appendChild(shell);
}

export function handleAIMarkdownActionResult(message: {
  message?: string;
  level?: 'info' | 'warning' | 'error';
}): void {
  if (!message?.message) {
    return;
  }

  setNotice(message.message, message.level || 'info');
}
