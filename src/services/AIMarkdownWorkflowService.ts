import * as vscode from 'vscode';
import { logger } from '../utils/Logger';
import { RelationshipAnalyzer } from './RelationshipAnalyzer';
import { LinkGraphGenerator } from './LinkGraphGenerator';
import {
  AIMarkdownClassification,
  classifyAIMarkdownFileName,
} from './AIMarkdownDetector';

export type AIMarkdownProvider = 'none' | 'copilotChat';
export type AIMarkdownAvailabilityStatus = 'disabled' | 'fallback' | 'ready';

export interface AIMarkdownAvailability {
  enabled: boolean;
  affordancesEnabled: boolean;
  chatInteropEnabled: boolean;
  provider: AIMarkdownProvider;
  providerInstalled: boolean;
  status: AIMarkdownAvailabilityStatus;
  statusLabel: string;
  detail: string;
}

export interface AIMarkdownDescriptor extends AIMarkdownClassification {
  filePath: string;
  relativePath: string;
  hasPendingChatEdits: boolean;
  availability: AIMarkdownAvailability;
}

export interface AIMarkdownContextPackage {
  markdown: string;
  json: string;
  descriptor: AIMarkdownDescriptor;
}

export interface AIMarkdownValidationResult {
  isAIMarkdown: boolean;
  isValid: boolean;
  missingSections: string[];
  presentSections: string[];
}

export interface AIMarkdownOpenChatResult {
  copiedToClipboard: boolean;
  openedChat: boolean;
  message: string;
  commandId?: string;
}

export interface AIMarkdownDescribeOptions {
  hasPendingChatEdits?: boolean;
}

export class AIMarkdownWorkflowService {
  private static instance: AIMarkdownWorkflowService;
  private readonly analyzer = RelationshipAnalyzer.getInstance();
  private readonly graphGenerator = LinkGraphGenerator.getInstance();

  private constructor() {}

  public static getInstance(): AIMarkdownWorkflowService {
    if (!AIMarkdownWorkflowService.instance) {
      AIMarkdownWorkflowService.instance = new AIMarkdownWorkflowService();
    }

    return AIMarkdownWorkflowService.instance;
  }

  public describeDocument(
    document: vscode.TextDocument,
    options: AIMarkdownDescribeOptions = {}
  ): AIMarkdownDescriptor {
    const classification = classifyAIMarkdownFileName(document.fileName || document.uri.fsPath);

    return {
      ...classification,
      filePath: document.uri.fsPath,
      relativePath: vscode.workspace.asRelativePath(document.uri, false),
      hasPendingChatEdits: Boolean(options.hasPendingChatEdits),
      availability: this.getAvailability(),
    };
  }

  public async buildContextPackage(
    document: vscode.TextDocument,
    options: AIMarkdownDescribeOptions = {}
  ): Promise<AIMarkdownContextPackage> {
    const descriptor = this.describeDocument(document, options);
    const maxItems = this.getConfig().get<number>('ai.maxContextItems', 5);
    const maxChars = this.getConfig().get<number>('ai.maxContextChars', 6000);

    const [outgoingLinks, backlinks, relatedFiles, graphData] = await Promise.all([
      this.analyzer.getOutgoingLinks(document.uri),
      this.analyzer.getBacklinks(document.uri),
      this.analyzer.getRelatedFiles(document.uri, maxItems),
      this.graphGenerator.generateSimplifiedGraph(document.uri, 1, Math.max(8, maxItems * 3)),
    ]);

    const limitedOutgoingLinks = outgoingLinks.slice(0, maxItems).map((link) => ({
      text: link.text,
      url: link.url,
      type: link.type,
      resolved: link.resolved ?? undefined,
      line: link.line,
    }));
    const limitedBacklinks = backlinks.slice(0, maxItems).map((link) => ({
      name: link.name,
      path: link.relativePath || link.path,
      lineNumber: link.lineNumber,
      context: link.context,
    }));
    const limitedRelatedFiles = relatedFiles.slice(0, maxItems).map((file) => ({
      name: file.name,
      path: file.relativePath || file.path,
      score: file.score,
    }));
    const graphSummary = graphData
      ? {
          nodes: graphData.nodes.slice(0, maxItems + 2).map((node) => ({
            id: node.id,
            label: node.label,
            isFocus: node.isFocus,
          })),
          edges: graphData.edges.slice(0, maxItems * 2).map((edge) => ({
            source: edge.source,
            target: edge.target,
            type: edge.type,
          })),
        }
      : { nodes: [], edges: [] };

    const markdown = this.limitText([
      '# AI Markdown Context Package',
      '',
      `- File: ${descriptor.relativePath}`,
      `- Type: ${descriptor.badgeLabel || 'Markdown'}`,
      `- AI availability: ${descriptor.availability.statusLabel}`,
      `- Integration detail: ${descriptor.availability.detail}`,
      descriptor.hasPendingChatEdits
        ? '- Pending chat edits are currently detected for this file.'
        : '- No pending chat edits are currently detected.',
      '',
      '## Suggested Sections',
      ...this.asBulletList(descriptor.suggestedSections, 'This file does not use an AI markdown naming pattern.'),
      '',
      '## Backlinks',
      ...this.asBulletList(
        limitedBacklinks.map((item) => this.formatBacklink(item)),
        'No backlinks found.'
      ),
      '',
      '## Outgoing Links',
      ...this.asBulletList(
        limitedOutgoingLinks.map((item) => this.formatOutgoingLink(item)),
        'No outgoing links found.'
      ),
      '',
      '## Related Files',
      ...this.asBulletList(
        limitedRelatedFiles.map((item) => `${item.name} (${item.path}) score=${item.score.toFixed(2)}`),
        'No related files found.'
      ),
      '',
      '## Graph Neighborhood',
      ...this.asBulletList(
        graphSummary.nodes.map((node) => `${node.label}${node.isFocus ? ' [focus]' : ''}`),
        'No graph neighborhood data found.'
      ),
      '',
      '## Fallback Workflow',
      '- Copy this package into your preferred AI chat tool.',
      '- Use the custom editor AI header to insert templates or structured context at the cursor.',
      '- Open the graph view if you need a visual review of neighboring notes.',
      '- If chat APIs are unavailable, rely on document diffs and pending edit review inside the editor.',
      '',
    ].join('\n'), maxChars);

    const json = this.limitText(
      JSON.stringify(
        {
          file: {
            path: descriptor.relativePath,
            type: descriptor.kind,
            suggestedSections: descriptor.suggestedSections,
            hasPendingChatEdits: descriptor.hasPendingChatEdits,
          },
          availability: descriptor.availability,
          backlinks: limitedBacklinks,
          outgoingLinks: limitedOutgoingLinks,
          relatedFiles: limitedRelatedFiles,
          graph: graphSummary,
        },
        null,
        2
      ),
      Math.max(maxChars, 1200)
    );

    return {
      markdown,
      json,
      descriptor,
    };
  }

  public getTemplateSnippet(document: vscode.TextDocument): string {
    const descriptor = this.describeDocument(document);
    const headingSections = descriptor.suggestedSections.length > 0
      ? descriptor.suggestedSections
      : ['Intent', 'Context', 'Constraints', 'Expected Output'];

    const frontmatter = descriptor.isAIMarkdown
      ? [
          '---',
          `kind: ${descriptor.kind}`,
          `title: ${this.getDefaultTemplateTitle(descriptor)}`,
          'owner: ',
          'status: draft',
          '---',
          '',
        ]
      : [];

    return [
      ...frontmatter,
      ...headingSections.map((section) => `## ${section}\n\n`),
    ].join('\n').trimStart();
  }

  public validateDocument(document: vscode.TextDocument): AIMarkdownValidationResult {
    const descriptor = this.describeDocument(document);
    if (!descriptor.isAIMarkdown) {
      return {
        isAIMarkdown: false,
        isValid: true,
        missingSections: [],
        presentSections: [],
      };
    }

    const text = document.getText();
    const presentSections = descriptor.suggestedSections.filter((section) => this.hasSectionHeading(text, section));
    const missingSections = descriptor.suggestedSections.filter((section) => !presentSections.includes(section));

    return {
      isAIMarkdown: true,
      isValid: missingSections.length === 0,
      missingSections,
      presentSections,
    };
  }

  public async copyContextPackage(
    document: vscode.TextDocument,
    options: AIMarkdownDescribeOptions = {}
  ): Promise<AIMarkdownContextPackage> {
    const contextPackage = await this.buildContextPackage(document, options);
    await vscode.env.clipboard.writeText(contextPackage.markdown);
    return contextPackage;
  }

  public async openChatWorkflow(
    document: vscode.TextDocument,
    options: AIMarkdownDescribeOptions = {}
  ): Promise<AIMarkdownOpenChatResult> {
    const contextPackage = await this.copyContextPackage(document, options);
    const descriptor = contextPackage.descriptor;

    if (!descriptor.availability.enabled) {
      return {
        copiedToClipboard: true,
        openedChat: false,
        message: 'AI markdown support is disabled in settings. Context was still copied to the clipboard.',
      };
    }

    if (!descriptor.availability.chatInteropEnabled) {
      return {
        copiedToClipboard: true,
        openedChat: false,
        message: 'AI context was copied to the clipboard. Chat opening shortcuts are disabled in settings, so paste it into your chat tool manually.',
      };
    }

    if (descriptor.availability.provider === 'none' || !descriptor.availability.providerInstalled) {
      return {
        copiedToClipboard: true,
        openedChat: false,
        message: `AI context was copied to the clipboard. ${descriptor.availability.detail}`,
      };
    }

    const availableCommands = await vscode.commands.getCommands(true);
    const chatCommandId = [
      'workbench.action.chat.open',
      'workbench.action.chat.newChat',
      'workbench.panel.chat.view.copilot.focus',
      'workbench.action.quickchat.toggle',
    ].find((commandId) => availableCommands.includes(commandId));

    if (!chatCommandId) {
      return {
        copiedToClipboard: true,
        openedChat: false,
        message: 'AI context was copied to the clipboard. Open your chat tool and paste it manually.',
      };
    }

    try {
      await vscode.commands.executeCommand(chatCommandId);
      return {
        copiedToClipboard: true,
        openedChat: true,
        commandId: chatCommandId,
        message: 'AI context was copied to the clipboard and a chat surface was opened. Paste the package into chat to continue.',
      };
    } catch (error) {
      logger.warn('Failed to open chat command, falling back to clipboard handoff', error);
      return {
        copiedToClipboard: true,
        openedChat: false,
        message: 'AI context was copied to the clipboard, but opening chat failed. Paste it manually into your chat tool.',
      };
    }
  }

  private getAvailability(): AIMarkdownAvailability {
    const config = this.getConfig();
    const enabled = config.get<boolean>('ai.enable', true);
    const affordancesEnabled = config.get<boolean>('ai.enableAffordances', true);
    const chatInteropEnabled = config.get<boolean>('ai.enableChatInterop', true);
    const provider = config.get<AIMarkdownProvider>('ai.provider', 'copilotChat');
    const providerInstalled = provider === 'copilotChat'
      ? Boolean(vscode.extensions.getExtension('GitHub.copilot-chat'))
      : false;

    if (!enabled) {
      return {
        enabled,
        affordancesEnabled,
        chatInteropEnabled,
        provider,
        providerInstalled,
        status: 'disabled',
        statusLabel: 'Disabled',
        detail: 'Enable markdown-editor.ai.enable to restore AI markdown workflows.',
      };
    }

    if (provider === 'none' || !providerInstalled) {
      return {
        enabled,
        affordancesEnabled,
        chatInteropEnabled,
        provider,
        providerInstalled,
        status: 'fallback',
        statusLabel: 'Clipboard handoff',
        detail: provider === 'none'
          ? 'Automatic chat-provider integration is disabled; use clipboard fallback.'
          : 'GitHub Copilot Chat is not installed; use clipboard fallback.',
      };
    }

    return {
      enabled,
      affordancesEnabled,
      chatInteropEnabled,
      provider,
      providerInstalled,
      status: 'ready',
      statusLabel: 'Copilot Chat available',
      detail: 'Open chat when needed; structured context still uses manual paste for reliability.',
    };
  }

  private hasSectionHeading(text: string, heading: string): boolean {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^##\\s+${escapedHeading}\\s*$`, 'mi').test(text);
  }

  private asBulletList(items: string[], fallback: string): string[] {
    if (!items.length) {
      return [`- ${fallback}`];
    }

    return items.map((item) => `- ${item}`);
  }

  private formatBacklink(item: { name: string; path: string; lineNumber?: number; context?: string }): string {
    const location = typeof item.lineNumber === 'number' ? `:${item.lineNumber}` : '';
    const context = item.context ? ` — ${item.context}` : '';
    return `${item.name} (${item.path}${location})${context}`;
  }

  private formatOutgoingLink(item: { text: string; url: string; type: string; resolved?: string; line?: number }): string {
    const resolved = item.resolved ? ` -> ${item.resolved}` : '';
    const line = typeof item.line === 'number' ? ` @ line ${item.line}` : '';
    return `${item.text} [${item.type}] (${item.url})${resolved}${line}`;
  }

  private limitText(text: string, maxChars: number): string {
    if (text.length <= maxChars) {
      return text;
    }

    return `${text.slice(0, Math.max(0, maxChars - 18))}\n…\n[truncated]`;
  }

  private getConfig(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('markdown-editor');
  }

  private getDefaultTemplateTitle(descriptor: AIMarkdownDescriptor): string {
    switch (descriptor.kind) {
      case 'agent':
        return 'New Agent';
      case 'prompt':
        return 'New Prompt';
      case 'skill':
        return 'New Skill';
      default:
        return 'New Document';
    }
  }
}
