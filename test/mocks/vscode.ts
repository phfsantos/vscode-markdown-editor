/**
 * Shared mock for the 'vscode' module (wired via resolve.alias in
 * vitest.config.ts). Tests mutate behavior through __reset()/__state instead
 * of patching Module._load like the legacy hand-rolled runner did.
 */

export interface MockVscodeState {
  config: Record<string, unknown>;
  clipboardWrites: string[];
  executedCommands: string[];
  warns: unknown[][];
  availableCommands: string[];
  installedExtensions: string[];
  executeCommandError: Error | null;
  relativePathBase: string;
  diagnosticSets: Array<{ uri: unknown; diagnostics: unknown[] }>;
  diagnostics: unknown[];
}

const defaultState = (): MockVscodeState => ({
  config: {},
  clipboardWrites: [],
  executedCommands: [],
  warns: [],
  availableCommands: [],
  installedExtensions: [],
  executeCommandError: null,
  relativePathBase: '/workspace/',
  diagnosticSets: [],
  diagnostics: [],
});

export let __state: MockVscodeState = defaultState();

export function __reset(overrides: Partial<MockVscodeState> = {}): MockVscodeState {
  __state = { ...defaultState(), ...overrides };
  return __state;
}

export const workspace = {
  getConfiguration() {
    return {
      get(key: string, defaultValue?: unknown) {
        return Object.prototype.hasOwnProperty.call(__state.config, key)
          ? __state.config[key]
          : defaultValue;
      },
    };
  },
  asRelativePath(uri: { fsPath: string }) {
    if (uri.fsPath.startsWith(__state.relativePathBase)) {
      return uri.fsPath.slice(__state.relativePathBase.length);
    }
    return uri.fsPath.replace(/^\/+/, '');
  },
  workspaceFolders: [] as unknown[],
  textDocuments: [] as unknown[],
  onDidChangeConfiguration() {
    return { dispose() {} };
  },
  onDidChangeTextDocument() {
    return { dispose() {} };
  },
  onDidOpenTextDocument() {
    return { dispose() {} };
  },
  onDidCloseTextDocument() {
    return { dispose() {} };
  },
};

export class Position {
  constructor(public line: number, public character: number) {}
}

export class TreeItem {
  constructor(public label: string, public collapsibleState?: number) {}
}

export class Range {
  public start: Position;
  public end: Position;

  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
    this.start = new Position(startLine, startCharacter);
    this.end = new Position(endLine, endCharacter);
  }
}

export class Diagnostic {
  public source?: string;
  public code?: string | number;

  constructor(
    public range: Range,
    public message: string,
    public severity: number,
  ) {}
}

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
};

export const languages = {
  createDiagnosticCollection() {
    return {
      set(uri: unknown, diagnostics: unknown[]) {
        __state.diagnosticSets.push({ uri, diagnostics });
      },
      delete() {},
      dispose() {},
    };
  },
  getDiagnostics() {
    return __state.diagnostics;
  },
};

export const env = {
  clipboard: {
    async writeText(value: string) {
      __state.clipboardWrites.push(value);
    },
    async readText() {
      return '';
    },
  },
};

export const commands = {
  async getCommands() {
    return __state.availableCommands.slice();
  },
  async executeCommand(commandId: string) {
    __state.executedCommands.push(commandId);
    if (__state.executeCommandError) {
      throw __state.executeCommandError;
    }
  },
};

export const extensions = {
  getExtension(id: string) {
    return __state.installedExtensions.includes(id) ? { id } : undefined;
  },
};

export const window = {
  createOutputChannel() {
    return {
      appendLine() {},
      show() {},
      dispose() {},
    };
  },
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
};

export const Uri = {
  file(fsPath: string) {
    return { fsPath, scheme: 'file', toString: () => `file://${fsPath}` };
  },
  parse(value: string) {
    return { fsPath: value.replace(/^file:\/\//, ''), scheme: 'file', toString: () => value };
  },
  joinPath(base: { fsPath: string }, ...parts: string[]) {
    const joined = [base.fsPath.replace(/\/$/, ''), ...parts].join('/');
    return { fsPath: joined, scheme: 'file', toString: () => `file://${joined}` };
  },
};

export class EventEmitter<T = unknown> {
  private listeners: Array<(value: T) => void> = [];
  event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire(value: T) {
    for (const listener of this.listeners) listener(value);
  }
  dispose() {}
}

export const LanguageModelChatMessage = {
  User: (content: string) => ({ role: 'user', content }),
  Assistant: (content: string) => ({ role: 'assistant', content }),
};

// vscode.lm is intentionally undefined by default — services must handle
// hosts without the Language Model API; tests can assign onto it if needed.
export const lm = undefined;
