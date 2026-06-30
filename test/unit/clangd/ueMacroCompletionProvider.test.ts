/**
 * ueMacroCompletionProvider.test.ts —— UE 反射宏 VS Code provider 红测
 *
 * T6 要求注册 C/C++/头文件补全 provider，并把 T5 纯数据转换为
 * CompletionItem/SnippetString。测试通过 mock 文档直接驱动 provider，避免依赖
 * VS Code 运行时。
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { activateClangd, registerUeMacroCompletionProvider } from '@clangd';
import { Config } from '@core/config';
import { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { EngineInstall, ProjectInfo } from '@detection/types';

type MockTextDocument = Pick<vscode.TextDocument, 'languageId' | 'getText' | 'offsetAt'>;
type MockCompletionProvider = {
  readonly provideCompletionItems: (
    document: MockTextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext,
  ) => vscode.ProviderResult<MockCompletionItem[] | vscode.CompletionList<MockCompletionItem>>;
};
type MockCompletionItem = Pick<
  vscode.CompletionItem,
  'label' | 'insertText' | 'detail' | 'documentation'
>;

type RegisteredProviderCall = readonly [
  selector: vscode.DocumentSelector,
  provider: MockCompletionProvider,
  ...triggerCharacters: string[],
];

const CXX_LANGUAGE_IDS = ['cpp', 'c', 'h', 'hpp'] as const;
const fakeCancellationToken: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
};
const fakeCompletionContext: vscode.CompletionContext = {
  triggerKind: 1,
  triggerCharacter: undefined,
};

function mockDocument(languageId: string, sourceWithCursor: string): {
  readonly document: MockTextDocument;
  readonly position: vscode.Position;
} {
  const offset = sourceWithCursor.indexOf('|');
  expect(offset).toBeGreaterThanOrEqual(0);
  const text = sourceWithCursor.replace('|', '');
  return {
    document: {
      languageId,
      getText: () => text,
      offsetAt: () => offset,
    },
    position: new vscode.Position(0, offset),
  };
}

function labels(items: readonly MockCompletionItem[]): readonly string[] {
  return items.map((item) => String(item.label));
}

function snippetValue(item: MockCompletionItem): string {
  const insertText = item.insertText;
  return insertText instanceof vscode.SnippetString ? insertText.value : String(insertText);
}

function registeredCompletionProvider(): MockCompletionProvider {
  const calls = vi.mocked(vscode.languages.registerCompletionItemProvider).mock.calls;
  const latest = calls[calls.length - 1] as RegisteredProviderCall | undefined;
  if (!latest) {
    throw new Error('completion provider was not registered');
  }
  return latest[1];
}

async function provideItems(
  provider: MockCompletionProvider,
  languageId: string,
  sourceWithCursor: string,
): Promise<readonly MockCompletionItem[]> {
  const { document, position } = mockDocument(languageId, sourceWithCursor);
  const result = await provider.provideCompletionItems(document, position, fakeCancellationToken, fakeCompletionContext);
  if (!result) {
    return [];
  }
  return Array.isArray(result) ? result : result.items;
}

function createDetectionHandles(): DetectionHandles {
  const project: ProjectInfo = {
    name: 'MyGame',
    path: 'D:/Temp/MyGame/MyGame.uproject',
    engineAssociation: '5.4',
    modules: ['MyGame'],
    raw: {},
  };
  const engine: EngineInstall = {
    path: 'D:/UE/UE_5.4',
    version: '5.4',
    isLauncherInstall: false,
  };
  return {
    scanner: { maxResults: 1 } as never,
    discovery: {} as never,
    vsBuildTools: {} as never,
    workspaceContext: {} as never,
    ready: Promise.resolve({ projects: [project], engines: [engine], workspaceFile: undefined }),
  };
}

function mockConfig(): Config {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: vi.fn((key: string, fallback?: unknown) => (key === 'completionMode' ? 'fast' : fallback)),
    has: vi.fn(() => true),
    inspect: vi.fn(),
    update: vi.fn(),
  });
  return new Config();
}

describe('UE 宏 completion provider (T6)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('Given clangd 激活 When 注册 provider Then 覆盖 cpp/c/h/hpp 文档', () => {
  const context = {
    subscriptions: [],
    asAbsolutePath: (relativePath: string) => relativePath,
  } as unknown as vscode.ExtensionContext;
    const config = mockConfig();
    const logger = new Logger('test');

    activateClangd(context, config, logger, createDetectionHandles());

    const calls = vi.mocked(vscode.languages.registerCompletionItemProvider).mock.calls;
    expect(calls).toHaveLength(1);
    const latest = calls[0] as unknown as RegisteredProviderCall;
    const selector = latest[0];
    // DocumentSelector 是 string | DocumentFilter | DocumentFilter[] 的联合类型
    // 测试断言只关心 DocumentFilter[] 形态，需要归一化处理。
    const filters: readonly vscode.DocumentFilter[] = Array.isArray(selector)
      ? selector
      : typeof selector === 'string'
        ? [{ language: selector }]
        : [selector];
    const languages = filters.map((item) => item.language);
    expect(languages).toEqual(CXX_LANGUAGE_IDS);
    const registeredDisposable = context.subscriptions[2];
    expect(registeredDisposable).toBeDefined();
  });

  it('Given UFUNCTION 参数区 When provider 触发 Then 返回 BlueprintPure/BlueprintCallable/Category/meta snippets', async () => {
    const disposable = registerUeMacroCompletionProvider();
    try {
      const provider = registeredCompletionProvider();

      const items = await provideItems(provider, 'cpp', 'UFUNCTION(|)\nvoid DoWork();');

      expect(labels(items)).toEqual(
        expect.arrayContaining(['BlueprintPure', 'BlueprintCallable', 'Category', 'meta']),
      );
      const category = items.find((item) => item.label === 'Category');
      const meta = items.find((item) => item.label === 'meta');
      expect(category ? snippetValue(category) : '').toBe('Category="$1"');
      expect(meta ? snippetValue(meta) : '').toBe('meta=($1)');
    } finally {
      disposable.dispose();
    }
  });

  it('Given UPROPERTY 参数区 When provider 触发 Then 返回 EditAnywhere/BlueprintReadWrite snippets', async () => {
    registerUeMacroCompletionProvider();
    const provider = registeredCompletionProvider();

    const items = await provideItems(provider, 'h', 'UPROPERTY(|)\nint32 Count;');

    expect(labels(items)).toEqual(expect.arrayContaining(['EditAnywhere', 'BlueprintReadWrite']));
    const editAnywhere = items.find((item) => item.label === 'EditAnywhere');
    expect(editAnywhere ? snippetValue(editAnywhere) : '').toBe('EditAnywhere');
  });

  it('Given 非宏或非 C++ 上下文 When provider 触发 Then 返回空补全', async () => {
    registerUeMacroCompletionProvider();
    const provider = registeredCompletionProvider();

    const nonMacroItems = await provideItems(provider, 'cpp', 'void DoWork(|);');
    const nonCxxItems = await provideItems(provider, 'typescript', 'UFUNCTION(|)');

    expect(nonMacroItems).toEqual([]);
    expect(nonCxxItems).toEqual([]);
  });
});
