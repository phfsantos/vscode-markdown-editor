export interface ChatAnchorWebviewState {
  visible: boolean;
  relativePath: string;
}

interface ChatAnchorMessageTarget {
  postMessage(message: any): void;
}

let chatAnchorRoot: HTMLDivElement | null = null;
let chatAnchorStyle: HTMLStyleElement | null = null;

function ensureChatAnchorStyle(): void {
  if (chatAnchorStyle) {
    return;
  }

  chatAnchorStyle = document.createElement('style');
  chatAnchorStyle.textContent = `
    #markdown-editor-chat-anchor {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 1190;
      pointer-events: none;
    }

    .markdown-editor-chat-anchor-button {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 999px;
      min-height: 36px;
      padding: 0 14px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      font-size: 12px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    }

    .markdown-editor-chat-anchor-button:hover {
      background: var(--vscode-button-hoverBackground);
    }
  `;
  document.head.appendChild(chatAnchorStyle);
}

function ensureChatAnchorRoot(): HTMLDivElement {
  ensureChatAnchorStyle();

  if (chatAnchorRoot) {
    return chatAnchorRoot;
  }

  chatAnchorRoot = document.createElement('div');
  chatAnchorRoot.id = 'markdown-editor-chat-anchor';
  document.body.appendChild(chatAnchorRoot);
  return chatAnchorRoot;
}

function removeChatAnchorRoot(): void {
  if (!chatAnchorRoot) {
    return;
  }

  chatAnchorRoot.remove();
  chatAnchorRoot = null;
}

export function updateChatAnchorUI(
  state: ChatAnchorWebviewState | undefined,
  target: ChatAnchorMessageTarget
): void {
  if (!state?.visible) {
    removeChatAnchorRoot();
    return;
  }

  const root = ensureChatAnchorRoot();
  root.innerHTML = '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'markdown-editor-chat-anchor-button';
  button.setAttribute('aria-label', 'Add markdown file to chat');
  button.title = state.relativePath
    ? `Add ${state.relativePath} to chat`
    : 'Add markdown file to chat';
  button.innerHTML = '<span class="codicon codicon-comment-discussion" aria-hidden="true"></span><span>Add to Chat</span>';
  button.addEventListener('click', () => {
    target.postMessage({ command: 'requestAddToChat' });
  });

  root.appendChild(button);
}
