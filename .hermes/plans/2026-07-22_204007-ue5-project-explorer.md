# UE5 项目目录面板 Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 在 VSCodeUEHelper 现有 UE Helper Activity Bar 中增加一个类似 `Far-Beyond-Dev/VSCode-UE5-DevKit` 的 UE5 项目目录面板，展示 `Source`、`Content`、`Config`、`Plugins`、`.uproject`，支持递归展开、文件打开、刷新以及项目/插件相关操作入口。

**Architecture:** 新增一个基于 `vscode.TreeDataProvider` 的 `ProjectExplorerProvider`，将树节点模型、目录读取和 VS Code TreeView 适配分层。项目根目录只从现有 `WorkspaceState` 的 `projectDir/projectFile` 获取，不重新扫描或猜测 UE 项目；子目录使用 `vscode.workspace.fs` 与 `Uri.joinPath` 递归读取。插件节点解析 `.uplugin` 元数据，并通过 `contextValue` 暴露右键菜单/行内命令。第一阶段优先交付稳定的目录浏览体验；插件单独构建仅在现有 UBT 能力可复用且测试覆盖后接入。

**Tech Stack:** TypeScript strict、VS Code Extension API (`TreeDataProvider`/`TreeView`/`workspace.fs`/`Uri`)、Vitest、现有 `WorkspaceState`、`Config`、`@commands`、i18n 双语资源。

---

## Baseline（已核验，2026-07-22 20:40）

以下事实均来自本轮读取/搜索，不基于旧记忆：

| 检查 | 实际结果 |
|---|---|
| `search_files(target=content, pattern="TreeDataProvider", path="src", file_glob="*.ts")` | 0 个匹配 |
| `search_files(target=content, pattern="createTreeView", path="src", file_glob="*.ts")` | 0 个匹配 |
| `package.json` 的 `viewsContainers`/`views` | 已有 Activity Bar 容器 `ueHelper`；已有一个 `type: "webview"` 的 `vscodeUEHelper.controlPanel` 视图 |
| `src/ui/index.ts` | `activateUI()` 目前只创建/渲染 `StatusBarManager`，并处理输出通道与诊断集合清理；没有目录树注册 |
| `src/extension.ts` | 入口创建 `WorkspaceState`、`ClangdOps`，调用 `activateUI()`、`activateCommands()`，随后注册 `ControlPanelProvider` |
| `src/commands/index.ts` | 已注册 `vscodeUEHelper.build`、`rebuild`、`clean`、`launchEditor` 等命令；没有目录面板 refresh/open-file/plugin-build 命令 |
| `src/core/workspace.ts` | 已有 `projectDir`、`projectFile`、`projectName` 等派生 getter；`WorkspaceState` 是项目/引擎路径单一真相源 |
| 参考仓库 `Far-Beyond-Dev/VSCode-UE5-DevKit` | `src/ui/SolutionExplorer.ts` 实现 `TreeDataProvider`，创建 `ue5SolutionExplorer`，根节点展示 `Source`/`Content`/`Config`/`Plugins` 和 `.uproject`，支持递归文件夹、插件 `.uplugin`、buildable plugin context value、文件点击打开 |
| 参考仓库 `package.json` | 声明 `viewsContainers.activitybar.ue5Explorer`、`views.ue5SolutionExplorer`、`view/title` refresh、`view/item/context` 与 `view/item/inline` 菜单 |
| 当前测试基础设施 | `test/unit/setup.ts` 已 mock `vscode.workspace.findFiles`、文件 watcher、Webview 等，但尚未 mock `createTreeView`、`TreeItem`、`ThemeIcon`、`EventEmitter`、`workspace.fs` |

**需要实现时重新验证的命令：**

```bash
# 目录树当前不存在性
rg -n "TreeDataProvider|createTreeView" src --glob '*.ts' || true

# 当前贡献点与命令
node -e "const p=require('./package.json'); console.log(JSON.stringify({viewsContainers:p.contributes.viewsContainers, views:p.contributes.views, commands:p.contributes.commands.map(x=>x.command)}, null, 2))"

# 当前验证门禁
npm run test:unit
npm run lint
npm run typecheck
npm run build
npm run format:check
```

---

## 目标行为与范围

### 必须交付（MVP）

1. 在现有 `UE Helper` Activity Bar 容器中新增 `Project Explorer`/`项目目录` Tree View，不替换现有 Control Panel Webview。
2. 只在检测到有效项目时显示；没有项目时不崩溃，并通过空状态或 Tree View 描述给出可理解的提示。
3. 根节点按固定顺序展示实际存在的：
   - `Source`
   - `Content`
   - `Config`
   - `Plugins`
   - 当前 `.uproject` 文件
4. 文件夹支持递归展开；文件夹优先、文件其次，并按名称排序。
5. 单击可打开文件；`.uproject`、`.uplugin`、C++ 源文件、配置文件等统一使用 `vscode.open` 打开。
6. Tree View 标题栏提供刷新按钮；刷新不会泄漏监听器或 Tree View。
7. `Plugins/<PluginName>/<PluginName>.uplugin` 被识别为插件节点；插件节点展开后显示 `.uplugin` 和实际存在的 `Source`/`Content`/`Config`。
8. 插件是否可构建由 `Source` 目录存在且至少包含条目决定，写入 `contextValue = 'buildablePlugin'`；不可构建插件使用普通 `plugin` context value。
9. 所有新增用户可见文案同时加入 `src/i18n/locales/en.json` 与 `src/i18n/locales/zh.json`。
10. 所有资源注册到 `context.subscriptions`，并覆盖刷新、无项目、读取失败、文件删除/变更后的行为。

### 第一版明确不做

- 不复制参考仓库的独立 `ProjectManager`/`PathUtils` 层；当前项目已经有 `WorkspaceState` 和统一命令注册结构。
- 不把引擎整个目录树放进项目树；该面板只展示当前 Unreal 项目。
- 不引入新的文件系统扫描规则来替代当前 `.code-workspace` 检测模型；目录树只消费已选项目根路径。
- 不新增“Package Project”命令，因为当前仓库没有对应实现；菜单只挂接当前已有且可验证的 `build`、`launchEditor` 等命令。
- 不在未验证 UBT 参数前实现插件单独构建；先保留 `buildablePlugin` context value 和扩展点，插件构建作为后续垂直切片。

---

## Task 1: 定义目录树领域模型与纯排序/节点辅助函数

**Objective:** 建立不依赖 VS Code UI 的节点类型与排序/展示规则，先把目录面板的可测试行为固定下来。

**Files:**
- Create: `src/ui/projectExplorerModel.ts`
- Test: `test/unit/ui/projectExplorerModel.test.ts`

**Step 1: Write failing tests**

覆盖以下行为：

```typescript
it('folders come before files and both groups are sorted by name', () => {
  const result = sortExplorerEntries([
    { name: 'z.cpp', kind: 'file' },
    { name: 'Source', kind: 'directory' },
    { name: 'Config', kind: 'directory' },
    { name: 'a.h', kind: 'file' },
  ]);

  expect(result.map((entry) => entry.name)).toEqual(['Config', 'Source', 'a.h', 'z.cpp']);
});

it('recognizes only a matching plugin descriptor under the plugin folder', () => {
  expect(isPluginDescriptor('MyPlugin', 'MyPlugin.uplugin')).toBe(true);
  expect(isPluginDescriptor('MyPlugin', 'Other.uplugin')).toBe(false);
});

it('marks a plugin buildable only when Source contains at least one entry', () => {
  expect(isBuildablePlugin(true, 1)).toBe(true);
  expect(isBuildablePlugin(true, 0)).toBe(false);
  expect(isBuildablePlugin(false, 1)).toBe(false);
});
```

**Step 2: Run the focused test and verify RED**

```bash
npx vitest run test/unit/ui/projectExplorerModel.test.ts
```

Expected: FAIL because `src/ui/projectExplorerModel.ts` and its exports do not exist.

**Step 3: Write the minimal implementation**

定义中文注释的类型与纯函数，至少包括：

```typescript
export type ExplorerEntryKind = 'directory' | 'file';

export interface ExplorerFsEntry {
  readonly name: string;
  readonly kind: ExplorerEntryKind;
}

export function sortExplorerEntries(entries: readonly ExplorerFsEntry[]): ExplorerFsEntry[];
export function isPluginDescriptor(pluginName: string, fileName: string): boolean;
export function isBuildablePlugin(hasSourceDirectory: boolean, sourceEntryCount: number): boolean;
```

函数不得访问文件系统或 VS Code，保证后续测试只验证行为。

**Step 4: Run the focused test and verify GREEN**

```bash
npx vitest run test/unit/ui/projectExplorerModel.test.ts
```

Expected: PASS。

---

## Task 2: 建立可替换的目录读取适配器

**Objective:** 将 `workspace.fs.readDirectory/stat/readFile` 封装为可测试接口，避免 Tree Provider 直接散落文件系统调用。

**Files:**
- Create: `src/ui/projectExplorerFs.ts`
- Test: `test/unit/ui/projectExplorerFs.test.ts`
- Modify: `test/unit/setup.ts`（补齐 `workspace.fs`、`FileType`、必要的 `Uri` mock；只改测试 mock）

**Step 1: Write failing tests**

至少覆盖：

- 目录读取把 `FileType.Directory` 映射为 `kind: 'directory'`，普通文件映射为 `kind: 'file'`。
- 目录读取失败时返回带错误的结果或由上层可识别的失败分支，不静默伪造空目录。
- 通过 `Uri.joinPath` 生成子节点 URI，不使用 Node `path.join`。
- `.uplugin` JSON 读取失败时返回 `undefined`，不让整个 Tree View 崩溃。

建议的可测试接口：

```typescript
export interface ProjectExplorerFs {
  readDirectory(uri: vscode.Uri): Promise<readonly ExplorerFsEntry[]>;
  readPluginDescriptor(uri: vscode.Uri): Promise<unknown | undefined>;
  hasEntries(uri: vscode.Uri): Promise<boolean>;
}
```

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/ui/projectExplorerFs.test.ts
```

Expected: FAIL，原因是适配器和/或 VS Code mock 尚未存在。

**Step 3: Write minimal implementation**

实现默认适配器：

- 使用 `vscode.workspace.fs.readDirectory(uri)`。
- 使用 `vscode.workspace.fs.readFile(uri)` 读取 UTF-8 JSON。
- 只捕获预期的 I/O/JSON 异常并记录给调用方；日志前缀使用 `[projectExplorer]`。
- 对 `Source` 的 buildable 判断只需 `readDirectory().length > 0`，不深度扫描。
- 不读取 `.env`、凭据等敏感文件内容；`.uplugin` 只解析用于展示/构建标记所需的 JSON。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/ui/projectExplorerFs.test.ts
```

Expected: PASS。

---

## Task 3: 实现 Tree Item 与根目录模型

**Objective:** 让 Tree Provider 能从 `WorkspaceState.projectDir/projectFile` 构建与参考项目一致的 UE 根目录节点。

**Files:**
- Create: `src/ui/projectExplorer.ts`
- Test: `test/unit/ui/projectExplorer.test.ts`

**Step 1: Write failing tests**

使用注入的 `ProjectExplorerFs`，覆盖：

```typescript
it('returns the UE project root entries in the expected order', async () => {
  const children = await provider.getChildren();

  expect(children.map((item) => item.label)).toEqual([
    'Source',
    'Content',
    'Config',
    'Plugins',
    'Sample.uproject',
  ]);
});

it('omits root folders that do not exist', async () => {
  // 只让 Source 和 .uproject 存在
  expect((await provider.getChildren()).map((item) => item.label)).toEqual([
    'Source',
    'Sample.uproject',
  ]);
});

it('returns no children before detection/workspace state has a project', async () => {
  expect(await provider.getChildren()).toEqual([]);
});
```

测试 Tree Item 的：

- 文件夹使用 `Collapsed`。
- 文件使用 `None`。
- `.uproject` 与 `.uplugin` 的 `contextValue` 正确。
- 文件节点携带 `vscode.open` command 和对应 URI。
- `.h/.cpp/.cs/.uasset` 使用稳定的内置 `ThemeIcon` 映射；未知扩展名使用普通文件图标。

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts
```

Expected: FAIL，因为 provider 和 Tree Item 尚未实现。

**Step 3: Write minimal implementation**

定义并导出：

```typescript
export type ProjectExplorerNodeKind = 'root' | 'directory' | 'file' | 'plugin';

export interface ProjectExplorerNode {
  readonly uri: vscode.Uri;
  readonly label: string;
  readonly kind: ProjectExplorerNodeKind;
  readonly contextValue?: 'folder' | 'file' | 'uprojectFile' | 'plugin' | 'buildablePlugin';
  readonly collapsible: boolean;
  readonly pluginName?: string;
}

export class ProjectExplorerProvider implements vscode.TreeDataProvider<ProjectExplorerNode> {
  static readonly viewType = 'vscodeUEHelper.projectExplorer';
  readonly onDidChangeTreeData: vscode.Event<ProjectExplorerNode | undefined | null | void>;

  constructor(
    private readonly workspace: WorkspaceState,
    private readonly fs: ProjectExplorerFs,
    private readonly logger: Logger,
  );

  refresh(): void;
  getTreeItem(element: ProjectExplorerNode): vscode.TreeItem;
  getChildren(element?: ProjectExplorerNode): Promise<ProjectExplorerNode[]>;
}
```

实现约束：

- 项目根只读 `workspace.projectDir` 和 `workspace.projectFile`；不能从 `vscode.workspace.workspaceFolders` 重新推断项目。
- 子 URI 使用 `vscode.Uri.joinPath`。
- 根目录只展示存在的五类条目；不要把 `Binaries`、`Intermediate`、`Saved` 等生成目录默认塞入根节点，以保持参考项目的开发者视图。
- 普通目录递归读取并使用 Task 1 的排序函数。
- 读取失败时记录 `[projectExplorer]` 警告并返回空 children，不能抛出导致扩展激活失败。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts
```

Expected: PASS。

---

## Task 4: 增加插件节点识别与递归展开

**Objective:** 对齐参考项目的 Plugins 体验：显示插件、插件描述文件、插件标准目录，并标记可构建插件。

**Files:**
- Modify: `src/ui/projectExplorer.ts`
- Modify: `src/ui/projectExplorerFs.ts`（如需要补充插件目录探测 helper）
- Modify: `test/unit/ui/projectExplorer.test.ts`
- Modify: `test/unit/ui/projectExplorerFs.test.ts`

**Step 1: Write failing tests**

覆盖：

1. `Plugins/GoodPlugin/GoodPlugin.uplugin` 被识别为 `plugin`。
2. `Plugins/GoodPlugin/Source` 存在且非空时 context value 是 `buildablePlugin`。
3. `Plugins/EmptyPlugin/Source` 不存在或为空时 context value 是 `plugin`。
4. 插件展开顺序是 `.uplugin`、`Source`、`Content`、`Config`（仅展示存在项）。
5. Plugins 目录下没有匹配 `.uplugin` 的子目录时，不伪造插件节点；普通目录仍可按普通目录展示或按产品决策隐藏，测试固定其中一种行为。

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts test/unit/ui/projectExplorerFs.test.ts
```

Expected: 新增插件行为失败。

**Step 3: Write minimal implementation**

- Plugins 根节点的 child discovery 只查直接子目录。
- 每个插件目录只认同名 `.uplugin`，避免把无关 `.uplugin` 错标为插件。
- 读取 descriptor 失败时仍显示插件目录，但标记为不可构建并记录 warning。
- 不依赖 descriptor 中未建模字段；可构建判定继续使用 `Source` 目录非空。
- 插件内部的普通目录继续走通用递归逻辑。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts test/unit/ui/projectExplorerFs.test.ts
```

Expected: PASS。

---

## Task 5: 将 Tree Provider 注册到现有 UE Helper Activity Bar

**Objective:** 在扩展激活时创建真正的 `TreeView`，与当前 Control Panel 并存，并保证资源生命周期正确。

**Files:**
- Modify: `src/ui/index.ts`
- Modify: `src/extension.ts`（仅在 `activateUI` 返回/依赖传递需要时修改）
- Modify: `test/unit/ui/projectExplorer.test.ts`
- Modify: `test/unit/setup.ts`

**Step 1: Write failing tests**

覆盖：

- `activateUI()` 调用 `vscode.window.createTreeView('vscodeUEHelper.projectExplorer', { treeDataProvider, showCollapseAll: true })`。
- 创建的 TreeView disposable 被推入 `context.subscriptions`。
- UI dispose 时 provider 的 EventEmitter、TreeView 和文件监听器都被释放。
- `detection.ready` 尚未完成时不触发错误通知或把项目误判为缺失；首次刷新等待 WorkspaceState 注入完成或安全返回空结果。
- Workspace 重新检测/项目切换后可以调用 provider.refresh()。

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts
```

Expected: FAIL，因为测试 mock 与 UI 激活流程尚未具备 Tree View 注册。

**Step 3: Write minimal implementation**

在 `UIHandles` 中增加：

```typescript
export interface UIHandles {
  statusBar: StatusBarManager;
  projectExplorer: ProjectExplorerProvider;
}
```

在 `activateUI()` 中：

1. 创建 `ProjectExplorerFs` 默认实现与 `ProjectExplorerProvider`。
2. 调用 `vscode.window.createTreeView(ProjectExplorerProvider.viewType, ...)`。
3. 将 TreeView disposable、provider disposable/清理函数、已有 UI dispose 统一推入 `context.subscriptions`。
4. 监听 `detection.ready` 完成后刷新一次；不要在 ready 前通过 `WorkspaceState` getter 触发“工作区缺失”误报。
5. 先不要新增主动的全盘 watcher；如果实现文件变化自动刷新，使用精确的项目根/Source/Content/Config/Plugins watcher，并在测试中验证 dispose。若 watcher 会引入真实 fs 卡住 Vitest，则暂时只提供手动刷新，避免违反仓库已有 `chokidar` mock 约束。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts
```

Expected: PASS。

---

## Task 6: 增加 package.json 视图、标题栏刷新与 i18n

**Objective:** 让 Tree View 在 VS Code UI 中可见，并提供与参考项目一致的标题栏刷新入口。

**Files:**
- Modify: `package.json`
- Modify: `src/commands/index.ts`
- Create: `src/commands/refreshProjectExplorer.ts`
- Modify: `src/ui/projectExplorer.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`
- Test: `test/unit/commands/refreshProjectExplorer.test.ts`
- Modify: `test/unit/ui/projectExplorer.test.ts`

**Step 1: Write failing tests**

命令测试验证：

```typescript
it('refreshProjectExplorer calls the provider refresh method', () => {
  const provider = { refresh: vi.fn() };
  executeRefreshProjectExplorer(provider);
  expect(provider.refresh).toHaveBeenCalledOnce();
});
```

同时加入 package manifest 结构断言（可放在 `projectExplorer.test.ts` 的 JSON 读取测试中）：

- `vscodeUEHelper.projectExplorer` 存在于 `contributes.views.ueHelper`。
- `view/title` 中有 `vscodeUEHelper.refreshProjectExplorer`，条件为 `view == vscodeUEHelper.projectExplorer`，组为 `navigation`。

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/commands/refreshProjectExplorer.test.ts test/unit/ui/projectExplorer.test.ts
```

Expected: FAIL，因为命令、manifest view 和菜单不存在。

**Step 3: Write minimal implementation**

- `package.json` 增加：
  - command：`vscodeUEHelper.refreshProjectExplorer`，英文/中文标题，`$(refresh)`。
  - view：保留现有 `vscodeUEHelper.controlPanel`，新增 `type: 'tree'`、`id: 'vscodeUEHelper.projectExplorer'`、`name`/`name@zh`。
  - `menus.view/title`：只在目标 view 显示 refresh。
- `src/commands/refreshProjectExplorer.ts` 只接收 provider，调用 `refresh()`，不重新执行检测。
- `src/commands/index.ts` 注册该命令，遵循现有 `registerCommand`/`track` 结构。
- i18n 增加项目树名称、空状态、刷新失败/读取失败、插件 tooltip 等 key；用户可见字符串不硬编码在 provider 中。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/commands/refreshProjectExplorer.test.ts test/unit/ui/projectExplorer.test.ts
```

Expected: PASS。

---

## Task 7: 增加文件打开、项目操作和上下文菜单

**Objective:** 让目录节点不仅可浏览，还能复用当前项目已有命令完成基础 UE 工作流。

**Files:**
- Create: `src/commands/openProjectExplorerFile.ts`
- Modify: `src/commands/index.ts`
- Modify: `package.json`
- Modify: `src/ui/projectExplorer.ts`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`
- Test: `test/unit/commands/openProjectExplorerFile.test.ts`
- Modify: `test/unit/ui/projectExplorer.test.ts`

**Step 1: Write failing tests**

覆盖：

1. 文件节点点击 command 指向 `vscodeUEHelper.openProjectExplorerFile`，参数是 `vscode.Uri`。
2. 执行命令时调用 `vscode.commands.executeCommand('vscode.open', uri)`。
3. 非文件节点不会被当作文件打开；无效参数会安全返回并记录 warning。
4. `.uproject` 节点的 `contextValue` 为 `uprojectFile`；插件节点 context value 与 buildable 状态保持一致。

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/commands/openProjectExplorerFile.test.ts test/unit/ui/projectExplorer.test.ts
```

Expected: FAIL。

**Step 3: Write minimal implementation**

- 新增 `vscodeUEHelper.openProjectExplorerFile` 命令。
- 只打开 Tree Item 传入的 `vscode.Uri`，不自行解析字符串路径。
- `package.json` 增加 `view/item/context`：
  - `uprojectFile`：挂接现有 `vscodeUEHelper.build`、`vscodeUEHelper.launchEditor`。
  - `buildablePlugin`：本任务只预留命令组，不挂不存在的插件构建命令；不要写死失效 command。
- `view/item/inline` 只使用当前可验证命令；项目节点可提供 build/launch 两个 inline 操作，但要避免在同一节点上重复显示过多按钮。
- 菜单条件必须同时包含 `view == vscodeUEHelper.projectExplorer`，避免污染其他 Tree View。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/commands/openProjectExplorerFile.test.ts test/unit/ui/projectExplorer.test.ts
```

Expected: PASS。

---

## Task 8: 为项目变更、刷新与错误路径补齐回归测试

**Objective:** 保证目录面板在 UE 工程常见变化下稳定，不因文件系统异常拖垮扩展。

**Files:**
- Modify: `src/ui/projectExplorer.ts`
- Modify: `src/ui/projectExplorerFs.ts`
- Modify: `test/unit/ui/projectExplorer.test.ts`
- Modify: `test/unit/ui/projectExplorerFs.test.ts`
- Modify: `test/unit/setup.ts`（仅补充缺失 mock）

**Step 1: Write failing tests**

覆盖：

- 根目录不存在时返回空树并记录 `[projectExplorer]` warning。
- 某个子目录读取失败时，其他根节点仍可显示。
- `.uplugin` JSON 损坏时插件仍可浏览。
- `refresh()` 触发一次 `onDidChangeTreeData`，不会创建第二个 provider 或第二个 TreeView。
- dispose 后 refresh 不再触发事件。
- 大目录只在展开节点时读取，不在根节点初始化时递归读取全部内容。

**Step 2: Run focused tests and verify RED**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts test/unit/ui/projectExplorerFs.test.ts
```

Expected: 新增异常/生命周期断言失败。

**Step 3: Write minimal implementation**

- 将错误处理限制在 provider/FS adapter 边界。
- 对同一次刷新避免重复读取同一目录；如引入 cache，cache 只存在于 provider，刷新时清除，不增加全局状态。
- 不要把用户项目文件内容发送到 Webview 或日志；只记录 URI/错误类别。
- 注释全部使用中文，并保持 `[projectExplorer]` 日志前缀。

**Step 4: Run focused tests and verify GREEN**

```bash
npx vitest run test/unit/ui/projectExplorer.test.ts test/unit/ui/projectExplorerFs.test.ts
```

Expected: PASS。

---

## Task 9: 评估并单独规划插件构建垂直切片（仅在需要时执行）

**Objective:** 如果用户要求达到参考项目的“右键/行内构建插件”完整体验，再在目录浏览完成后接入插件 UBT 构建；否则保留 `buildablePlugin` 标识但不引入未验证命令。

**Files（预期，需先重新读取后确定）：**
- Modify: `src/build/ubt.ts`
- Modify: `src/build/types.ts`
- Modify: `src/commands/buildPlugin.ts`
- Modify: `src/commands/index.ts`
- Modify: `package.json`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh.json`
- Test: `test/unit/build/ubt.test.ts`
- Test: `test/unit/commands/buildPlugin.test.ts`

**前置验证：** 先确认 UBT 对 `.uplugin` 的实际参数格式、当前 `buildUBTCommand()` 是否允许 plugin target，以及现有 `BuildResult`/进度/诊断管线是否可复用；不得仅凭参考仓库的 command 名称猜测参数。

**TDD 顺序：**

1. 先写 plugin target 命令构造失败测试。
2. 运行测试确认 RED。
3. 实现最小 `buildPlugin` 参数构造和命令执行。
4. 覆盖取消、插件无 Source、插件 descriptor 损坏、UBT 失败诊断。
5. 再把 `buildablePlugin` 的 `view/item/context`/`view/item/inline` 菜单绑定到已存在并通过测试的 command。

如果产品范围仅是“目录面板”，此任务标记为 deferred，不应阻塞 MVP。

---

## Task 10: 集成验证、打包验证和手工验收

**Objective:** 验证新增目录面板不会破坏现有扩展激活、控制面板、命令与构建产物。

**Files:**
- No new production files expected；必要时只修复前述任务暴露的问题。
- Test: 所有受影响的 `test/unit/ui/*` 与 `test/unit/commands/*`。

**Step 1: 运行相关单元测试**

```bash
npx vitest run \
  test/unit/ui/projectExplorerModel.test.ts \
  test/unit/ui/projectExplorerFs.test.ts \
  test/unit/ui/projectExplorer.test.ts \
  test/unit/commands/refreshProjectExplorer.test.ts \
  test/unit/commands/openProjectExplorerFile.test.ts
```

Expected: 全部 PASS。

**Step 2: 运行完整项目门禁**

```bash
npm run test:unit
npm run lint
npm run typecheck
npm run build
npm run format:check
```

Expected：

- Vitest unit 全部通过。
- ESLint 无新增 error/warning。
- `tsc --noEmit` 零错误。
- esbuild 成功生成 `out/extension.js`、`out/clangdProxy.js` 与 launcher。
- Prettier 检查通过。

不要把 `npm test` 作为唯一门禁，因为仓库已核验 `test:integration` 指向不存在的目录；本项目当前应使用 `npm run test:unit`。

**Step 3: VS Code Extension Development Host 手工验收**

使用 `.vscode/launch.json` 的 Extension Development Host：

1. 打开包含当前 `.code-workspace` 与 `.uproject` 的 UE 工作区。
2. 点击 `UE Helper` Activity Bar，确认 `Project Explorer` 与 `Control Panel` 同时存在。
3. 验证根节点只显示存在的 `Source`、`Content`、`Config`、`Plugins`、`.uproject`。
4. 展开普通目录与插件目录，确认文件夹优先、字母排序、插件 `.uplugin` 正确显示。
5. 点击 `.h`、`.cpp`、`.uproject`、`.uplugin`，确认都由 VS Code 编辑器打开。
6. 点击标题栏刷新，确认树刷新且没有重复节点/重复日志。
7. 在无项目、损坏 `.uplugin`、删除目录的情况下刷新，确认扩展不崩溃且有可理解的 warning/空状态。
8. 确认现有 Control Panel、状态栏、Build、Launch Editor 命令仍正常。

**Step 4: 产物检查**

```bash
npm run package
```

检查生成的 `.vsix` 中包含新的 `package.json` 贡献点和 `out/extension.js`，不包含 `src/`、`test/` 或敏感配置文件。

---

## 风险、取舍与开放问题

1. **项目根路径与当前检测模型的耦合**：当前 detection 明确“信任 `.code-workspace`”，因此目录面板必须使用 `WorkspaceState` 的已选项目；不能退回“扫描所有 workspace folder 找 `.uproject`”。如果用户需要在一个工作区中切换多个项目，后续应先扩展 `WorkspaceState`/选择模型，再扩展 Tree Provider。
2. **VS Code mock 成本**：当前 `test/unit/setup.ts` 没有 Tree View 相关 mock。建议先补齐最小 mock，再写 provider 集成测试；不要为了测试直接依赖真实 VS Code Extension Host。
3. **实时刷新策略**：参考项目主要提供手动 Refresh。本计划默认先实现手动刷新，避免 watcher 对大型 UE 工程产生高频事件和 Vitest 残留；只有用户明确需要实时同步时，才增加精确 watcher 并单独测 dispose。
4. **生成目录噪声**：递归展开普通目录会看到 `Intermediate`、`Binaries` 等内容，但根节点不展示它们。是否默认排除这些目录是产品决策；MVP 不做全局排除，以免误删用户希望查看的目录。
5. **插件构建参数未验证**：参考仓库的 `buildPluginInline` 不能直接复制，因为当前仓库已有 UBT 命令结构不同。必须先通过现有 UBT 管线与测试确认参数，否则只交付 `buildablePlugin` 标记和未来菜单扩展点。
6. **文件图标**：MVP 使用内置 `ThemeIcon`，不复制参考仓库的 Unreal PNG 图标，降低打包资源与主题适配风险。若视觉上需要 Unreal 专属图标，再作为独立资源任务加入。

---

## 完成定义

- [ ] `Project Explorer` Tree View 在现有 `UE Helper` Activity Bar 中可见，并与 Control Panel 并存。
- [ ] 根目录、递归目录、插件节点、`.uproject` 节点和文件打开行为均有自动化测试。
- [ ] 刷新命令、生命周期清理、I/O/JSON 错误路径均有自动化测试。
- [ ] 所有用户可见字符串有 en/zh 两份 i18n。
- [ ] 生产代码没有绕过 `WorkspaceState` 猜测项目根，也没有引入未验证的插件构建 command。
- [ ] `npm run test:unit`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run format:check` 全部通过。
- [ ] Extension Development Host 完成手工验收。

**Plan complete and saved. Ready to execute using subagent-driven-development — I'll dispatch a fresh subagent per task with two-stage review (spec compliance then code quality). Shall I proceed?**
