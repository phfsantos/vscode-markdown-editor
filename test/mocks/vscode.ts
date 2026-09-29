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

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
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

export class Uri {
  public readonly fsPath: string;

  constructor(
    public readonly scheme: string,
    public readonly authority: string,
    public readonly path: string,
    public readonly query = '',
    public readonly fragment = '',
  ) {
    this.fsPath = scheme === 'file' ? decodeURIComponent(path) : path;
  }

  static file(fsPath: string): Uri {
    const normalized = fsPath.startsWith('/') ? fsPath : `/${fsPath}`;
    return new Uri('file', '', normalized);
  }

  static parse(value: string): Uri {
    const absolute = /^[a-z][a-z\d+.-]*:/i.test(value);
    if (!absolute) {
      const hashIndex = value.indexOf('#');
      const queryIndex = value.indexOf('?');
      const pathEnd = [hashIndex, queryIndex].filter(index => index >= 0).reduce((min, index) => Math.min(min, index), value.length);
      const queryEnd = hashIndex >= 0 ? hashIndex : value.length;
      return new Uri(
        '',
        '',
        value.slice(0, pathEnd),
        queryIndex >= 0 ? value.slice(queryIndex + 1, queryEnd) : '',
        hashIndex >= 0 ? value.slice(hashIndex + 1) : '',
      );
    }
    const parsed = new URL(value);
    return new Uri(
      parsed.protocol.slice(0, -1),
      parsed.host,
      decodeURIComponent(parsed.pathname),
      parsed.search.slice(1),
      parsed.hash.slice(1),
    );
  }

  static joinPath(base: Uri, ...parts: string[]): Uri {
    const joined = [base.path.replace(/\/$/, ''), ...parts].join('/').replace(/\/+/g, '/');
    return base.with({ path: joined });
  }

  with(change: Partial<Pick<Uri, 'scheme' | 'authority' | 'path' | 'query' | 'fragment'>>): Uri {
    return new Uri(
      change.scheme ?? this.scheme,
      change.authority ?? this.authority,
      change.path ?? this.path,
      change.query ?? this.query,
      change.fragment ?? this.fragment,
    );
  }

  toString(_skipEncoding?: boolean): string {
    const authority = this.authority ? `//${this.authority}` : this.scheme === 'file' ? '//' : '';
    const query = this.query ? `?${this.query}` : '';
    const fragment = this.fragment ? `#${this.fragment}` : '';
    return `${this.scheme ? `${this.scheme}:` : ''}${authority}${this.path}${query}${fragment}`;
  }
}

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
