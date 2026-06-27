/**
 * Vitest setup file — runs before each test file.
 * Mock the vscode module so we don't need a VS Code runtime for unit tests.
 */

import { vi } from 'vitest';

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn((_key: string, def?: unknown) => def),
      update: vi.fn(),
    })),
    workspaceFolders: [],
    onDidChangeConfiguration: vi.fn(),
    onDidSaveTextDocument: vi.fn(),
    createFileSystemWatcher: vi.fn(() => ({
      onDidChange: vi.fn(),
      onDidCreate: vi.fn(),
      onDidDelete: vi.fn(),
      dispose: vi.fn(),
    })),
    findFiles: vi.fn(async () => []),
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
    withProgress: vi.fn(async (_opts: unknown, task: (p: unknown) => unknown) =>
      task({ report: vi.fn() }),
    ),
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
  },
  tasks: {
    registerTaskProvider: vi.fn(() => ({ dispose: vi.fn() })),
    fetchTasks: vi.fn(async () => []),
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
  Range: class {
    start: unknown;
    end: unknown;
    constructor(start: unknown, end: unknown) {
      this.start = start;
      this.end = end;
    }
  },
  Position: class {
    line: number;
    character: number;
    constructor(line: number, character: number) {
      this.line = line;
      this.character = character;
    }
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
    dispose = () => {
      this.listeners = [];
    };
  },
  RelativePattern: class {
    constructor(
      public base: unknown,
      public pattern: string,
    ) {}
  },
  ProgressLocation: { Notification: 10, Window: 15 },
  extensions: { getExtension: vi.fn() },
  env: {
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
  },
  version: '1.85.0',
}));
