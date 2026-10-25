<!-- Parent: ../AGENTS.md -->
# clangd 模块知识库

> 治理参考：`.specify/memory/constitution.md`。所有架构与行为约束必须与该 constitution 一致；冲突以 constitution 为准。本模块是 Constitution §II（Single Sources of Truth and Boundary Discipline）的主战场：`.clangd` 读写统一走 `ClangdOps`，工作区路径派生统一走 `WorkspaceState`。

## 平台与范围

- **仅 Windows**：UE 5.2+、MSVC 工具链、Windows SDK；Mac/Linux 不在本模块的支持范围。VS Code 设置面仅暴露 Windows 上有意义的选项。
- 详细约束见 constitution §I（Windows-First Unreal Scope）与 §III（Localized, Observable, Resource-Safe UX）。

## 模块概述

**clangd 智能提示集成**，负责：

- 生成 `compile_commands.json` (通过 UBT)
- 写入 `.clangd` 配置文件（读写统一走 `ClangdOps`；`CompileFlags.Add` 的**唯一**写入方是 `clangdFlagRenderer.writeClangdAddFlags`）
- Preparse-includes UE 宏补全文件系统
- 工作区备份防 UBT 覆盖
- 补全重写：把 `Config.userAddFlags` 经统一入口渲染后整体 force-write 到 `.clangd`

> Pitfall：原 `fast` / `slow` 模式控制器已合并（`completionMode.ts`）。模块**不再**有状态栏按钮、`toggleCompletionMode` 命令或 `toggle()` 入口；模式参数 `mode` 已被忽略，所有路径统一走 `slow`（宪法 §V：禁框架层投机；H4-B 决策）。新代码不要按 `config.completionMode` 分支决策。

## 核心文件

| 文件                           | 职责                                                                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `clangdConfig.ts`              | `defaultClangdConfig` + `renderClangdConfig` —— 模板与渲染。**不**做文件 I/O                                                    |
| `clangdYaml.ts`               | `.clangd` 多文档 YAML 原语（`parseClangdDocs` / `mergeConfigIntoDoc` / `renderClangdDocs`）—— 解析 / 合并 / 渲染。**不**做文件 I/O        |
| `clangdOps.ts`                 | [Phase 8] 统一 `.clangd` 操作 API（`readConfig` / `exists` / `writeFull` / `mutate`）—— 22 callers。**唯一**写 `.clangd` 的入口。多文档安全：读写都经 `clangdYaml.ts`，用户注释保留 |
| `clangdFlagRenderer.ts`        | `.clangd` `CompileFlags.Add` 的**唯一**渲染 + 写入入口（`renderClangdAddFlags` / `collectClangdFlagContext` / `writeClangdAddFlags`）       |
| `compileCommands.ts`           | 跑 UBT 生成 compile_commands.json（候选定位 `locateCompileCommands` + 指纹快路径的源文件探针）                                      |
| `compileCommands/dbFile.ts`    | `compile_commands.json` 读写原语（`readCompileCommands` / `writeCompileCommandsAtomic` —— temp + rename 原子替换 + 紧凑序列化）        |
| `compileCommandsFallback.ts`   | UBT 失败时的 fallback DB                                                                                                        |
| `compileCommandsCache.ts`      | 缓存层                                                                                                                          |
| `completionMode.ts`            | `CompletionModeController.rewriteClangd()` —— 把当前 userAddFlags 整体写入 `.clangd`（无 fast/slow 切分；走 `writeClangdAddFlags` 统一入口） |
| `completionFiles.ts`           | UE 宏补全文件系统（addCompletions.h 等）；含历史撒谎兼容层（已删除）；`buildCompletionHelperEntry` 纯函数（只算不写）                   |
| `preparseIncludes.ts`          | 打包的头文件列表（curated vs comprehensive）。`resources/preparse-includes/ue5-fast.json` 已删除，只剩 `ue5-slow.json`          |
| `workspaceBackup.ts`           | 备份/恢复 `.code-workspace` + `.vscode/launch.json` 防 UBT 覆盖（按原文件名存到 `.vscode/uehelper-backup/`）                      |
| `windowsSdk.ts`                | MSVC + Windows SDK 路径发现（仅 Windows）；导出 `readMsvcVersion`（读 MSVC 工具集版本，供 fms 兼容版本使用）；`detectSystemIncludesWithEngineRecommendation` 是**零调用方的遗留导出**，勿直接接线（见下方说明）                          |
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
- **`compileCommands/`** —— 编译数据库子模块：`task.ts`（UBT 任务执行）/ `symlink.ts`（`linkToWorkspaceRoot`）/ `cache.ts`（指纹快路径）/ `fillMissing.ts`（补齐缺失条目）/ `dbFile.ts`（原子读写）。**无 `index.ts`**，从 `@clangd/compileCommands` 主入口 re-export。
- **`diagnostics/`** —— "Diagnose Clangd Project" 命令的内部检查器（checks / format / io / types）。**无 `index.ts`**，从 `diagnoseProject.ts` 内部相对导入。

## 关键数据流

### compile_commands.json 生成

```
executeGenerateCompileCommands()
  ├── generateCompileCommands()
  │    ├── 跑 UBT -ProjectFiles  → 引擎根产物先复制到项目本地副本
  │    │      <projectDir>/compile_commands.json
  │    ├── locateCompileCommands()  候选顺序：项目本地副本 → helper 目录 → 引擎根
  │    └── linkToWorkspaceRoot()  → helper 目录里的符号链接指向项目本地副本
  └── 补齐缺失条目 + 注入 completionHelper → 合并成一次原子写
```

- **项目本地副本**：`<projectDir>/compile_commands.json` 是本项目自己的 DB；helper 目录（`workspace.compileCommandsPath`）里的 `compile_commands.json` 是指向它的**符号链接** —— 但 Windows 未开开发者模式时 `fs.symlink` 失败，`linkToWorkspaceRoot` 会回退 `fs.copyFile`，此时 helper 目录里是一份**独立副本**（默认状态）。
- **写入目标必须解析到真实文件**：写入前用 `resolveCompileCommandsWriteTarget(linkPath)` 解析 —— 符号链接 → 它指向的文件；独立副本 → 它自己。**两种形态下 clangd 读到的都必须是最新内容**：此前固定写项目本地副本，在独立副本场景下 clangd 读到的一直是旧内容（补齐的条目与 completionHelper 条目对它完全不可见，且无任何报错）。同理，原子写用 `rename` 覆盖链接路径会把符号链接换成普通文件，两边就此分叉 —— 所以要写它指向的文件。
- **候选顺序**：引擎根的 DB 是**共享**的（多项目共用一个引擎时可能是别的项目留下的），只作最后兜底。命中非项目本地的候选会先复制到项目本地副本再返回 → 后续写操作落在项目内，不再顺着符号链接写回引擎根。
- **一次刷新只写一次**：补齐缺失条目（`computeMissingEntries`）与注入 completionHelper（`buildCompletionHelperEntry`）都**只算不写**，最后由 `writeCompileCommandsAtomic`（temp + rename + 紧凑序列化）写**一次**。旧的 `JSON.stringify(entries, null, 2)` 会把几 MB 的 DB 放大 3~5 倍。
- **DB 的内容写入点只有 4 处**（原生 `rg` 全仓穷举 + node 递归脚本交叉验证；新增写入点必须登记到这张表）：

  | 写入点 | 写哪个文件 | 是否解析符号链接 |
  |---|---|---|
  | `commands/generateCompileCommands.ts` | clangd 实际读的那份 | ✅ `resolveCompileCommandsWriteTarget` |
  | `clangd/compileCommands/fillMissing.ts` | 同上 | ✅ 同上 |
  | `clangd/completionFiles.ts`（`addCompletionHelperToCompileCommands`） | 同上（读与写**同一个**文件） | ✅ 同上 |
  | `clangd/compileCommandsFallback.ts`（降级 stub DB） | helper 目录里的那份 | ❌ **故意不解析** —— fallback 的语义正是「让 clangd 读到这份降级 DB」 |

  > 前三处的共同铁律：**写入目标必须是 clangd 实际读取的那个文件**。helper 目录里的 `compile_commands.json` 在 Windows 未开开发者模式时是 `fs.copyFile` 回退出来的**独立副本**（默认状态），写项目本地副本 → clangd 读到的一直是旧内容，补齐的条目与 helper 条目对它完全不可见，且全程无任何报错（静默失效）。第四处是唯一例外，原因是它的写入目标**本身就是** clangd 的读路径。
  >
  > 另有 3 处 `fs.copyFile` 也碰 `compile_commands.json`，但它们是「**建立**一份 DB」而非写内容：`compileCommands/symlink.ts`（建链接 / copy 回退）与 `compileCommands.ts`（候选命中时复制到项目本地副本）。
- **补齐条目要改命令串**：克隆模板条目时同步把命令串里的源文件替换成新文件 —— `arguments` 数组优先（精确匹配模板源文件，定位不到退回末元素），否则回退到 `command` 字符串；命令串里定位不到源文件时丢弃末位 token，结果为空则**不补该条目**（宁可不补也不产生错条目）。
- **指纹快路径**：指纹只覆盖 `.uproject` / `*.uplugin` / `*.Build.cs` / `*.Target.cs` / `Build.version`，**不**收录 `.cpp` / `.h`（几千文件哈希成本过高）。所以快路径命中后还要跑一次 `probeMissingSourceEntries` 探针：若本批确有新增源文件（`added.length > 0`）就强制走一次 UBT；否则指纹命中会吞掉自动刷新，新文件永远进不了编译数据库。

### 统一补全重写（替换原 fast/slow 切换）

```
CompletionModeController.rewriteClangd()
  ├── 读 Config.userAddFlags（Config 注入在 commands/index.ts）
  ├── writeClangdAddFlags()
  │    ├── collectClangdFlagContext()  采集 ctx 五项
  │    └── renderClangdAddFlags()  flagGlossary.resolveFlags 渲染
  └── ClangdOps.applyAddFlags(...)   事务性整体替换 CompileFlags.Add
```

- ctx 五项固定：`compatHeaderPath` / `macroHelperPath` / `preparseHeaders` / `intermediateUhtDirs` / `systemIncludeFlags`。任何一项拿不到就留空（对应 flag 渲染不出），不抛异常。
- `mode` 参数仅为兼容旧调用点而保留，**实际值被忽略**（宪法 §V：禁投机分支）。
- 没有状态栏、没有 toggle 命令、没有 `populateAddCompletions` 这种撒谎兼容层（Phase 9 已删除）。
- `activateCommands` 注入 Config；`activateClangd` 监听 `config.onDidChange` → 由 `shouldRewriteClangd(e)`（判定清单是 `CLANGD_REWRITE_CONFIG_KEYS`，**单一真相源**在 `clangdFlagRenderer.ts`）判定是否重写 `.clangd`。判定清单覆盖 `clangd.userAddFlags` / `clangd.msvcRoot` / `clangd.sdkRoot` / `clangd.fmsCompatibilityVersion` 四个键，缺一不可：fms 版本变了同样要重建 `-fms-compatibility-version` flag，否则设置项与 `.clangd` 会脱节。新增 `vscodeUEHelper.clangd.*` 设置项时必须同步登记进清单（`test/unit/clangd/clangdRewriteTrigger.test.ts` 会拿 package.json 交叉核对，漏登记直接红）。
- 重复写入会被 `ClangdOps.mutate` 的「内容未变则不重写」判定挡掉（面板保存与配置变更监听会各触发一次写入）—— 不产生无谓的磁盘写与 mtime 抖动（clangd 会因 mtime 变化重建索引）。

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

`.clangd` 是 **YAML stream**：多个文档用 `---` 分隔是 clangd 的官方能力（按目录深度叠加），用户手写的 `.clangd` 经常带第二个文档：

```yaml
# 文档 1 —— 扩展管理的主文档（承载 CompileFlags）
CompileFlags:
  Add:
    - --target=x86_64-pc-windows-msvc
---
# 文档 2 —— 用户手写的 per-directory 配置
If:
  PathMatch: [Plugins/.*]
CompileFlags:
  Add: [-DPLUGIN_BUILD=1]
```

- 读写一律走 `clangdYaml.ts`：`parseClangdDocs`（多文档安全解析）→ `mergeConfigIntoDoc`（逐层递归合并）→ `renderClangdDocs`（序列化写回）。
- 扩展只改**第一个 map 文档**（主文档），其余文档**原样保留**、不参与读取。
- 合并是逐层递归的（两边都是 map 就往下走，只有叶子才整体替换）→ 用户手写的**注释在改写后依然存在**。
- 旧实现用 `yaml.parse()`，遇到第二个文档直接抛 `Source contains multiple documents` → 多文档 `.clangd` 既读不进来也写不回去（读返回 null、写返回 `parse-failed`）。

## 系统包含路径发现（Windows only）

Windows 上需要 MSVC 和 Windows SDK 头文件让 clangd 找到 `#include <windows.h>` 等。

发现顺序：

1. `vswhere.exe` → MSVC 安装路径
2. 枚举 `Microsoft Visual Studio/<version>/BuildTools/VC/Tools/MSVC/<version>/include`
3. Windows SDK `Program Files (x86)/Windows Kits/10/Include/<version>/um` + `/ucrt`

用户选定的版本会**持久化到设置项**：

| 设置项                                           | `Config` getter               | 内容                                                 |
| ------------------------------------------------ | ----------------------------- | ---------------------------------------------------- |
| `vscodeUEHelper.clangd.msvcRoot`                 | `clangdMsvcRoot`              | MSVC 工具集根目录（`...\VC\Tools\MSVC\<version>`）  |
| `vscodeUEHelper.clangd.sdkRoot`                  | `clangdSdkRoot`               | Windows SDK Include 根目录（`...\Windows Kits\10\Include\<version>`） |
| `vscodeUEHelper.clangd.fmsCompatibilityVersion`  | `clangdFmsCompatibilityVersion` | MSVC 编译器版本（`-fms-compatibility-version=`）   |

- fms 版本对应**用户选中的** msvcRoot —— 用 `windowsSdk.readMsvcVersion`（读 `cl.exe` banner）现场读，不用探测到的那个版本（可能与用户选的不是同一个）。
- **陷阱**：`windowsSdk.detectSystemIncludesWithEngineRecommendation` 内部用的是**探测值** `detected.fmsCompatibilityVersion`。它当前**零调用方**（原生 `rg` 全仓确认），但若将来被接线回去，会把上面刚统一的 fms 版本重新分叉成两处来源 —— 接线前必须改成与 `commands/setSystemIncludes.ts` 同样的「按选中的 msvcRoot 读一次、渲染与持久化共用」。
- 统一写入入口 `clangdFlagRenderer.collectClangdFlagContext` 用这两个持久化路径重建 `system-include-windows` 的 flag 组 → 之后任何一次 `.clangd` 重写（面板保存 / 配置变更）都不会把 `/imsvc` 丢掉。

UI 层通过 `vscodeUEHelper.setSystemIncludes` 命令调用本能力；MCP 层通过 `ue_set_system_includes` 工具触发；两者**都不**直接读 MSVC 路径，而是通过 `@clangd/windowsSdk` 模块；写入 `.clangd` 通过 `clangdFlagRenderer.writeClangdAddFlags`（`CompileFlags.Add` 的唯一写入方），符合宪法 §II。

## 工作区备份机制

UBT 跑 `-ProjectFiles` 时会**重写** `.code-workspace` 与 `.vscode/launch.json`，丢失用户的引擎文件夹配置。

受保护文件：项目根目录下的 `*.code-workspace` + `.vscode/launch.json`。

1. UBT 运行前 `snapshot()`：按**原文件名**复制到 `.vscode/uehelper-backup/<原文件名>`，并把被备份的文件名记进实例的 `backedUp` Map
2. UBT 完成后 `restore()`：**只**恢复 `backedUp` 里记录过的文件名；找不到同名备份就跳过并记 error（**不**退化为「取目录里第一个 `.code-workspace`」）
3. 恢复走 temp + rename **原子替换** —— 中途失败目标文件字节不变
4. backup 实例在 `src/commands/build.ts` 注入 UBT 调用链（`autoBackupWorkspace` 设置控制，默认 true）

> 旧的单文件备份 `.vscode/.code-workspace.backup` 视为过期 —— **直接忽略、不迁移**（用陈旧内容覆盖用户当前文件的风险更高）。

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

// compile_commands.json 的实际读写形状（compileCommands/dbFile.ts）
interface CompileCommandEntry {
  file: string;
  directory: string;
  command?: string;   // 与 arguments 二选一
  arguments?: string[]; // clangd 优先用它
  [key: string]: unknown; // 其它字段原样保留
}
```

> `CompletionMode` 仅在 `src/clangd/types.ts` 保留为 `'slow'` 内部类型；新代码不得恢复 `fast` 字面量或对应分支。

## 跨模块约束（宪法 §II）

- **`.clangd` 写入**：必须经 `writeClangdAddFlags`（`CompileFlags.Add` 的**唯一**写入方）或 `ClangdOps.mutate` / `writeFull`。任何模块（包括命令、UI、设置、监视器）都不得直接 `path.join + fs.writeFile` 到 `.clangd`，也不得自行调 `flagGlossary.resolveFlags` 拼 Add —— ctx 五项必须由 `clangdFlagRenderer.collectClangdFlagContext` 统一采集，否则依赖动态路径的词条会渲染出 0 个 flag。ESLint 已在仓库根 `.eslintrc.json` 锁住相关写法。
- **工作区路径派生**：必须经 `WorkspaceState` 取 `workspace.clangdConfigPath` / `workspace.clangdHelperDir` / `workspace.compileCommandsPath` 等 getter，禁止 `path.join(workspaceRoot, '.clangd')` 这类临时拼接。
- **`selectedProject` / `selectedEngine`**：命令和 UI 一律读 `workspace.selectedProject` / `workspace.selectedEngine`，不再读 `detection.workspaceContext.getSelected*`。
- **日志前缀**：本模块日志前缀 `[clangd]`；进入具体子区域可加 `[clangd/proxy]` / `[clangd/diagnostics]` 等。
