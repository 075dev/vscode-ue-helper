# Phase 8: ue-header-auto-sync - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning

<domain>
## Phase Boundary

本阶段交付 **UE 反射头文件自动同步** 功能：当 UE C++ 工程的 `.h` 文件（包含 `UCLASS|USTRUCT|UENUM|UINTERFACE|UFUNCTION|UPROPERTY|GENERATED_BODY` 任意反射宏）被保存时，自动触发 `generateCompileCommands`（UBT GenerateClangDatabase 模式）重新生成 `.generated.h`，避免 clangd 因 UHT 行号烧进而报 `FID_*_PROLOG unknown_typename` 错。

阶段仅交付 **1 个文件监听器 + 1 个激活期注入点**，不动 UE 类型补全、include 路径补全、跳转定义穿透、引用搜索（这些归 Phase 8-其余子功能）。

**核心问题：** UHT 把 `GENERATED_BODY()` 所在行号硬编码进 `FID_<Project>_<Path>_<Line>_PROLOG` 宏名。任何对 `.h` 文件的非 `GENERATED_BODY()` 行改动（加注释、加空行、调顺序）都会让宏名失效，clangd 报 unknown_typename。本阶段让 watcher 自动保持 `.generated.h` 与 `.h` 同步。

</domain>

<decisions>
## Implementation Decisions

### 触发机制
- **D-01:** 使用 VS Code `vscode.workspace.onDidSaveTextDocument` 监听保存事件（不用 FileSystemWatcher — `onDidSave` 已经提供 file-level granularity，避免 content hash 误触发）
- **D-02:** 触发条件**严格**：文件后缀必须 `.h`（不包含 `.hpp`/`.inl`/`.cpp`）+ 文件内容必须匹配正则 `/\b(?:UCLASS|USTRUCT|UENUM|UINTERFACE|UFUNCTION|UPROPERTY|GENERATED_BODY|UMETA)\b/`
- **D-03:** 文件必须在 `workspace.projectFolder` 之内（含子目录），不在项目内的不触发
- **D-04:** debounce 时长 **1500ms**：连续保存多文件时合并为单次 UBT 调用；保存单文件后 1.5 秒安静期触发

### 用户控制
- **D-05:** 默认 **开启**，新增 setting `vscodeUEHelper.clangdHeaderWatcher.enabled`（default: true），用户可手动关闭
- **D-06:** setting 注册位置：`package.json#contributes.configuration.properties` + `src/core/config.ts` 强类型封装（沿用 D-06 showPerfInStatusBar 模式）

### 触发动作
- **D-07:** 调用现有 `generateCompileCommands({ project, engineRoot, logger })` — 不新建 UBT 调用路径，复用 Phase 7 已有的指纹缓存层（D-08 增量修复）
- **D-08:** 状态栏反馈：触发瞬间 `$(sync~spin) VSCodeUEHelper: UHT 重新生成中...`（4 秒），完成 `$(check) VSCodeUEHelper: UHT 已同步`（3 秒），错误时 `$(warning) VSCodeUEHelper: UHT 重生成失败（详情见 Output）`（5 秒）

### 错误处理
- **D-09:** UBT 调用失败时**不弹窗**（避免引擎路径不对时频繁骚扰）
- **D-10:** 失败时记录到 Output 面板（`[headerWatcher]` 前缀）+ 状态栏短促警告（5 秒后消失）
- **D-11:** 不做自动重试 — 让用户下次手动跑 `vscodeUEHelper.generateCompileCommands`

### 手动命令协调
- **D-12:** 用户手动执行 `vscodeUEHelper.generateCompileCommands` 命令时，**取消 pending debounce**（避免双跑 UBT）
- **D-13:** 实现方式：watcher 模块导出 `cancelPendingTrigger()` 函数，在 `generateCompileCommands` 命令入口处调用；用 in-memory token 同步（不需要 fs lock）

### 生命周期
- **D-14:** watcher 在 `activateClangd()` 之后注册，`disposable` 推入 `context.subscriptions` 自动清理
- **D-15:** 启用条件：仅当 `workspace.projectFolder` 与 `workspace.engineRoot` 都已经 ready 时才激活（用 `detection.ready` 包裹）

### the agent's Discretion
以下事项未深度讨论，由 agent 在规划时根据代码上下文决定：
- debounce 的具体实现（`setTimeout` + `clearTimeout` vs 队列批处理）— D-04 仅锁时长
- 反射宏正则的具体字符类（是否包含 `\s+` 容忍空白差异）
- status bar 消息的具体 i18n key（沿用现有 `t()` 双语化模式）
- 单元测试用例的具体边界条件（D-13 cancellation 需要 mock timer）
- watcher 自身的 dispose 时机（是否在 UE 工程关闭时停止）

### 继承 Phase 7 决策
- **D-15 (Phase 7):** watcher 用 `FileSystemWatcher` + debounced 批处理 — **覆盖**：Phase 8 用 `onDidSaveTextDocument`（更精准，且不需要 FileSystemWatcher）
- **D-04 / D-05 (Phase 7):** 状态栏三段指标 — Phase 8 沿用 disposable 模式，但只显示 UHT 触发瞬间（不持续显示）
- **D-06 (Phase 7):** 新增 setting `vscodeUEHelper.showPerfInStatusBar` — **同模式**新增 `vscodeUEHelper.clangdHeaderWatcher.enabled`
- **D-11 (Phase 7):** 先调研 `completionFiles.ts` / `preparseIncludes.ts` — Phase 8 不修改这两个，但需要在写 watcher 时确认它们对并发写入的容忍度（不会被本阶段触发条件命中）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规划层
- `.planning/ROADMAP.md` § Phase 8 — 阶段目标 + 成功标准（v1.2 代码理解增强，本次 un-park 聚焦 UE 头同步）
- `.planning/STATE.md` § Current Position — 当前 v1.2 状态（Phase 7 已 ship，Phase 8-10 parked 等 v1.3）
- `.planning/REQUIREMENTS.md` § CLANGD-02 — 代码理解与导航增强（v1.2 待办 4 个 sub-items 之一，本次只覆盖其中"宏穿透"错误隐含的"同步"前置）
- `.planning/PROJECT.md` § Constraints — LSP 3.17 协议 / 不修改 upstream clangd

### 代码库现状
- `.planning/codebase/STRUCTURE.md` § src/clangd/ — 目录布局（compileCommands.ts 是 D-07 复用目标）
- `.planning/codebase/ARCHITECTURE.md` § 81-88 — clangd 三件套（compileCommands / completionFiles / preparseIncludes）
- `.planning/codebase/INTEGRATIONS.md` § 4 — clangd LSP 集成（直连 vs 代理）

### 现有相关代码（必须先读，再设计）
- `src/clangd/compileCommands.ts` — 现行 `generateCompileCommands()` 入口（D-07 复用对象，包含 Phase 7 增量指纹缓存）
- `src/clangd/clangdOps.ts` — Phase 8 ClangdOps 4 方法 API（readConfig / exists / writeFull / mutate），用于反射头检测辅助
- `src/core/workspace.ts` — `workspace.projectFolder` / `workspace.engineRoot` getter（D-03 / D-15 依赖）
- `src/core/config.ts` — 配置强类型封装（D-06 新增 setting 的注册点）
- `src/core/logger.ts` — 结构化日志（D-10 Output 面板注入前缀 `[headerWatcher]`）
- `src/ui/statusBar.ts` — 11 个状态栏按钮（参考 disposable 模式，D-08 反馈沿用）
- `src/commands/generateCompileCommands.ts` — D-12 cancellation hook 注入点
- `src/commands/index.ts` — 命令注册中心
- `src/extension.ts:20` — `activate()` 入口（D-14 注入位置）
- `src/detection/workspaceContext.ts` — `detection.ready` Promise（D-15 包裹）

### 配置文件
- `package.json` § `contributes.configuration` — D-06 setting 注册位置
- `src/i18n/locales/{en,zh}.json` — D-08 状态栏文案双语化

### Phase 7 上下文（沿用）
- `.planning/phases/07-clangd-performance-optimization/07-CONTEXT.md` — D-04 / D-05 / D-06 / D-08 / D-15 决策原文
- `.planning/phases/07-clangd-performance-optimization/07-PATTERNS.md` — 现有可复用模式

### 单元测试参考
- `test/unit/setup.ts` — VS Code mocks 模式（D-13 cancellation 测试用）
- `test/unit/clangd/` — 同模块测试位置
- `vitest.config.ts` — 覆盖率阈值 80/80/75/80（D-13 测试必须达到）

</canonical_refs>

## Existing Code Insights

### Reusable Assets
- `src/clangd/compileCommands.ts:generateCompileCommands()` — D-07 直接调用，包含 Phase 7 的指纹缓存层（重复调用会命中缓存无开销）
- `src/core/workspace.ts` — `projectFolder` / `engineRoot` getter，detection.ready 包裹（D-03 / D-15 直接消费）
- `src/core/config.ts` — 配置强类型封装（D-06 setting 注册模板）
- `src/core/logger.ts` — Output 通道日志（D-10 失败日志前缀 `[headerWatcher]`）
- `src/ui/statusBar.ts:createStatusBarItem` — 状态栏 disposable 模式（D-08 反馈沿用）
- `vscode.window.setStatusBarMessage(message, timeout)` — D-08 用现成 API，无需新建按钮

### Established Patterns
- **Disposable 模式**：所有 VS Code 资源推入 `context.subscriptions`（D-14 自动清理）
- **i18n 优先**：用户可见字符串通过 `t('key')` 双语化（D-08 状态栏文案约束）
- **Promise-based**：所有异步用 `void` 显式标记（D-07 generateCompileCommands 调用方式）
- **WorkspaceState 注入**：新模块接受 `WorkspaceState` 可选参数（D-15 与 detection.ready 联动）
- **不引入新框架**：纯 VS Code API（D-01 onDidSaveTextDocument / D-08 setStatusBarMessage）

### Integration Points
- 新文件 `src/clangd/headerWatcher.ts` — D-01/D-04/D-12/D-14 落地
- `src/commands/generateCompileCommands.ts` — D-12 cancellation hook 注入（约 +2 行）
- `src/extension.ts` — D-14 激活期注册（+1 行）
- `package.json` § `contributes.configuration` — D-06 setting 注册
- `src/core/config.ts` — D-06 强类型 wrapper（+3-5 行）
- `src/i18n/locales/{en,zh}.json` — D-08 状态栏文案（+2-4 keys）

</canonical_refs>

<specifics>
## Specific Ideas

- 用户原话："好，作为 Phase 8" — 明确要把 UE 反射头同步功能归到 Phase 8
- 用户偏好**默认开启 + 可关**：和 Phase 7 D-06 showPerfInStatusBar 同模式
- 用户偏好**静默重试 + Output 日志**：避免频繁弹窗骚扰，依赖 Output 面板排查
- 用户偏好**手动命令取消 pending debounce**：避免双跑 UBT 浪费资源
- 用户偏好**严格触发条件**：仅 `.h` + 反射宏，避免 .cpp / .Build.cs 改动被错误触发
- 用户在 Phase 7 D-15 表态"由 agent 决定增量扫描路径" — 本次采用 onDidSaveTextDocument（vs FileSystemWatcher）是同等级 agent 决策，需在 PLAN 中说明理由

来自对话上下文的具体参考：
> "把 `generateCompileCommands` 命令或状态栏按钮拖到顺手位置" — D-07 直接复用意图明确
> "1.5 秒后自动跑 UHT → `.generated.h` 同步 → clangd 错误消失" — D-04 debounce 时长来源
> "失败：状态栏短促警告（5 秒后消失）" — D-08 错误反馈时长

</specifics>

<deferred>
## Deferred Ideas

- **UE 类型补全（Phase 8-其余）**：TObjectPtr / TSubclassOf 等 UE 容器类型补全 — 不在 Phase 8 范畴
- **include 路径补全（Phase 8-其余）**：Public/Private/*.generated.h 路径建议 — 不在 Phase 8 范畴
- **跳转定义穿透 UPROPERTY/UFUNCTION（Phase 8-其余）**：宏→真实声明导航 — 不在 Phase 8 范畴
- **引用搜索识别 UCLASS/USTRUCT 反射（Phase 8-其余）**：宏→反射注册 — 不在 Phase 8 范畴
- **Hot Reload 联动（Phase 9）**：本阶段只覆盖手动保存→同步，Hot Reload 触发链属 Phase 9
- **UE 编辑器双向通信（Phase 9）**：远期功能，本阶段无依赖
- **断点映射 / 调试 attach（Phase 9）**：工具链集成范畴
- **UE 编译错误 code action（Phase 10）**：诊断增强范畴
- **自定义诊断规则 JSON 外部加载（Phase 10）**：规则外置化，本阶段不考虑
- **ueClangdCompat.h 兜底覆盖 FID_*_PROLOG/EPILOG 形式（方案 3）**：用户讨论过的更激进方案，成本不划算，已采纳方案 2（本阶段），不再回退

</deferred>

---

*Phase: 08-ue-header-auto-sync*
*Context gathered: 2026-07-05*