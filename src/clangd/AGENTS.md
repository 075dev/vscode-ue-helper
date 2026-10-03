<!-- Parent: ../AGENTS.md -->
# clangd 模块知识库

> 治理参考：`.specify/memory/constitution.md`。所有架构与行为约束必须与该 constitution 一致；冲突以 constitution 为准。本模块是 Constitution §II（Single Sources of Truth and Boundary Discipline）的主战场：`.clangd` 读写统一走 `ClangdOps`，工作区路径派生统一走 `WorkspaceState`。

## 平台与范围

- **仅 Windows**：UE 5.2+、MSVC 工具链、Windows SDK；Mac/Linux 不在本模块的支持范围。VS Code 设置面仅暴露 Windows 上有意义的选项。
- 详细约束见 constitution §I（Windows-First Unreal Scope）与 §III（Localized, Observable, Resource-Safe UX）。

## 模块概述

**clangd 智能提示集成**，负责：

- 生成 `compile_commands.json` (通过 UBT)
- 写入 `.clangd` 配置文件（**唯一**写入路径是 `ClangdOps`）
- Preparse-includes UE 宏补全文件系统
- 工作区备份防 UBT 覆盖
- 补全重写：把 `Config.userAddFlags` 通过 `flagGlossary.resolveFlags` 渲染后整体 force-write 到 `.clangd`

> Pitfall：原 `fast` / `slow` 模式控制器已合并（`completionMode.ts`）。模块**不再**有状态栏按钮、`toggleCompletionMode` 命令或 `toggle()` 入口；模式参数 `mode` 已被忽略，所有路径统一走 `slow`（宪法 §V：禁框架层投机；H4-B 决策）。新代码不要按 `config.completionMode` 分支决策。

## 核心文件

| 文件                           | 职责                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `clangdConfig.ts`              | `defaultClangdConfig` + `renderClangdConfig` —— 模板与渲染。**不**做文件 I/O                                                    |
| `clangdOps.ts`                 | [Phase 8] 统一 `.clangd` 操作 API（`readConfig` / `exists` / `writeFull` / `mutate`）—— 22 callers。**唯一**写 `.clangd` 的入口 |
| `compileCommands.ts`           | 跑 UBT 生成 compile_commands.json                                                                                               |
| `compileCommandsFallback.ts`   | UBT 失败时的 fallback DB                                                                                                        |
| `compileCommandsCache.ts`      | 缓存层                                                                                                                          |
| `completionMode.ts`            | `CompletionModeController.rewriteClangd()` —— 把当前 userAddFlags 整体写入 `.clangd`（无 fast/slow 切分）                       |
| `completionFiles.ts`           | UE 宏补全文件系统（addCompletions.h 等）；含历史撒谎兼容层（已删除）                                                            |
| `preparseIncludes.ts`          | 打包的头文件列表（curated vs comprehensive）。`resources/preparse-includes/ue5-fast.json` 已删除，只剩 `ue5-slow.json`          |
| `workspaceBackup.ts`           | 备份/恢复 `.code-workspace` 防 UBT 覆盖                                                                                         |
| `windowsSdk.ts`                | MSVC + Windows SDK 路径发现（仅 Windows）                                                                                       |
| `ueClangdCompat.ts`            | UE + clangd 兼容层（重写 `BODY_MACRO_COMBINE`）                                                                                 |
| `ueMacroCompletionProvider.ts` | VS Code LSP CompletionItemProvider（UE 宏补全）                                                                                 |
| `ueMacroCompletions.ts`        | UE 宏补全数据结构                                                                                                               |
| `ueReflectionLinter.ts`        | UE 反射 linter                                                                                                                  |
| `proxyManager.ts`              | 接管检测状态后构建 proxy CLI 参数                                                                                               |
| `fileWatcher.ts`               | IncrementalFileWatcher（chokidar）                                                                                              |
| `intermediateUhtCollector.ts`  | `Intermediate/Build/.../UHT` 收集                                                                                               |
| `fingerprint.ts`               | 配置指纹（缓存键）                                                                                                              |
| `flagGlossary.ts`              | clangd flag 词典（hover 提示）                                                                                                  |
| `perfLog.ts`                   | 轻量 perf 埋点单例                                                                                                              |
| `perfProxy.ts`                 | LSP proxy 开销测量                                                                                                              |
| `types.ts`                     | clangd 模块公共类型                                                                                                             |
| `modifyRspFiles.ts`            | 监听 `.rsp` 改动并写 `.clangd` ModifyFile 块                                                                                    |
| `createRspMatchers.ts`         | 构造 `.rsp` → `.clangd` 转换的 matchers                                                                                         |
| `proxyLogChannel.ts`           | proxy 输出 channel 包装                                                                                                         |
| `proxyLogTailer.ts`            | tail 真实 clangd 日志，UI 显示用                                                                                                |

## 子目录

- **`proxy/`** —— 独立 LSP 代理 CLI 进程。详见 `src/clangd/proxy/AGENTS.md`。该子进程约束：**stdout 只承载 LSP 协议帧**，所有诊断 / 日志走独立通道（宪法 §III）。
- **`diagnostics/`** —— "Diagnose Clangd Project" 命令的内部检查器（checks / format / io / types）。**无 `index.ts`**，从 `diagnoseProject.ts` 内部相对导入。

## 关键数据流

### compile_commands.json 生成

```
executeGenerateCompileCommands()
  └── generateCompileCommands()
       ├── 跑 UBT -ProjectFiles
       └── linkToWorkspaceRoot()  → 符号链接到工作区根
```

### 统一补全重写（替换原 fast/slow 切换）

```
CompletionModeController.rewriteClangd()
  ├── 读 Config.userAddFlags（Config 注入在 commands/index.ts）
  ├── flagGlossary.resolveFlags(...)  渲染
  └── ClangdOps.applyAddFlags(...)   事务性整体替换 CompileFlags.Add
```

- `mode` 参数仅为兼容旧调用点而保留，**实际值被忽略**（宪法 §V：禁投机分支）。
- 没有状态栏、没有 toggle 命令、没有 `populateAddCompletions` 这种撒谎兼容层（Phase 9 已删除）。
- `activateCommands` 注入 Config；`activateClangd` 在受支持的配置变化路径触发 `rewriteClangd()`。

### ueClangdCompat 兼容头

`createCompletionFiles` 在 `.vscode/vscodeuehelper/` 下写入 `ueClangdCompat.h`，`.clangd` 通过 `/FI` 强制在 UE 头之前包含它。该头重写 `BODY_MACRO_COMBINE` 宏，使 `UCLASS()` / `GENERATED_BODY()` 在 `.generated.h` 过期或缺失时仍能展开为合法 C++，避免 clangd 报 `unknown_typename` 错误。

## 补全数据源

> 宪法 §V：禁投机抽象。fast 列表与 slow 列表合并为单一 comprehensive 集合，新代码不要再讨论 fast/slow 选择。

| 资源                                        | 用途                                                                         |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `resources/preparse-includes/ue5-slow.json` | 唯一保留的 pre-parsed header 索引（comprehensive）。`ue5-fast.json` 已删除。 |

## .clangd 配置结构

```yaml
CompileFlags:
  Add:
    - --target=x86_64-pc-windows-msvc
    - -std=c++20
    - ... 更多 flag
    - -include${workspaceFolder}/.vscode/unreal-clangd/addCompletions.h
  Remove:
    - -W*
    - /W*
Diagnostics:
  UnusedIncludes: Strict
  MissingIncludes: Strict
InlayHints:
  Enabled: Yes
  ParameterNames: Yes
  DeducedTypes: Yes
```

## 系统包含路径发现（Windows only）

Windows 上需要 MSVC 和 Windows SDK 头文件让 clangd 找到 `#include <windows.h>` 等。

发现顺序：

1. `vswhere.exe` → MSVC 安装路径
2. 枚举 `Microsoft Visual Studio/<version>/BuildTools/VC/Tools/MSVC/<version>/include`
3. Windows SDK `Program Files (x86)/Windows Kits/10/Include/<version>/um` + `/ucrt`

UI 层通过 `vscodeUEHelper.setSystemIncludes` 命令调用本能力；MCP 层通过 `ue_set_system_includes` 工具触发；两者**都不**直接读 MSVC 路径，而是通过 `@clangd/windowsSdk` 模块；写入 `.clangd` 通过 `ClangdOps`，符合宪法 §II。

## 工作区备份机制

UBT 跑 `-ProjectFiles` 时会**重写** `.code-workspace`，丢失用户的引擎文件夹配置。

解决方案：

1. UBT 运行前：备份 `.code-workspace` 到 `.vscode/.code-workspace.backup`
2. UBT 完成后：从备份恢复
3. backup 实例在 `src/commands/build.ts` 注入 UBT 调用链（`autoBackupWorkspace` 设置控制，默认 true）

## 资源清理与生命周期

- 所有 `StatusBarItem`、watcher、`disposable` 必须 push 到 `context.subscriptions`（宪法 §III）。
- 日志统一使用前缀 `[clangd]`，例：`[clangd] wrote .clangd config`。
- 用户可见字符串走 i18n 的 `t('key', params)`，对应 `src/i18n/locales/{en,zh}.json`，**双语同步**。
- Windows-only 命令 / 选项的执行入口应早退并发出 i18n 提示，而非默默抛错。

## 关键类型

```typescript
interface ClangdConfig {
  CompileFlags: { Add: string[]; Remove: string[] };
  Diagnostics: { UnusedIncludes: string; MissingIncludes: string };
  InlayHints: { Enabled: string; ParameterNames: string; DeducedTypes: string };
}

interface CompileCommandsEntry {
  directory: string;
  command: string;
  file: string;
}
```

> `CompletionMode` 仅在 `src/clangd/types.ts` 保留为 `'slow'` 内部类型；新代码不得恢复 `fast` 字面量或对应分支。

## 跨模块约束（宪法 §II）

- **`.clangd` 写入**：必须经 `ClangdOps.writeFull` / `mutate`。任何模块（包括命令、UI、设置、监视器）都不得直接 `path.join + fs.writeFile` 到 `.clangd`。ESLint 已在仓库根 `.eslintrc.json` 锁住相关写法。
- **工作区路径派生**：必须经 `WorkspaceState` 取 `workspace.clangdConfigPath` / `workspace.clangdHelperDir` / `workspace.compileCommandsPath` 等 getter，禁止 `path.join(workspaceRoot, '.clangd')` 这类临时拼接。
- **`selectedProject` / `selectedEngine`**：命令和 UI 一律读 `workspace.selectedProject` / `workspace.selectedEngine`，不再读 `detection.workspaceContext.getSelected*`。
- **日志前缀**：本模块日志前缀 `[clangd]`；进入具体子区域可加 `[clangd/proxy]` / `[clangd/diagnostics]` 等。
