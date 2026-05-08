import * as vscode from 'vscode';

export interface InlineSuggestionRequest {
  document: vscode.TextDocument;
  content: string;
  beforeCursor: string;
  afterCursor: string;
  languageId: string;
  manual?: boolean;
}

export class InlineSuggestionService {
  private static instance: InlineSuggestionService;

  private constructor() {}

  public static getInstance(): InlineSuggestionService {
    if (!InlineSuggestionService.instance) {
      InlineSuggestionService.instance = new InlineSuggestionService();
    }

    return InlineSuggestionService.instance;
  }

  public async getSuggestion(
    request: InlineSuggestionRequest,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const lmApi = (vscode as typeof vscode & { lm?: typeof vscode.lm }).lm;
    if (!lmApi?.selectChatModels) {
      return undefined;
    }

    let model; // Default to auto (will resolve to first available)
    
    // Get user-configured model name from settings
    const modelName = vscode.workspace.getConfiguration('markdown-editor').get<string>('ai.modelName', 'auto');
    
    if (modelName !== 'auto') {
      // User explicitly selected a specific model
      const models = await lmApi.selectChatModels({ vendor: 'copilot' });
      model = models.find(m => m.id === modelName);
      
      // If configured model not found, fall back to auto detection
      if (!model) {
        console.warn(`Configured AI model '${modelName}' not available. Falling back to auto-detection.`);
      }
    } else {
      // Auto mode: select best available model based on availability and performance
      const models = await lmApi.selectChatModels({ vendor: 'copilot' });
      
      // Priority order for auto-selection (fastest response times)
      const preferredOrder = ['copilot-fast', 'gtp-4o-mini', 'gtp-4o', 'gpt-4.1', 'oswe-vscode-prime'];
      
      model = models.find(m => preferredOrder.includes(m.id)) || models[0];
    }

    if (!model) {
      console.warn('No AI models available for inline suggestions.');
      return undefined;
    }

    const prompt = this.buildPrompt(request);
    const response = await model.sendRequest(
      [vscode.LanguageModelChatMessage.User(prompt)],
      {},
      token
    );

    let text = '';
    for await (const chunk of response.text) {
      if (token.isCancellationRequested) {
        return undefined;
      }
      text += chunk;
    }

    return this.sanitizeSuggestion(text, request);
  }

  private buildPrompt(request: InlineSuggestionRequest): string {
    const beforeCursor = request.beforeCursor.slice(-1800);
    const afterCursor = request.afterCursor.slice(0, 400);
    const documentTail = request.content.slice(-3000);
    const mode = request.manual ? 'explicitly requested' : 'implicitly requested while typing';

    return [
      'You generate inline code or prose completions for a Markdown editor.',
      'Return only the immediate continuation text that should appear after the cursor.',
      'Do not wrap the response in backticks, quotes, markdown fences, labels, or explanations.',
      'Prefer a short continuation. Stop before repeating existing suffix text.',
      `The suggestion was ${mode}.`,
      `Language: ${request.languageId}`,
      '',
      'Document tail:',
      documentTail,
      '',
      'Text before cursor:',
      beforeCursor,
      '',
      'Text after cursor:',
      afterCursor,
    ].join('\n');
  }

  private sanitizeSuggestion(
    rawSuggestion: string,
    request: InlineSuggestionRequest
  ): string | undefined {
    let suggestion = String(rawSuggestion || '').replace(/\r/g, '');
    suggestion = suggestion
      .replace(/^```[\w-]*\n?/i, '')
      .replace(/```$/i, '')
      .replace(/^(?:suggestion|completion|continuation)\s*:\s*/i, '');

    if (!suggestion.trim()) {
      return undefined;
    }

    if (request.afterCursor && suggestion.startsWith(request.afterCursor)) {
      return undefined;
    }

    if (request.afterCursor) {
      for (let overlap = Math.min(suggestion.length, request.afterCursor.length); overlap > 0; overlap -= 1) {
        const suffix = suggestion.slice(-overlap);
        if (request.afterCursor.startsWith(suffix)) {
          suggestion = suggestion.slice(0, -overlap);
          break;
        }
      }
    }

    suggestion = suggestion.slice(0, 240);
    if (!suggestion.trim()) {
      return undefined;
    }

    return suggestion;
  }
}
