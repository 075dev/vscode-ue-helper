---
rfc_id: PLAT-001
title: macOS 工具链探测可行性 RFC
status: draft
constitution_amendment: false
created: 2026-08-26
phase: 3
---

## Summary

> *本 RFC 探索 Windows + UE 5.2+ C++ 工具链探测逻辑扩展到 macOS 的可行性；当前结论草案 = No-Go，详细论证见 §Detailed Design / §Drawbacks / §Decision Matrix。*

## Motivation

> *PLAT-001 由 `.planning/REQUIREMENTS.md` §PLAT-001 提出：撰写 macOS 工具链探测可行性 RFC 草稿（仅产出 markdown，不动代码）。触发条件 = 宪法 I "Windows-First Unreal Scope" 边界修订需求评估；不构成修宪依据。本 RFC 作为决策档案保留，供 v2 下一里程碑（PLAT-002）参考。*

## Detailed Design

### Xcode clang vs MSVC clang

macOS 自带 `Apple clang`（Xcode Command Line Tools 提供），指纹格式为
`Apple clang version 15.0.0 (clang-1500.3.9.4)`；Windows 上 MSVC 工具链使用
`clang-cl`（`clang.exe -fms-compatibility-version=19.xx`）。两者命令行 flag 集合与
内置宏（`__apple_build_version__` vs `_MSC_VER`）完全不同。

当前 `src/clangd/windowsSdk.ts:47-58` `runWithEofStdin` 使用 `{ windowsHide: true }`
参数，是 Windows-only 行为（macOS 上 `windowsHide` 被忽略但不报错；如要生产级 macOS
支持需改为 platform-aware spawn 选项）。`src/clangd/windowsSdk.ts:71-75`
`discoverSystemIncludes` 通过 `cl.exe /?` 探测 MSVC 版本，macOS 上对应 `clang --version`
的输出格式完全不同（`Apple clang version N.N.N` 无 MSVC 等价物）。

**影响面**: `src/clangd/windowsSdk.ts` 整个模块 + `src/clangd/proxy/cli.ts` 的
clangd 启动参数构造逻辑。

### include path 探测

Windows 上 SDK 路径为 `C:/Program Files (x86)/Windows Kits/10/Include/<version>/`，
对应 System include 子目录（`ucrt` / `shared` / `um` / `winrt`）。当前
`src/clangd/proxy/AGENTS.md` 中标注的 6 个汉化 TODO（`localization.ts:79/91/103` +
`bridge.ts:676/685/694`）已表明 proxy 层汉化是历史未完成的承诺；如扩到 macOS，
SDK 探测路径需新增 `/Library/Developer/CommandLineTools/SDKs/MacOSX.sdk/usr/include/`
等 4 类 macOS 系统 include 路径。

`src/clangd/proxy/AGENTS.md` 第 4 行明确"代理层汉化 + 跨平台支持"是宪法 §III（locale）
与 §I（Windows-First）双重边界，新平台路径探测将立即触发宪法 I 边界扩展需求。

**影响面**: `src/clangd/proxy/bridge.ts` + `src/clangd/proxy/localization.ts` +
`src/clangd/proxy/cliArgs.ts`（参数解析需新增 `--sdk-root` 之类 platform-aware flag）。

### UBT 在非 Windows 下不存在

Unreal Build Tool 在 Windows 上为 `Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe`，
入口脚本是 `RunUAT.bat`；在 macOS 上对应 `UnrealBuildTool.dll`（需 mono runtime 加载）
+ `RunUAT.sh` shell 脚本。`src/build/ubt.ts` 当前假设 Windows shell 启动 UBT
（cmd.exe 调用链 + `.bat` 文件引用）；macOS 上 UBT 启动需经 mono 包装。

`src/build/AGENTS.md:24` `launchEditor.ts` 标注 "Windows only"，使用
`cmd /c start "" <UnrealEditor.exe> <path>.uproject>`（line 121）—— 这是 Windows
shell idiom，在 macOS 上对应 `open -a` 命令，行为完全不同。

**影响面**: `src/build/ubt.ts` + `src/build/launchEditor.ts` + `src/build/liveCoding.ts`
（Live Coding 在 macOS 上对应 `UnrealEditor-Cmd -run=LiveCoding` 模式，与 Windows 的
`Live Coding console` 触发方式不同）。

### `package.json#platforms: ["win32"]` 边界

`package.json` 中 `"platforms": ["win32"]` 是宪法 I 的硬编码载体（VS Code 扩展市场按
此字段限制发布平台）。如要扩展 macOS 支持，需将该字段改为 `["win32", "darwin"]` 或
完全移除。**任何此字段变更 = 修宪行为**，与宪法 I verbatim
"MUST NOT advertise or implement Mac/Linux support unless a constitution amendment
explicitly changes the product scope" 直接冲突。

`AGENTS.md` 第 1 行明确 "**平台支持**：**仅 Windows**（`package.json#platforms: ["win32"]`，
N1+N2+N3 死代码清理后强制）。Mac/Linux 不在支持范围。"

**影响面**: `package.json#platforms` 字段 + vsce 打包流程 + VS Code Marketplace
发布策略。

### 检测模型差异

`src/detection/AGENTS.md:22` 标注"`workspaceContext.ts` 是工作区状态持久化层，
注意业务层不应直读 `getSelected*` —— 走 `WorkspaceState.selectedProject` /
`selectedEngine` getter"。当前 `workspaceContext.ts` 的 `.code-workspace` `folders[]`
检测假设 Windows 路径（`path.sep === '\\'`），`src/detection/uprojectScanner.ts`
扫描路径使用 `path.join` 但未显式处理 macOS 大小写敏感文件系统（HFS+/APFS 默认
case-insensitive 但 server-grade 可改为 case-sensitive）。

macOS 上文件路径分隔符为 `/`，vscode.Uri.fsPath 在跨平台场景下需做 normalize
处理；Windows 网络共享路径（`\\?\UNC\...`）在 macOS 上无对应概念。

**影响面**: `src/detection/workspaceContext.ts` + `src/detection/uprojectScanner.ts`
+ `src/detection/engineDiscovery.ts` + 所有调用 `path.join` 的 detection 模块。

## Drawbacks

Go 路线在 macOS 上的具体技术风险点:

- **path separator**: `src/detection/workspaceContext.ts` 当前 `path.sep` 假设
  Windows(`\\`),所有 `.code-workspace` `folders[]` 解析与 uproject 路径拼接
  均隐含此假设。macOS 上 `path.sep === '/'`,且 vscode.Uri.fsPath 在 SMB 远程挂载
  场景下需 normalize;Windows 网络共享路径(`\\?\UNC\...`)在 macOS 上无对应概念。
- **SubprocessRegistry 在 macOS 不通用**: `src/core/subprocessRegistry.ts:52`
  `killTree` 直接调用 `taskkill /F /T /PID <pid>`,这是 Windows-only 命令;macOS 上
  `taskkill` 不存在,需改用 `process.kill(-pid, 'SIGTERM')`(+ 进程组 `detached: true`),
  触发 `SubprocessRegistry` 整套 dispose 路径重写,远超 RFC 探索性边界。
- **Live Coding 在 macOS 不存在**: `src/build/liveCoding.ts` 依赖 Windows 上的
  `Live Coding console` 触发方式(`UnrealEditor.exe` 启动后 `Ctrl+Alt+F11`);
  macOS 上对应 `UnrealEditor-Cmd -run=LiveCoding` 不同入口,与 Windows 用户的
  操作习惯不兼容。
- **UBT 工具链在 macOS 需 mono / wine 包装**: Windows 上 UBT 入口为
  `Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe`(自带 .NET runtime);
  macOS 上对应 `UnrealBuildTool.dll`(需 mono runtime 加载)或 UE 5.x 新版 native
  macOS UBT 二进制。`src/build/ubt.ts` 当前假设 Windows shell 启动 UBT(cmd.exe
  调用链 + `.bat` 文件引用),macOS 上 `.bat` 不适用需改写为 `.sh` 路径;引入 mono
  运行时依赖违反宪法 V "Minimal, Traceable, Reversible Evolution"。
- **检测模型假设 Windows shell**: `src/detection/AGENTS.md` 与
  `src/detection/workspaceContext.ts` 的 `.code-workspace` 双 esbuild 路径检测
  (`extension.js` / `clangdProxy.js`)在 cross-extension call 链中隐含 Windows-only
  语义;macOS 上 launcher 脚本从 `.bat` 变为 `.sh`,扩展进程的 working directory
  处理与 Windows 不一致。

**额外风险**:

- `src/parsers/msvcParser.ts` 正则
  `^(.*)\((\d+)(?:,(\d+))?:\s+(error|warning|note|fatal error)\s+([A-Z]+\d+):\s+(.*)$`
  仅匹配 MSVC error format;macOS clang/LLVM 输出格式为 `path:line:col: error: message`
  或 `path:line:col: fatal error: message in file included from ...`,需新增 parser,
  触发宪法 II "Single Sources of Truth" 边界扩张。
- `package.json#platforms` 字段扩展 = 修宪行为(见宪法 I verbatim):
  "MUST NOT advertise or implement Mac/Linux support unless a constitution amendment
  explicitly changes the product scope."

## Alternatives

除 Go 路线外的可执行方案:

- **No-Go + 维持现状(本 RFC 推荐)**: 文档化 Windows-First 边界,本 RFC 作为决策
  档案保留供未来参考。`package.json#platforms` 维持 `["win32"]` 不变;不引入
  Platform 枚举;`SubprocessRegistry` taskkill 路径不重构。零工程成本,零技术债,
  但放弃未来 macOS 用户增长可能性。
- **Defer 到 v2 下一里程碑(PLAT-002)**: `.planning/REQUIREMENTS.md` v2 章节
  `PLAT-002` 已登记,但前置条件 = (1) PLAT-001 RFC 通过 + (2) 启动宪法 I 修订流程
  + (3) 用户/社区确认 macOS UE 开发者需求规模。仅当前置条件全部满足时,PLAT-002
  才进入 v2 roadmap Phase 5 之后的新里程碑。
- **Hybrid 探测(仅 macOS 上追加调研代码;Windows 维持现状)**: 用户机器上报 OS =
  darwin 时,只读 `clang --version` 与 SDK 路径(不写、不发命令、不动 platform 字段),
  在 outputChannel 打印探测结果供用户手动审视。**本 RFC 不推荐**:混淆产品承诺
  (用户难以区分"探测"与"支持")、引入新分支破坏 Phase 8/9 SSoT 收尾成果
  (WorkspaceState/ClangdOps 单一真相源)。

## Open Questions

以下问题需用户/宪法修订者在 RFC approval 阶段回答:

1. macOS 工具链探测是否值得启动宪法 I 修订流程的工程成本(宪法修订需 5 原则同步
   修订 + 用户复核 + Sync Impact Report)?
2. UE 官方对 macOS C++ 工具链的支持优先级(参考 UE 5.x release notes 与官方文档)?
3. 现有 Windows 用户中是否有 macOS 跨平台工作流的具体需求(基于反馈/issue/feature
   request 数据)?
4. `SubprocessRegistry` 是否重构为 platform-agnostic(taskkill + posix kill 双路径),
   还是 macOS 上保留各自 taskkill 等价命令(`pkill -P` + `kill -TERM`)?
5. clangd 在 macOS 上的 prepareFixIts / Hover / Completion 等 LSP feature 是否需要
   macOS-specific adapter(诊断信息格式不同)?
6. UE 5.x 在 macOS 上是否仍需 mono runtime 加载 UBT,还是已发布 native macOS UBT
   二进制(影响依赖引入判断)?
7. 用户是否愿意接受 macOS 作为 Tier 2 支持平台(延迟发布、最小功能集、不进入
   Marketplace 主推荐位)?

## Decision Matrix

| Dimension | Go | No-Go | Mitigation if Go |
|-----------|----|----|------------------|
| 宪法 I Windows-First Scope | ❌ 需修宪 | ✓ 维持 | 须先经宪法 amendment 流程 + 用户复核；`package.json#platforms` 扩展为 `["win32", "darwin"]` 即触发 |
| Single Source of Truth（WorkspaceState/ClangdOps） | 需 platform-aware 分支 | ✓ 维持单一 Windows 实现 | 引入 `Platform` 枚举 + 条件分支；破坏宪法 II "MUST NOT duplicate detection state" |
| SubprocessRegistry（`taskkill` 仅 Windows） | 需 macOS 适配 | ✓ 维持 | `child_process` 在 macOS 上需 `detached: true` + `process.kill(-pid, 'SIGTERM')`；`taskkill` 不可用须重写 `src/core/subprocessRegistry.ts` 整套 dispose 路径 |
| i18n 资源（`en.json` + `zh.json`） | 已有双语文本 | ✓ 维持 | macOS 上语言环境可能为 `en-US`/`zh-CN` 等多 locale；当前 i18n 走 `t('key', params)` 已兼容 locale 切换，无需扩展 |
| Verification Gates（宪法 IV） | 需 macOS UE 项目现场烟测 | ✓ 维持 Windows 烟测基线 | `E:\Dream\XianDreamwalking`（Windows 真实 UE 项目）已存在但无对应 macOS 项目；可报告缺失而非虚构成功 |
| MSVC 正则（仅 MSVC error format） | 需 clang/LLVM error format 新解析器 | ✓ 维持 | `src/parsers/msvcParser.ts` 当前正则为 `^(.*)\((\d+)(?:,(\d+))?:\s+(error\|warning\|note\|fatal error)\s+([A-Z]+\d+):\s+(.*)$`；macOS clang 输出无 `(file:line,col): error[code]` 等价模式，需新增 parser |
| chokidar file watcher（macOS fsevents vs Windows ReadDirectoryChangesW） | 需 platform-specific backend | ✓ 维持 | `chokidar` v3 已自动选择 backend；扩展 macOS 需测试矩阵（fsevents 性能特征 + APFS case-sensitivity 边缘情况） |
| Live Coding（`src/build/liveCoding.ts`） | 需 macOS UE Editor 适配 | ✓ 维持 Windows Live Coding console | macOS 上 `UnrealEditor-Cmd -run=LiveCoding` 触发方式与 Windows 不同；非 trivial 重构 |
| UE 项目构建（UBT 工具链缺位） | 需 mono runtime 包装 | ✓ 维持 | macOS 上 `UnrealBuildTool.dll` 需 mono；引入 mono 依赖违反宪法 V "Minimal, Traceable, Reversible Evolution" |

**最终决策 = No-Go**（RFC 探索性保留）。理由：

1. 宪法 I 边界修订成本 ≫ 当前 v1 用户在 Windows 上的收益（v1 用户全部为 Windows 开发者；无 macOS 用户反馈需求）
2. Go 路线需先经宪法 amendment 流程（用户复核 + 5 原则同步修订），与本 RFC 的 "exploratory only" 边界冲突
3. macOS 上 UBT 工具链需 mono 包装（增加新运行时依赖），违反宪法 V
4. SubprocessRegistry 重构 + MSVC parser 拆分 + Live Coding 重写 = 至少 3 个独立 phase 的工程量，远超 RFC 探索性边界

如未来用户群出现 macOS 强需求，应启动独立宪法 amendment 流程（详见 §Alternatives）。

## Unresolved Questions

> **未解决假设**: 本 RFC 撰写时 MCP 检索能力(context7 / firecrawl / exa)未启用
> (见 .planning/STATE.md blockers),所有 macOS 工具链细节依赖 code-level 反推 +
> 现有文档审阅;如需精确数据(如 UE 5.x 在 macOS 上的官方工具链布局、clangd 在
> macOS 上的 fingerprint、UBT 在 macOS 的 native binary 状态)须后续启用 MCP 后补充。
> 本 RFC 所有声称"macOS 上对应 X"的内容均为基于现有 Windows 代码 + UE 5.x 公开架构
> 反推,可能存在版本差异;RFC approval 后如发现具体细节偏差需追加 erratum。

## Constitution Alignment

> **This RFC does NOT constitute a basis for amending the constitution. It is exploratory only.**
>
> 本 RFC 与宪法 I (Windows-First Unreal Scope) 一致性自检:仅产出 markdown,未修改
> `package.json#platforms`;未在 README / AGENTS / 对外文档中 advertise macOS 支持;
> 不构成修宪依据。详细自检见下。

### 一致性自检(与宪法 I verbatim 对齐)

> 宪法 I verbatim 引用(`.planning/PROJECT.md` §扩展原则 I):
> "VSCodeUEHelper targets Windows 10/11, Unreal Engine 5.2+, the MSVC toolchain, the
> Windows SDK, VS Code 1.85+, and Node.js 18+. New behavior MUST preserve this support
> boundary and **MUST NOT advertise or implement Mac/Linux support unless a constitution
> amendment explicitly changes the product scope**."

- ✓ 本 RFC 仅产出 markdown,未修改 `package.json#platforms`(仍为 `["win32"]`)
- ✓ 本 RFC 未在 README / AGENTS / 任何对外文档中"advertise" macOS 支持
- ✓ 本 RFC 明确"不构成修宪依据"——任何 amendment 须走宪法修订流程(用户复核 +
  5 原则同步修订 + Sync Impact Report)
- ✓ 本 RFC 探索性结论 = No-Go,与宪法 I "Windows-First Unreal Scope" 一致

### RFC 自我约束

- 本 RFC 不修改任何 `src/`、`test/`、`package.json`(除 RFC + verification 文档外)
- 本 RFC 不物理删除 `.specify/`、`.omp/commands/speckit.*`、`REMEDIATION-PLAN.md`、
  `AUDIT-REPORT.md`(均已在 PROJECT.md §Out of Scope 列为不删项)
- 本 RFC 不复活历史兼容函数(`populateAddCompletions`、`headerWatcher`、
  `writeClangdConfig`、`findClangdConfig`、`toggleCompletionMode`)
- 本 RFC 不修改 `.planning/PROJECT.md` §"扩展原则" I 章节本身(修宪须走
  amendment 流程,不在本 RFC scope 内)