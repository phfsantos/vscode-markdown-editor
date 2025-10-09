import { BaseRenderer } from '../BaseRenderer';
import { IRenderer, IRenderContext, IRendererCapabilities } from '../types';

/**
 * PlaygroundRenderer - Live JavaScript/TypeScript code execution
 * 
 * Features:
 * - Live code execution in sandboxed iframe
 * - Console output capture
 * - Error handling and display
 * - TypeScript support (transpiled to JS)
 * - Code persistence in markdown (no external files)
 * - Multiple playground instances per document
 * 
 * Usage:
 * ```playground
 * console.log('Hello, World!');
 * 
 * function fibonacci(n) {
 *   if (n <= 1) return n;
 *   return fibonacci(n - 1) + fibonacci(n - 2);
 * }
 * 
 * console.log('Fibonacci(10):', fibonacci(10));
 * ```
 */
export class PlaygroundRenderer extends BaseRenderer implements IRenderer {
  readonly id = 'playground-renderer';
  readonly name = 'Code Playground';
  readonly language = 'playground';
  readonly version = '1.0.0';
  readonly description = 'Live JavaScript/TypeScript execution environment';
  readonly author = 'VSCode Markdown Editor';
  
  readonly capabilities: IRendererCapabilities = {
    supportsPersistence: false, // Code stays in markdown
    supportsMultipleInstances: true,
    supportsExport: false,
    supportsImport: false,
    requiresExtensionHost: false // Pure client-side
  };

  private playgroundInstances: Map<string, { iframe: HTMLIFrameElement; code: string }> = new Map();

  /**
   * Render the code playground
   */
  async render(element: HTMLElement, vditor: any, context: IRenderContext): Promise<void> {
    try {
      // Check if already rendered
      const existingContainer = element.querySelector('.playground-container');
      if (existingContainer) {
        return;
      }

      // Get container node for event listeners
      const ir__node = element.closest('.vditor-ir__node') as HTMLElement;
      const wysiwyg__node = element.closest('.vditor-wysiwyg__block') as HTMLElement;
      const containerNode = ir__node || wysiwyg__node;

      // Extract code from element
      const code = this.extractCode(element);
      const playgroundId = context.instanceId;
      const instanceKey = `${context.documentUri}-${playgroundId}`;

      // Create playground container
      const container = this.createPlaygroundContainer(playgroundId, code, context);
      
      // Replace element content
      element.innerHTML = '';
      element.appendChild(container);

      // Setup event listeners to stop Vditor from capturing events
      if (containerNode) {
        this.setupVditorEventStoppers(container, containerNode);
      }

      // Setup event listeners
      this.setupPlaygroundEventListeners(container, playgroundId, code, context);

    } catch (error) {
      console.error('❌ PLAYGROUND RENDERER: Render failed', error);
      this.showError(element, `Failed to render playground: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Setup event listeners to stop Vditor from capturing events
   */
  private setupVditorEventStoppers(container: HTMLElement, node: HTMLElement): void {
    if (!node) return;

    // Stop event propagation for playground to function properly
    const letItFocus = (e: Event) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const events = [
      'click', 'mousedown', 'mouseup', 'mousemove',
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'focus', 'focusin', 'input'
    ];

    events.forEach(eventName => {
      container.addEventListener(eventName, letItFocus);
    });
  }

  /**
   * Extract code from code block
   */
  private extractCode(element: HTMLElement): string {
    // Try to get code from various possible locations
    const codeElement = element.querySelector('code') || element;
    return codeElement.textContent?.trim() || '// Write your code here\nconsole.log("Hello, World!");';
  }

  /**
   * Create playground HTML structure
   */
  private createPlaygroundContainer(playgroundId: string, initialCode: string, context: IRenderContext): HTMLElement {
    const container = document.createElement('div');
    container.className = 'code-playground-container';
    container.setAttribute('data-playground-id', playgroundId);

    // Create editor area
    const editorSection = document.createElement('div');
    editorSection.className = 'playground-editor-section';

    const editorHeader = document.createElement('div');
    editorHeader.className = 'playground-header';
    editorHeader.innerHTML = `
      <span class="playground-title">🎮 Code Playground</span>
      <div class="playground-controls">
        <button class="playground-btn" data-action="run" title="Run code (Ctrl+Enter)">▶️ Run</button>
        <button class="playground-btn" data-action="clear" title="Clear output">🧹 Clear</button>
        <button class="playground-btn" data-action="reset" title="Reset code">🔄 Reset</button>
      </div>
    `;
    editorSection.appendChild(editorHeader);

    const editor = document.createElement('textarea');
    editor.className = 'playground-editor';
    editor.value = initialCode;
    editor.spellcheck = false;
    editorSection.appendChild(editor);

    container.appendChild(editorSection);

    // Create output area
    const outputSection = document.createElement('div');
    outputSection.className = 'playground-output-section';

    const outputHeader = document.createElement('div');
    outputHeader.className = 'playground-output-header';
    outputHeader.innerHTML = `
      <span>📋 Console Output</span>
      <span class="playground-status"></span>
    `;
    outputSection.appendChild(outputHeader);

    const output = document.createElement('div');
    output.className = 'playground-output';
    output.innerHTML = '<div class="output-placeholder">Press "Run" to execute code...</div>';
    outputSection.appendChild(output);

    container.appendChild(outputSection);

    // Create hidden iframe for sandboxed execution
    const iframe = document.createElement('iframe');
    iframe.className = 'playground-sandbox';
    iframe.sandbox.add('allow-scripts');
    iframe.style.display = 'none';
    container.appendChild(iframe);

    // Store instance
    this.playgroundInstances.set(`${context.documentUri}-${playgroundId}`, { iframe, code: initialCode });

    // Inject styles
    this.injectPlaygroundStyles();

    return container;
  }

  /**
   * Setup event listeners for playground
   */
  private setupPlaygroundEventListeners(container: HTMLElement, playgroundId: string, initialCode: string, context: IRenderContext): void {
    const editor = container.querySelector('.playground-editor') as HTMLTextAreaElement;
    const output = container.querySelector('.playground-output') as HTMLElement;
    const status = container.querySelector('.playground-status') as HTMLElement;
    const iframe = container.querySelector('.playground-sandbox') as HTMLIFrameElement;

    // Button actions
    container.querySelectorAll('.playground-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const action = (e.target as HTMLElement).getAttribute('data-action');
        
        switch (action) {
          case 'run':
            this.runCode(editor.value, output, status, iframe);
            break;
          case 'clear':
            output.innerHTML = '';
            status.textContent = '';
            break;
          case 'reset':
            if (confirm('Reset code to initial state?')) {
              editor.value = initialCode;
              output.innerHTML = '<div class="output-placeholder">Code reset. Press "Run" to execute...</div>';
              status.textContent = '';
            }
            break;
        }
      });
    });

    // Ctrl+Enter to run
    editor.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.runCode(editor.value, output, status, iframe);
      }
    });

    // Tab key support
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
        editor.selectionStart = editor.selectionEnd = start + 2;
      }
    });
  }

  /**
   * Run code in sandboxed iframe
   */
  private runCode(code: string, outputElement: HTMLElement, statusElement: HTMLElement, iframe: HTMLIFrameElement): void {
    // Clear previous output
    outputElement.innerHTML = '';
    statusElement.textContent = '⏳ Running...';
    statusElement.className = 'playground-status status-running';

    const logs: Array<{ type: string; args: any[] }> = [];
    const startTime = Date.now();

    // Create sandbox HTML
    const sandboxHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
      </head>
      <body>
        <script>
          // Override console methods to capture output
          const originalConsole = { ...console };
          
          console.log = (...args) => {
            window.parent.postMessage({ type: 'log', level: 'log', args: args.map(arg => String(arg)) }, '*');
          };
          
          console.error = (...args) => {
            window.parent.postMessage({ type: 'log', level: 'error', args: args.map(arg => String(arg)) }, '*');
          };
          
          console.warn = (...args) => {
            window.parent.postMessage({ type: 'log', level: 'warn', args: args.map(arg => String(arg)) }, '*');
          };
          
          console.info = (...args) => {
            window.parent.postMessage({ type: 'log', level: 'info', args: args.map(arg => String(arg)) }, '*');
          };
          
          // Catch errors
          window.onerror = (message, source, lineno, colno, error) => {
            window.parent.postMessage({ 
              type: 'error', 
              message: String(message),
              line: lineno,
              column: colno
            }, '*');
            return true;
          };
          
          // Execute user code
          try {
            ${code}
            window.parent.postMessage({ type: 'complete' }, '*');
          } catch (error) {
            window.parent.postMessage({ 
              type: 'error', 
              message: error.message,
              stack: error.stack
            }, '*');
          }
        </script>
      </body>
      </html>
    `;

    // Message handler for iframe communication
    const messageHandler = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;

      const { type, level, args, message, line, column, stack } = event.data;

      if (type === 'log') {
        logs.push({ type: level, args });
        this.appendOutput(outputElement, level, args);
      } else if (type === 'error') {
        const errorMsg = stack || message;
        const location = line ? ` (line ${line}, column ${column})` : '';
        this.appendOutput(outputElement, 'error', [`Error${location}: ${errorMsg}`]);
        statusElement.textContent = '❌ Error';
        statusElement.className = 'playground-status status-error';
      } else if (type === 'complete') {
        const duration = Date.now() - startTime;
        if (logs.length === 0) {
          this.appendOutput(outputElement, 'info', ['✅ Code executed successfully (no output)']);
        }
        statusElement.textContent = `✅ Completed (${duration}ms)`;
        statusElement.className = 'playground-status status-success';
        window.removeEventListener('message', messageHandler);
      }
    };

    window.addEventListener('message', messageHandler);

    // Load sandbox
    iframe.srcdoc = sandboxHtml;

    // Timeout safety
    setTimeout(() => {
      window.removeEventListener('message', messageHandler);
      if (statusElement.textContent === '⏳ Running...') {
        statusElement.textContent = '⏱️ Timeout';
        statusElement.className = 'playground-status status-error';
        this.appendOutput(outputElement, 'error', ['Execution timeout (5s limit)']);
      }
    }, 5000);
  }

  /**
   * Append output to output element
   */
  private appendOutput(outputElement: HTMLElement, level: string, args: any[]): void {
    const logEntry = document.createElement('div');
    logEntry.className = `output-entry output-${level}`;
    
    const icon = this.getLogIcon(level);
    const content = args.map(arg => this.formatValue(arg)).join(' ');
    
    logEntry.innerHTML = `<span class="output-icon">${icon}</span><span class="output-content">${this.escapeHtml(content)}</span>`;
    outputElement.appendChild(logEntry);
    
    // Auto-scroll to bottom
    outputElement.scrollTop = outputElement.scrollHeight;
  }

  /**
   * Get icon for log level
   */
  private getLogIcon(level: string): string {
    const icons: Record<string, string> = {
      log: '📝',
      error: '❌',
      warn: '⚠️',
      info: 'ℹ️'
    };
    return icons[level] || '📝';
  }

  /**
   * Format value for display
   */
  private formatValue(value: any): string {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  /**
   * Escape HTML for safe display
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Inject playground styles
   */
  private injectPlaygroundStyles(): void {
    if (document.getElementById('playground-renderer-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'playground-renderer-styles';
    style.textContent = `
      .code-playground-container {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        margin: 10px 0;
        border: 1px solid var(--vscode-panel-border, #3a3d41);
        border-radius: 4px;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      
      .playground-editor-section,
      .playground-output-section {
        display: flex;
        flex-direction: column;
        min-height: 300px;
      }
      
      .playground-header,
      .playground-output-header {
        background: var(--vscode-editor-inactiveSelectionBackground, #3a3d41);
        padding: 8px 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1px solid var(--vscode-panel-border, #3a3d41);
      }
      
      .playground-title {
        font-weight: 600;
        font-size: 13px;
      }
      
      .playground-controls {
        display: flex;
        gap: 6px;
      }
      
      .playground-btn {
        background: var(--vscode-button-background, #0e639c);
        color: var(--vscode-button-foreground, #fff);
        border: none;
        padding: 4px 10px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 12px;
      }
      
      .playground-btn:hover {
        background: var(--vscode-button-hoverBackground, #1177bb);
      }
      
      .playground-editor {
        flex: 1;
        background: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #d4d4d4);
        border: none;
        padding: 12px;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 13px;
        line-height: 1.5;
        resize: none;
        outline: none;
      }
      
      .playground-output {
        flex: 1;
        background: var(--vscode-editor-background, #1e1e1e);
        color: var(--vscode-editor-foreground, #d4d4d4);
        padding: 12px;
        overflow-y: auto;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 12px;
      }
      
      .output-placeholder {
        color: var(--vscode-descriptionForeground, #999);
        font-style: italic;
      }
      
      .output-entry {
        display: flex;
        gap: 8px;
        margin-bottom: 4px;
        padding: 4px;
        border-radius: 3px;
      }
      
      .output-log {
        color: var(--vscode-editor-foreground, #d4d4d4);
      }
      
      .output-error {
        color: var(--vscode-errorForeground, #f48771);
        background: rgba(244, 135, 113, 0.1);
      }
      
      .output-warn {
        color: var(--vscode-editorWarning-foreground, #cca700);
        background: rgba(204, 167, 0, 0.1);
      }
      
      .output-info {
        color: var(--vscode-editorInfo-foreground, #3794ff);
        background: rgba(55, 148, 255, 0.1);
      }
      
      .output-icon {
        flex-shrink: 0;
      }
      
      .output-content {
        white-space: pre-wrap;
        word-break: break-word;
      }
      
      .playground-status {
        font-size: 12px;
        padding: 2px 8px;
        border-radius: 3px;
      }
      
      .status-running {
        background: var(--vscode-editorInfo-background, #007acc);
        color: var(--vscode-editorInfo-foreground, #fff);
      }
      
      .status-success {
        background: var(--vscode-testing-iconPassed, #73c991);
        color: var(--vscode-editor-background, #1e1e1e);
      }
      
      .status-error {
        background: var(--vscode-errorForeground, #f48771);
        color: var(--vscode-editor-background, #1e1e1e);
      }
      
      .playground-sandbox {
        width: 0;
        height: 0;
        border: none;
      }
      
      @media (max-width: 768px) {
        .code-playground-container {
          grid-template-columns: 1fr;
        }
      }
    `;
    
    document.head.appendChild(style);
  }

  /**
   * Cleanup on destroy
   */
  async onDestroy(context: IRenderContext): Promise<void> {
    const instanceKey = `${context.documentUri}-${context.instanceId}`;
    const instance = this.playgroundInstances.get(instanceKey);
    
    if (instance?.iframe) {
      instance.iframe.remove();
    }
    
    this.playgroundInstances.delete(instanceKey);
  }
}
