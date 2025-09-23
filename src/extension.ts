import * as vscode from 'vscode';
const KeyVditorOptions = 'vditor.options';
import { PreviewCustomEditorProvider } from './app/PreviewCustomEditorProvider';
import { EditorPanel } from './app/EditorPanel';
import { debug } from './app/_utils';
// Import new providers for enhanced VS Code integration
import { MarkdownDiagnosticProvider } from './diagnostics/MarkdownDiagnosticProvider';
import { MarkdownTextSyncProvider } from './sync/MarkdownTextSyncProvider';
import { PerformanceOptimizer } from './performance/PerformanceOptimizer';
import { MarkdownCodeLensProvider, MarkdownDecorationProvider } from './decorations/MarkdownDecorationProviders';
import { MarkdownCommandProvider } from './commands/MarkdownCommandProvider';

export function activate(context: vscode.ExtensionContext) {
  // Initialize performance optimizer
  const performanceOptimizer = new PerformanceOptimizer();
  
  // Initialize diagnostic provider for inline errors
  const diagnosticProvider = new MarkdownDiagnosticProvider();
  context.subscriptions.push(diagnosticProvider);
  
  // Initialize text sync provider for spell checker compatibility
  const textSyncProvider = new MarkdownTextSyncProvider();
  context.subscriptions.push(textSyncProvider);
  
  // Initialize decoration provider for native text highlighting
  const decorationProvider = new MarkdownDecorationProvider();
  context.subscriptions.push(decorationProvider);
  
  // Initialize CodeLens provider for inline information
  const codeLensProvider = new MarkdownCodeLensProvider();
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider('markdown', codeLensProvider)
  );
  
  // Initialize enhanced commands
  const commandProvider = new MarkdownCommandProvider(context);
  context.subscriptions.push(commandProvider);

  // Original command registration with performance optimization
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.openEditor',
      (uri?: vscode.Uri, ...args) => {
        debug('command', uri, args)
        EditorPanel.createOrShow(context, uri)
      }
    )
  )

  // Add command to set as default markdown editor
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.setAsDefaultEditor',
      async () => {
        const config = vscode.workspace.getConfiguration();
        await config.update(
          'workbench.editorAssociations',
          {
            "*.md": "markdown-editor",
            "*.markdown": "markdown-editor"
          },
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage('Markdown Editor set as default for .md files');
      }
    )
  )

  context.globalState.setKeysForSync([KeyVditorOptions])

  // Register custom editor with enhanced provider
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'markdown-editor',
      new PreviewCustomEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: false,
      }
    ),
  );

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      performanceOptimizer.cleanup();
    }
  });
}
