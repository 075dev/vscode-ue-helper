/**
 * Vitest setup file — runs before each test file.
 */

import { vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, def?: unknown) => def),
      update: vi.fn(),
    })),
    workspaceFolders: [],
    workspaceFile: undefined,
    onDidChangeConfiguration: vi.fn(),
    onDidSaveTextDocument: vi.fn(),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    })),
    findFiles: vi.fn(() => Promise.resolve([])),
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    showQuickPick: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      appendLine: vi.fn(),
      append: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
    createStatusBarItem: vi.fn(() => ({
      text: '',
      tooltip: '',
      command: undefined,
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
    })),
    withProgress: vi.fn((_opts: unknown, task: (p: unknown) => unknown) =>
      Promise.resolve(task({ report: vi.fn() })),
    ),
    registerWebviewViewProvider: vi.fn(() => ({ dispose: vi.fn() })),
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: '',
        cspSource: 'vscode-webview://test',
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
        postMessage: vi.fn(() => Promise.resolve(true)),
        asWebviewUri: vi.fn(),
        options: {},
      },
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
      reveal: vi.fn(),
      title: '',
      visible: true,
      active: true,
      viewColumn: 1,
      viewType: 'vscodeUEHelper.controlPanel',
    })),
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
    executeCommand: vi.fn(),
  },
  languages: {
    createDiagnosticCollection: vi.fn(() => ({
      set: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      dispose: vi.fn(),
    })),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  tasks: {
    registerTaskProvider: vi.fn(() => ({ dispose: vi.fn() })),
    fetchTasks: vi.fn(() => Promise.resolve([])),
    executeTask: vi.fn(),
    Task: class {},
    TaskScope: { Workspace: 1, Global: 2 },
    TaskRevealKind: { Always: 1, Never: 0, Silent: 2 },
  },
  Diagnostic: class {
    range: unknown;
    message: string;
    severity: unknown;
    source?: string;
    code?: unknown;
    constructor(range: unknown, message: string, severity: unknown) {
      this.range = range;
      this.message = message;
      this.severity = severity;
    }
  },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CompletionItemKind: { Property: 9 },
  CompletionItem: class {
    label: string;
    kind: unknown;
    insertText: unknown;
    detail: string | undefined;
    documentation: unknown;
    constructor(label: string, kind?: unknown) {
      this.label = label;
      this.kind = kind;
    }
  },
  SnippetString: class {
    value: string;
    constructor(value: string) { this.value = value; }
  },
  MarkdownString: class {
    value: string;
    constructor(value: string) { this.value = value; }
  },
  Range: class {
    start: unknown; end: unknown;
    constructor(start: unknown, end: unknown) { this.start = start; this.end = end; }
  },
  Position: class {
    line: number; character: number;
    constructor(line: number, character: number) { this.line = line; this.character = character; }
  },
  Uri: {
    file: vi.fn((p: string) => ({ fsPath: p, path: p, scheme: 'file' })),
  },
  EventEmitter: class {
    private listeners: Array<(e: unknown) => void> = [];
    event = (listener: (e: unknown) => void) => {
      this.listeners.push(listener);
      return { dispose: () => {} };
    };
    fire = (e: unknown) => this.listeners.forEach((l) => l(e));
    dispose = () => { this.listeners = []; };
  },
  RelativePattern: class {
    constructor(public base: unknown, public pattern: string) {}
  },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 10, Window: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ViewColumn: { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9 },
  extensions: { getExtension: vi.fn() },
  env: {
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
  },
  version: '1.85.0',
}));
