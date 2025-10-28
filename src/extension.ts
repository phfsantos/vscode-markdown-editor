import * as vscode from 'vscode';
import * as path from 'path';
import { logger } from './utils/Logger';
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
import { VSCodeIntegrator } from './integration/VSCodeIntegrator';
import { MarkdownDiffViewSupport } from './diff/MarkdownDiffViewSupport';
import { MarkdownSidebarProvider } from './sidebar/MarkdownSidebarProvider';
import { WikiLinkCompletionProvider } from './providers/WikiLinkCompletionProvider';

export function activate(context: vscode.ExtensionContext) {
  // Make extension context globally available for services like LinkResolver
  (global as any).extensionContext = context;
  
  // Make logger globally available for webview and other components
  (global as any).markdownEditorLog = (message: string) => {
    logger.debug(message);
  };
  
  // Log activation
  logger.info('🚀 Markdown Editor extension activated successfully');
  logger.debug('✅ Global logging function is now available');
  logger.debug('📊 Logger ready for diagnostic logs');
  logger.debug('🔧 Enhanced external change detection enabled');
  
  // Ensure logger is disposed when extension deactivates
  context.subscriptions.push({ dispose: () => logger.dispose() });
  
  // Initialize performance optimizer
  const performanceOptimizer = new PerformanceOptimizer();
  
  // Initialize VS Code integrator for enhanced native features
  const vscodeIntegrator = VSCodeIntegrator.getInstance();
  vscodeIntegrator.registerLanguageFeatures(context);
  context.subscriptions.push({ dispose: () => vscodeIntegrator.dispose() });
  
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

  // Initialize Obsidian-style sidebar
  const sidebarProvider = new MarkdownSidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MarkdownSidebarProvider.viewType,
      sidebarProvider
    ),
    sidebarProvider  // Dispose sidebar provider when extension deactivates
  );

  // Initialize wiki-link completion provider for Obsidian-style [[filename]] autocomplete
  const wikiLinkProvider = WikiLinkCompletionProvider.getInstance();
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(
      'markdown',
      wikiLinkProvider,
      '[', '[' // Trigger characters - fires on second [
    )
  );
  logger.debug('✅ Wiki-Link Completion Provider registered for [[filename]] autocomplete');

  // Initialize markdown diff view support (detects when editors are in diff view)
  logger.debug('🔍 DIFF: Initializing Markdown Diff View Support...');
  const diffViewSupport = new MarkdownDiffViewSupport(context);
  context.subscriptions.push(diffViewSupport);
  logger.debug('✅ DIFF: Markdown Diff View Support registered successfully');

  // Make diff support globally available
  (global as any).markdownDiffViewSupport = diffViewSupport;

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

  // Add command for graph view (placeholder for Phase 4)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'markdown-editor.openGraphView',
      async (docUri?: string) => {
        logger.debug('[Extension] markdown-editor.openGraphView command called', docUri);
        try {
          const { GraphViewPanel } = await import('./app/GraphViewPanel');
          logger.debug('[Extension] GraphViewPanel imported, calling createOrShow');
          await GraphViewPanel.createOrShow(context, docUri);
        } catch (error) {
          logger.error('Extension: Error creating GraphViewPanel:', error);
          vscode.window.showErrorMessage(`Failed to open graph view: ${error}`);
        }
      }
    )
  )

  context.globalState.setKeysForSync([KeyVditorOptions])

  // Register custom editor with enhanced provider
  // CRITICAL: Allow multiple editors per document so diff view and individual tabs
  // each get their own webview instance. This prevents constant clearing/reapplying
  // of diff visualizations when switching between tabs.
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'markdown-editor',
      new PreviewCustomEditorProvider(context),
      {
        webviewOptions: {
          retainContextWhenHidden: true,
        },
        supportsMultipleEditorsPerDocument: true, // Allow separate instances for diff vs individual tabs
      }
    ),
  );

  // Setup file watcher for wiki-link updates on file rename
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*.md');
  
  fileWatcher.onDidDelete(async (uri) => {
    // Invalidate cache when files are deleted
    const { LinkResolver } = await import('./services/LinkResolver');
    LinkResolver.getInstance().invalidateCache();
  });

  fileWatcher.onDidCreate(async (uri) => {
    // Invalidate cache when files are created
    const { LinkResolver } = await import('./services/LinkResolver');
    LinkResolver.getInstance().invalidateCache();
  });

  context.subscriptions.push(fileWatcher);

  // Watch for file renames to update wiki-links
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (event) => {
      const { LinkResolver } = await import('./services/LinkResolver');
      const resolver = LinkResolver.getInstance();
      
      for (const file of event.files) {
        // Update wiki-links in all files that reference the renamed file
        await resolver.updateLinksForRenamedFile(file.oldUri, file.newUri);
        
        logger.debug(
          `📝 Updated wiki-links for renamed file: ${file.oldUri.fsPath} → ${file.newUri.fsPath}`
        );
      }
      
      // Invalidate cache after renames
      resolver.invalidateCache();
    })
  );

  // Clean up on deactivation
  context.subscriptions.push({
    dispose: () => {
      performanceOptimizer.cleanup();
    }
  });

  // Command: Filter notes by tag (Quick pick tags -> files)
  context.subscriptions.push(
    vscode.commands.registerCommand('markdown-editor.filterByTag', async () => {
      try {
        const { TagManager } = await import('./services/TagManager');
        const tagManager = TagManager.getInstance();
        const tagObjs = await tagManager.getAllTags();
        if (!tagObjs || tagObjs.length === 0) {
          vscode.window.showInformationMessage('No tags found in workspace');
          return;
        }

        const tagList = tagObjs.map(t => t.tag);
        const tagPick = await vscode.window.showQuickPick(tagList, {
          placeHolder: 'Select a tag to filter by'
        });
        if (!tagPick) return;

        const files = await tagManager.getFilesForTag(tagPick);
        if (!files || files.length === 0) {
          vscode.window.showInformationMessage(`No files found for tag ${tagPick}`);
          return;
        }

        const filePick = await vscode.window.showQuickPick(files.map(f => ({ label: path.basename(f), description: f } as vscode.QuickPickItem)), {
          placeHolder: `Files tagged ${tagPick}`
        });
        if (!filePick) return;

        const target = filePick.description || filePick.label;
        if (target) {
          await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(target));
        }
      } catch (err) {
        logger.error('Extension: filterByTag command failed', err);
        vscode.window.showErrorMessage('Failed to filter by tag: ' + String(err));
      }
    })
  );
}
