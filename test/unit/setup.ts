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
    fs: {
      readDirectory: vi.fn(() => Promise.resolve([])),
      readFile: vi.fn(() => Promise.resolve(new Uint8Array())),
      stat: vi.fn(),
      writeFile: vi.fn(),
      delete: vi.fn(),
      rename: vi.fn(),
      copy: vi.fn(),
      createDirectory: vi.fn(),
      isWritableFileSystem: vi.fn(() => true),
    },
    onDidChangeTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCloseTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
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
    createTreeView: vi.fn(() => ({
      dispose: vi.fn(),
      title: '',
      description: '',
      visible: true,
    })),
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
  // [T4.5 task 子模块] Shell quoting 引用风格 mock — 必须在 top-level (vscode.ShellQuoting)，
  // 真实 vscode API 把 ShellQuoting 作为顶层 enum，不能放进 tasks 命名空间。
  ShellQuoting: { Strong: 'strong', Weak: 'weak' },
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
  ThemeColor: class {
    constructor(public readonly id: string) {}
  },
  ThemeIcon: class {
    constructor(public readonly id: string) {}
  },
  TreeItem: class {
    resourceUri: unknown;
    contextValue: string | undefined;
    tooltip: unknown;
    iconPath: unknown;
    command: unknown;
    constructor(
      public readonly label: string,
      public readonly collapsibleState: number,
    ) {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
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
    constructor(value: string) {
      this.value = value;
    }
  },
  MarkdownString: class {
    value: string;
    constructor(value: string) {
      this.value = value;
    }
  },
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
    joinPath: vi.fn(
      (base: { fsPath?: string; path?: string } | undefined, ...segments: string[]) => {
        const joined = [base?.fsPath ?? base?.path ?? '', ...segments].join('/');
        return { fsPath: joined, path: joined, scheme: 'file' };
      },
    ),
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
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { Notification: 10, Window: 15 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  Disposable: class {
    private readonly callOnce: () => void;
    constructor(callOnDispose: () => void) {
      this.callOnce = callOnDispose;
    }
    dispose(): void {
      this.callOnce();
    }
    static from(...disposables: Array<{ dispose?: () => void }>): { dispose: () => void } {
      return {
        dispose: () => {
          for (const d of disposables) {
            d?.dispose?.();
          }
        },
      };
    }
  },
  ViewColumn: { One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9 },
  extensions: { getExtension: vi.fn() },
  env: {
    isWindows: process.platform === 'win32',
    isMac: process.platform === 'darwin',
    isLinux: process.platform === 'linux',
  },
  version: '1.85.0',
}));

/**
 * Phase 7 PLAN B 前置依赖：mock chokidar 用于 fileWatcher.test.ts 单元测试
 *
 * 防御研究 §Pitfall 6 — 直接 import chokidar 在测试环境下会触发真实 fs watcher，
 * 阻塞测试进程。提供最小可用 mock：watch() 返回 chainable watcher。
 */
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
      add: vi.fn(),
      unwatch: vi.fn(),
    })),
  },
  watch: vi.fn(() => ({
    on: vi.fn().mockReturnThis(),
    close: vi.fn(),
    add: vi.fn(),
    unwatch: vi.fn(),
  })),
}));
