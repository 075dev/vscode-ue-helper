# Testing Patterns

**Analysis Date:** 2026-07-23

> 范围：VSCodeUEHelper 测试体系。**只用 Vitest**，不混 Mocha/Jest。本文件记录框架、文件布局、mock 模式、覆盖率门槛、关键回归测试、当前规模与已知陷阱。

## 1. 测试框架

- **Runner**：Vitest 1.3.x（`devDependencies.vitest: ^1.3.0`）。
- **断言库**：Vitest 内置 `expect`。
- **环境**：`environment: 'node'`（扩展宿主在测试里 mock，不走 vscode-test）。
- **Globals**：`false`（每个测试显式 `import { describe, it, expect, ... } from 'vitest'`）。
- **E2E / 集成**：**无** —— `test/integration/` 目录不存在，`test:integration` 脚本已坏（见 §6 陷阱 #1）。

## 2. 入口与目录布局

- **包含**：`test/unit/**/*.test.ts`（`vitest.config.ts:9`）。
- **排除**：`test/integration/**`（不存在）、`node_modules/**`。
- **Setup**：`test/unit/setup.ts` 在所有测试前跑（`setupFiles: ['test/unit/setup.ts']`）。

```
test/
└── unit/                                   ← 唯一测试根
    ├── setup.ts                            ← vitest setup (vscode + chokidar mock)
    ├── build/domain/entities/...
    ├── clangd/                             ← 镜像 src/clangd/
    │   ├── clangdOps.test.ts
    │   ├── fileWatcher.test.ts
    │   └── proxy/                          ← 镜像 src/clangd/proxy/
    │       ├── bridge.test.ts
    │       ├── e2eCliRestartLoop.test.ts
    │       └── ...
    ├── commands/                           ← 镜像 src/commands/
    │   └── clangdProxyCommands.test.ts
    │   └── clangdProxyCommands.test.ts.bak ← 死文件（见陷阱 #4）
    ├── core/                               ← 核心基础设施测试
    │   ├── ssot.test.ts                    ← 13 个 SSoT 回归守卫
    │   ├── workspace.test.ts               ← 14 个 WorkspaceState 行为测试
    │   └── config.test.ts
    ├── detection/
    ├── i18n/
    ├── mcp/
    ├── parsers/
    └── ui/
```

**镜像原则**：`src/foo/bar.ts` → `test/unit/foo/bar.test.ts`。新增模块必带测试。

## 3. 配置文件

### `vitest.config.ts`

```ts
{
  test: {
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    globals: false,
    environment: 'node',
    coverage: { provider: 'v8', ... },
    setupFiles: ['test/unit/setup.ts'],
  },
  resolve: { alias: { '@', '@core', '@clangd', ... } },  // 与 tsconfig 同步
}
```

### 覆盖率（v8）

| 维度 | 阈值 |
| --- | --- |
| `lines` | 80 |
| `functions` | 80 |
| `branches` | 75 |
| `statements` | 80 |

```
include: ['src/**/*.ts']
exclude: ['src/extension.ts', 'src/**/*.d.ts']
reporter: ['text', 'html', 'lcov']
```

`src/extension.ts` 排除（主入口难单测，行为覆盖靠手动 F5）。

## 4. 运行命令

```bash
npm run test:unit           # Vitest 单跑（CI 推荐）
npm run test:unit:watch     # 监听模式
npm run test:coverage       # 跑 + 覆盖率（写 coverage/）
npm test                    # 当前 = npm run test:unit （见陷阱 #1）
```

> ⚠️ `package.json:470` 的 `test` 脚本定义为 `npm run test:unit`，但根 `AGENTS.md` 与 `CHANGELOG.md` 历史声称 `test` = unit + integration。`test/integration/runTests.js` 不存在，故无 integration 步。**始终用 `npm run test:unit`**。

## 5. Mock 模式

### 5.1 `vscode` 命名空间（`test/unit/setup.ts:7-241`）

`vi.mock('vscode', () => ({ ... }))` 在 setup 阶段安装，**所有测试共享**同一份 mock。覆盖：`workspace`、`window`（含 `withProgress` / `createStatusBarItem` / `createWebviewPanel` / `createTreeView` / `registerWebviewViewProvider`）、`commands`、`languages`、`tasks`、`Uri`、`Range`、`Position`、`EventEmitter`、`Disposable`、`Diagnostic`/`DiagnosticSeverity`、`ThemeColor`/`ThemeIcon`、`TreeItem`/`TreeItemCollapsibleState`、`CompletionItem`/`CompletionItemKind`、`SnippetString`、`MarkdownString`、`RelativePattern`、`StatusBarAlignment`、`ProgressLocation`、`ConfigurationTarget`、`FileType`、`ExtensionMode`、`ViewColumn`、`ShellQuoting`、`extensions`、`env`、`version`。

要点：

- 所有 `Disposable` 返回 `{ dispose: vi.fn() }`。
- `EventEmitter` 实现 `event(listener) → { dispose }` + `fire(e)` + `dispose()`。
- `Uri.file(p)` 返回 `{ fsPath: p, path: p, scheme: 'file' }`（不解析真实路径）。
- `withProgress(_opts, task)` 立即执行 `task({ report: vi.fn() })`。
- `env.isWindows = process.platform === 'win32'`（Git-bash 下是 `win32`，所以测试跑在 Windows 假设下 —— 与产品平台一致）。

### 5.2 `chokidar` mock（`test/unit/setup.ts:249-264`）

**必须 mock**，否则真实 fs watcher 在 Node 测试里卡进程。默认 mock 返回 chainable：

```ts
{ on: vi.fn().mockReturnThis(), close: vi.fn(), add: vi.fn(), unwatch: vi.fn() }
```

`test/unit/clangd/fileWatcher.test.ts` 用 `vi.hoisted` 覆盖这个默认 mock，加 `__emit` 主动触发事件（参见 `createMockWatcher` 工厂）。

### 5.3 工厂模式（config / logger / workspaceContext / vscode.Memento）

测试文件内联工厂（不抽公共 helper）：

```ts
// test/unit/commands/clangdProxyCommands.test.ts:36
function createConfigMock(overrides?: Record<string, unknown>): Config {
  let clangdProxyEnabled = typeof overrides?.clangdProxyEnabled === 'boolean'
    ? overrides.clangdProxyEnabled : false;
  // ...getter + update mock
  return { get clangdProxyEnabled() { return clangdProxyEnabled; }, update, ... } as unknown as Config;
}

// test/unit/commands/clangdProxyCommands.test.ts:13
function createLoggerMock(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), show: vi.fn(), ... };
}

// test/unit/core/workspace.test.ts:36
function makeFakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return { keys: () => [...store.keys()], get: ..., update: ... };
}
```

`vscode.Memento` 用 `Map` 模拟，**和真实 `WorkspaceState` 行为一致**（持久化跨实例可见）。

### 5.4 `vi.spyOn` + `mockRestore`

`workspace.test.ts` 用 `vi.spyOn(vscode.window, 'showWarningMessage')` + `mockClear()` + `mockRestore()`（在 `finally` 块）。

### 5.5 文件系统 mock

`vi.mock('chokidar')` 已覆盖大部分场景。如需直接 mock `vscode.workspace.fs.*`，setup.ts 已提供（`readDirectory` / `readFile` / `stat` / `writeFile` 等）。

### 5.6 路径别名在测试中同样可用

```ts
import { Logger } from '@core/logger';
import { WorkspaceState } from '@core/workspace';
import { WorkspaceContext } from '@detection/workspaceContext';
import { MsvcParser } from '@parsers/msvcParser';
```

`vitest.config.ts` 解析别名，与 `tsconfig.json` 同步。

## 6. 关键回归测试

### 6.1 `test/unit/core/ssot.test.ts` —— SSoT 收敛守卫

**13 个 it()**（Phase 9 锁定 SSoT 契约；ESLint 规则的反向工程保险）：

- `WorkspaceState.selectedProject` / `selectedEngine` getter 必须存在（用正则匹配源码字符串）。
- `setSelectedProject` / `setSelectedEngine` 方法必须存在。
- `WorkspaceStateOptions` 必须接受可选 `workspaceContext?` 字段。
- `src/clangd/index.ts` 不能 export `writeClangdConfig` / `findClangdConfig`。
- `src/clangd/clangdConfig.ts` 不应定义 `function writeClangdConfig`。
- `commands/ui/detection` 内不再直读 `vscode.workspace.workspaceFile`（除 `detection/index.ts` + `core/workspace.ts` 例外）。
- 根 `.eslintrc.json` 必须含 `no-restricted-syntax` + `workspaceFile` 关键词。
- 根 `.eslintrc.json` 必须含 `no-restricted-imports` 规则。
- 根 `AGENTS.md` 必须把 TRAP #12 标为"已解决"。
- `src/core/AGENTS.md` 必须有 "SSoT 规则 / SSoT 收敛" 章节。

实现思路：读 `src/` / `.eslintrc.json` / `AGENTS.md` 文本，断言关键正则 / 反向正则。**注释里可以"提及"已删 API，export 才禁止**。

### 6.2 `test/unit/core/workspace.test.ts` —— WorkspaceState 行为

**14 个 it()**（实际，比 AGENTS.md 说的"12"多 2 个；2026-07-23 实测）：

注入 `workspaceContext` 后：
- `selectedProject` 返回持久化 `.uproject` 路径。
- `selectedEngine` 返回持久化引擎根。
- `setSelectedProject` / `setSelectedEngine` 持久化新值。
- setter 持久化 **跨实例可见**（重建 `WorkspaceState` 仍读到）。
- `setSelected(undefined)` 显式清除。
- `detection.ready` 时序：ready 前 `getter` 不误报，ready 后恢复；ready 后缺失 → `showWarningMessage('从 .uproject 重新生成工作区')`。
- 未注入 `workspaceContext` 时 setter 是 no-op，getter 返回 `null`，logger.warn 提示。
- `dispose()` 后 getter 返回 `null`，setter 不抛错。

`fakeDetection` 工厂构造最小 detection handle（含 `workspaceContext` + `ready` Promise）。

## 7. 当前规模

- **测试文件数**：**72** 个 `*.test.ts`（不含 `.bak`；`test/integration/` 不存在）。
- **总行数**：约 **16,300** 行（含 71 个真实测试 + 1 个 `.bak` 文件；纯运行测试约 15,500 行）。
- **测试模块覆盖**：`build/`、`clangd/`（含 14 个 `proxy/` 测试）、`commands/`（8 个）、`core/`（5 个）、`detection/`、`i18n/`、`mcp/`、`parsers/`（2 个）、`ui/`（5 个）。
- **覆盖率**：v8 阈值 `lines: 80, functions: 80, branches: 75, statements: 80`（实际值波动，运行 `npm run test:coverage` 查看 `coverage/index.html`）。

> AGENTS.md 概览声称"71 个测试文件 / 约 12k 行" —— 实际 2026-07-23 是 72 文件 / 16k 行。文档比代码滞后。

## 8. 测试结构模式

### 8.1 文件顶部 mock（`vi.hoisted`）

```ts
const mockState = vi.hoisted(() => {
  const createMockWatcher = () => ({ on: vi.fn().mockReturnThis(), ... });
  let mockWatcher = createMockWatcher();
  return { createMockWatcher, getMockWatcher: () => mockWatcher, ... };
});
```

解决 `vi.mock` 工厂中引用未初始化变量问题。

### 8.2 describe / it 嵌套

```ts
describe('SSoT surface regression', () => {
  describe('WorkspaceState.selected* getter 必须存在', () => {
    it('src/core/workspace.ts 必须包含 selectedProject getter', () => { ... });
  });
});
```

两层 `describe` 常见（"SSoT surface" → "WorkspaceState getters" → "it"）。三层的也有（如 `workspace.test.ts`）。

### 8.3 async 测试

```ts
it('setSelectedProject(value) 持久化新值', async () => {
  await workspace.setSelectedProject(fakeProject2);
  expect(workspace.selectedProject).toBe(fakeProject2.path);
});
```

`await` 是主流，**禁止 fire-and-forget 断言**（`no-floating-promises` 也会在测试里报错）。

### 8.4 错误测试

```ts
await expect(workspace.setSelectedProject(fakeProject)).resolves.toBeUndefined();
expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('setSelectedProject'));
```

### 8.5 顺序 / 数组断言

```ts
expect(diags[0]!.code).toBe('C2065');
expect(diags[0]?.code).toBe('C2065');
```

`!` 非空断言在测试里被 ESLint override 关闭，可放心用 —— 配合 `expect(diags).toHaveLength(1)` 先校验。

## 9. 已知陷阱

1. **`npm run test:integration` 已坏** —— 脚本指向 `test/integration/runTests.js`，该目录不存在。`package.json:470` 的 `test` 脚本当前是 `npm run test:unit`，但根 `AGENTS.md` 描述为 "unit + integration"。**只用 `npm run test:unit`**。
2. **`.bak` 测试文件未清** —— `test/unit/commands/clangdProxyCommands.test.ts.bak` 是手备份。`.gitignore:31` 有 `*.bak`（git 不跟踪），但文件仍在 working tree 里，`find test -name "*.test.ts"` 会带它。`git status` 不显示。提交前 `rm` 掉或保留作 archive。
3. **覆盖率门槛 75/80** —— 改了 `branches`（最低 75）可能让新代码"刚好踩线"失败；新增 case 同步补断言。
4. **chokidar 必须 mock** —— 漏了 setup.ts 的 chokidar mock 段，`fileWatcher.test.ts` 启动真实 fs watcher 卡死整个测试进程。
5. **vscode API 漂移** —— setup.ts 是手工维护的 vscode mock，新加 vscode API（如新 `DiagnosticSeverity` 成员）要同步加进 mock。
6. **MSVC 错误正则与 `package.json#contributes.problemMatchers` 必须同步** —— 测试断言 `MsvcParser` 解析后的 `line` / `column` / `code` 字段，但如果改了正则忘了同步 product code，正则断言会失败。
7. **SSoT 守卫是反向工程保险** —— 删 `.eslintrc.json` 的 `no-restricted-syntax` 规则，ESLint 不报，但 `ssot.test.ts` 会失败（双重锁）。
8. **路径别名未声明会 fail** —— 测试里用 `@core/xxx` 必须先确认 `vitest.config.ts#resolve.alias` 有声明。`@platform` 死别名，禁。
9. **`withProgress` mock 立即执行 task** —— 不要假设它是"真正异步"，回调里 `report()` 立即生效。

## 10. 编写新测试 checklist

1. 文件位置：`test/unit/<mirror-path>/<name>.test.ts`，**镜像 `src/`**。
2. 顶部 `import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'`。
3. 业务 import 用 `@core` / `@clangd` 等路径别名，不用 `../../`。
4. Mock 走 setup.ts（vscode / chokidar），**不要**在测试里再 `vi.mock('vscode', ...)` 覆盖。
5. 工厂内联到测试文件顶部（不抽公共 helper，除非复用 ≥ 3 处）。
6. 覆盖：成功路径 + 失败路径 + 边界（null / undefined / 空数组 / 跨实例）。
7. async 测试统一 `await` 断言，错误用 `await expect(...).resolves/rejects`。
8. 跑 `npm run test:unit` 全绿后跑 `npm run test:coverage` 看分支是否被覆盖。

---

*Testing analysis: 2026-07-23*
*Update when test framework or patterns change*
