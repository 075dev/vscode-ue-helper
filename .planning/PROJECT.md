# VSCodeUEHelper

## What This Is

VSCodeUEHelper 是一款 **Windows-only 的 VS Code 扩展**,为 Unreal Engine 5.2+ C++ 项目提供一站式开发环境:UBT 构建与诊断、Live Coding 热重载、clangd 智能提示、MSVC 系统头文件注入、可选的 MCP AI Agent 集成。它解决了 Rider 在大型 UE5 项目中"打开项目索引慢、内存占用严重"的痛点,在 VS Code 现有工作流中提供与 Rider 等价的 C++ 体验而不牺牲启动/索引性能。

## Core Value

**在 Windows + VS Code 上提供与 Rider 等价的 UE5 C++ 开发体验,且冷启动与内存开销显著优于 Rider**。这是产品定位的"生死线" — 任何破坏性能预算的新功能必须先答"对冷启动/索引/RAM 的影响",否则 P0 直接拒。

## Business Context

<!-- 删除此段除非商业化/客户面向项目;本项目当前是个人/团队工具,无收入/客户指标 -->

- **Customer**: Unreal Engine 5.2+ C++ 开发者(自用 + 社区分享)
- **Revenue model**: 无(开源 + Marketplace 计划)
- **Success metric**: 社区活跃度 + Marketplace 下载量(待发布后才有数据)
- **Strategy notes**: `README.md` (项目根) / `CHANGELOG.md` / `doc/`

## Requirements

### Validated

<!-- 从 ARCHITECTURE.md / STACK.md / INTEGRATIONS.md / CONCERNS.md 推断,对应已落地的代码能力 -->

#### Build / 构建

- ✓ **BUILD-01**: 用户可通过命令面板调用 UBT 构建/重建/清理 C++ 项目 — `src/build/ubt.ts` + `src/build/buildRunner.ts` + `src/build/taskProvider.ts`,覆盖 Editor/Game/Server/Client 4 个 target
- ✓ **BUILD-02**: MSVC 错误输出实时解析为 VS Code Diagnostics — `src/parsers/msvcParser.ts` + `package.json#contributes.problemMatchers`,1-based → 0-based 转换
- ✓ **BUILD-03**: 用户可在 Output Channel / Problems Panel 看到构建进度和错误 — `src/ui/outputChannel.ts` + `src/ui/problemsPanel.ts`
- ✓ **BUILD-04**: Live Coding 5s 节流触发 UBT 热重载 — `src/build/liveCoding.ts`,detached spawn + setTimeout(300) 容错

#### Detection / 检测

- ✓ **DETECT-01**: 扩展从 `.code-workspace#folders[]` 信任项目根/引擎根 — `src/detection/workspaceContext.ts`
- ✓ **DETECT-02**: `uprojectScanner` 扫描 `<ProjectName>.uproject` — `src/detection/uprojectScanner.ts`
- ✓ **DETECT-03**: `engineDiscovery` 读取 `<Engine>/Engine/Build/Build.version` — `src/detection/engineDiscovery.ts`
- ✓ **DETECT-04**: `vsBuildTools` 通过 `vswhere.exe` 发现 MSVC 工具链 — `src/detection/vsBuildTools.ts`

#### clangd / 智能提示

- ✓ **CLANGD-01**: 独立 LSP proxy 子进程拦截 clangd 协议 — `src/clangd/proxy/`(17 个文件) + `out/clangdProxy.js` bundle
- ✓ **CLANGD-02**: didClose keepalive 解决 off-doc 死锁 — `src/clangd/proxy/keepalive.ts`
- ✓ **CLANGD-03**: `.clangd` 单一写入 API `ClangdOps` (Phase 9 SSoT) — `src/clangd/clangdOps.ts` (22 callers, Phase 9 收敛后 9 直接 import)
- ✓ **CLANGD-04**: UBT -ProjectFiles 生成 `compile_commands.json` + symlink 到 workspace 根 — `src/clangd/compileCommands.ts`
- ✓ **CLANGD-05**: 写入 MSVC `-imsvc` 路径到 `.clangd`,使 clangd 解析 windows.h — `src/clangd/windowsSdk.ts` + `ClangdOps.applyAddFlags`
- ✓ **CLANGD-06**: `UeDiagnosticWatcher` 被动触发 UBT 重新生成 `.generated.h` (Phase 8 替换 headerWatcher) — `src/clangd/proxy/ueDiagnosticWatcher.ts`

#### UX / 界面

- ✓ **UI-01**: 11 个状态栏按钮(命令快捷入口) — `src/ui/statusBar.ts`
- ✓ **UI-02**: QuickPick 模式菜单选择(构建 target、平台等) — `src/ui/quickPicks.ts`
- ✓ **UI-03**: ControlPanel Webview 提供设置/状态总览 — `src/ui/controlPanel.ts`
- ✓ **UI-04**: 中文代码注释强制 + i18n 双语同步 — `src/i18n/locales/{en,zh}.json`

#### MCP / AI Agent 集成(Cursor/Claude Code 环境)

- ✓ **MCP-01**: 6 个 MCP 工具 (`ue_build`、`ue_launch_editor`、`ue_live_coding`、`ue_set_system_includes` 等) — `src/mcp/tools.ts`
- ✓ **MCP-02**: 仅在 Cursor/Claude Code 环境激活(检测 `CURSOR_*` / `CLAUDE_CODE_*` 环境变量)
- ✓ **MCP-03**: AI 规则文件生成 (`.cursor/rules/*.mdc` + `.github/copilot-instructions.md`) — `src/rules/`

#### 架构稳定性

- ✓ **ARCH-01**: `WorkspaceState` 单一真相源(13 import / 36 callers)— `src/core/workspaceState.ts`
- ✓ **ARCH-02**: 激活顺序硬约束 `extension.ts` (initI18n → Logger+Config → Detection → WorkspaceState → ClangdOps → activate\*)
- ✓ **ARCH-03**: 双 esbuild bundle (`out/extension.js` + `out/clangdProxy.js`) — `esbuild.config.mjs`
- ✓ **ARCH-04**: 13 个 SSoT 回归守卫 + 12 个 WorkspaceState 行为测试 — `test/unit/core/ssot.test.ts` + `test/unit/core/workspace.test.ts`

#### Phase 3 / 可维护性（实现完成，验证待闭环）

- ◷ **REQ-PERF-01**: `compileCommands.ts` 从实测约 929 行降至 492 行，提取 `task/cache/symlink/fillMissing` 四子模块并保持公共 API；自动化验收通过，真实 UE command smoke 尚未完成

### Active

<!-- 当前 scope,下一阶段要交付的。Roadmap 会映射到 phase -->

- [ ] **REQ-PERF-01**: 在真实 UE / Extension Host 环境完成 `Generate Compile Commands` 首次生成、symlink/copy、第二次 cache fast-path 与事件名 smoke，闭环 Phase 3 verification debt
- [ ] **REQ-LIVE-02**: 汉化功能在 Completion/SignatureHelp/InlayHint 上**修齐**(6 个僵尸 TODO 落地或下架)
- [ ] **REQ-PERF-02**: 解决 `src/core/workspace.ts` 307 / `config.ts` 317 / `controlPanel.html.ts` 615 / `proxy/bridge.ts` 692 行 4 个 god 文件拆分
- [ ] **REQ-DEBT-01**: `Config.completionMode` 死分支 API 收口(caller 改读静态常量,删 getter)
- [ ] **REQ-DEBT-02**: 3 个零引用 runtime 依赖 `execa` / `neverthrow` / `xstate` 卸载
- [ ] **REQ-DEBT-03**: 67 字节占位 `icon.png` 替换为合规 128×128 Marketplace icon
- [ ] **REQ-DOC-01**: `resources/README.md` 描述同步(删除已删的 `ue5-fast.json` 引用)
- [ ] **REQ-DOC-02**: AGENTS.md 仓库陷阱 #1/#7/#10/#11/#12 措辞更新(反漂移 — 实际已修复但描述未跟进)
- [ ] **REQ-DOC-03**: 8 个模块 AGENTS.md 与实测差异校正(已在 ARCHITECTURE.md 中标出:WorkspaceState 38 callers / ClangdOps 9 callers / 72 测试文件 / 16.3k 行 / 9 路径别名 等)

### Out of Scope

- ✗ **Mac/Linux 跨平台支持** — 已在 `package.json#platforms: ["win32"]` 强制,N1+N2+N3 死代码清理已完成。Mac/Linux 开发者请用 Rider。
- ✗ **非 UE5 项目**(Unity/纯 C++/Rust 等) — 扩展的 parsers/MSVC 解析/UBT 集成全部是 UE 特有
- ✗ **远程构建** — UBT 走本地 `node:child_process.spawn`,无远程构建支持
- ✗ **完整 Rider 替代** — 不做 UE Blueprint 编辑、Content Browser 集成、Scene 编辑等 IDE 重量级功能
- ✗ **6 个汉化 TODO 之外的扩展 LSP 协议本地化** — 只覆盖 Hover/Completion/SignatureHelp/InlayHint 四类,不实现 Definition/Reference/Rename 汉化
- ✗ **fast/slow completion mode 分支** — Phase 8 已合并为 `slow`,`Config.completionMode` 已死
- ✗ **`populateAddCompletions` 函数** — Phase 9 SSoT 已删,新代码直接调 `createCompletionFiles()`,13 个回归守卫防复活

## Context

**技术环境**:

- **平台**: 仅 Windows(MSVC 工具链 + Windows SDK 是硬依赖)
- **运行时**: VS Code ≥ 1.85.0 + Node.js ≥ 18.0.0
- **依赖 UE**: 5.2+(5.8 源码已本地副本在 `D:\Program Files\UE_5.8\`,UHT/UBT 行为参考用)
- **依赖构建**: TypeScript 5.3.3 + esbuild 0.20.0(双 bundle) + Vitest 1.3.0(v8 coverage 80/80/75/80)
- **路径别名**: `@core` `@detection` `@build` `@clangd` `@i18n` `@parsers` `@commands` `@ui` `@mcp` (9 个,`@platform` 死,`@rules` 仅 doc)

**当前代码规模**:

- `src/` 137 个 TS 文件
- `test/unit/` 72 个测试文件,~16.3k 行
- `out/` 双 bundle + launcher(Unix `.sh` 已删 N2 cleanup)
- 21 个命令 (`package.json#contributes.commands`),11 个状态栏按钮

**关键架构决策(已落地,无回头路)**:

1. **Phase 8 SSoT** — `WorkspaceState` 单一真相源(13 import / 36 callers)
2. **Phase 9 SSoT 收尾** — `ClangdOps` 统一 `.clangd` 写入,删 `writeClangdConfig` / `findClangdConfig`
3. **Live Coding 5s 节流** — 性能优先于完美单文件 UHT(P0 over P1)
4. **UBT 被动触发** — `UeDiagnosticWatcher` 替代主动 watcher,避免扫描风暴
5. **preparse-includes** — `resources/preparse-includes/ue5-slow.json` 缓解 UE5 大型头文件索引压力(fast.json 已删)

**用户反馈主题**(来自 `1.log` + `AUDIT-REPORT.md`):

- 拒绝 Rider:"打开项目时索引太慢、内存占用严重"
- 拒绝 fast/slow completion mode 切换 UI:fast.json 删了没必要回退
- 拒绝再活 `populateAddCompletions`:Phase 9 已删,13 个 SSoT 测试防复活
- 拒绝新增 docs / subscriptions / timers / mocks 除非 task 必须(minimum-scope)

**已知问题**:

- 详见 `.planning/codebase/CONCERNS.md`(380 行,2026-07-23 最新)
- AUDIT-REPORT.md 43 findings,REMEDIATION-PLAN 32 tasks(T1.1/T1.2/T2.1/T2.6/T4.7 已落地,2026-07-23)

## Constraints

- **平台**: Windows-only — 任何跨平台代码路径都是死代码(已清 N1/N2/N3)
- **TypeScript strict 全开** — `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals/Parameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch`
- **ESLint 强制** — `@typescript-eslint/no-floating-promises` / `no-misused-promises` / `await-thenable` 全部 `error`
- **代码注释**: 中文强制
- **路径别名 vs 相对导入**: 强制用 `@core` `@clangd` 等,禁止相对导入
- **i18n 双语同步**: 改文案必须同步 `src/i18n/locales/{en,zh}.json`
- **资源清理**: 所有 VS Code 资源(StatusBar/Command/Watcher)必须 `context.subscriptions.push`
- **新增命令 4 步**: ① `package.json#contributes.commands` ② `src/commands/xxx.ts` 写 `executeXxx` ③ `src/commands/index.ts` `registerCommand` ④ i18n 双语 key
- **绝对路径用于诊断**: MSVC 输出 1-based,VS Code 0-based,解析时减 1
- **依赖预算**: 0 引用 runtime 依赖不允许(`execa`/`neverthrow`/`xstate` 待卸)
- **AGENTS.md 是仓库知识库** — 13 项仓库陷阱每条都是历史真实事故,改代码前先读

## Key Decisions

<!-- 重大决策,影响未来工作 -->

| Decision                                           | Rationale                                                         | Outcome                                |
| -------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------- |
| Windows-only (`package.json#platforms: ["win32"]`) | 跨平台代码是死代码,清理掉                                         | ✓ Good (N1/N2/N3 已清)                 |
| 砍 `completionMode` fast/slow UI,合并 slow         | 用户拒绝复杂开关,fast.json 删                                     | ✓ Good (Phase 8)                       |
| `ClangdOps` 统一 `.clangd` 写入                    | Phase 9 解决 SSoT 漂移                                            | ✓ Good (13 SSoT 守卫)                  |
| `WorkspaceState` 单一真相源                        | 多模块各自读 `.code-workspace` 容易竞态                           | ✓ Good (Phase 8)                       |
| 独立 LSP proxy 子进程                              | 给 UE 特定行为留 hook(didClose 汉化、UeDiagnosticWatcher)         | ✓ Good (Phase 8 收尾)                  |
| Live Coding 5s 节流                                | 用户对"完美单文件 UHT"和"5s 节流"二选一时选节流                   | ✓ Good (性能优先)                      |
| UBT 被动触发 via `UeDiagnosticWatcher`             | 主动 watcher 扫描风暴,误触发 UBT 浪费 30s+                        | ✓ Good (Phase 8)                       |
| `populateAddCompletions` 删                        | 撒谎型兼容层(stats 全 0)误导新代码                                | ✓ Good (Phase 9)                       |
| dual esbuild bundle                                | 给 LSP proxy 留独立 Node 进程,不依赖 vscode                       | ✓ Good (架构清晰)                      |
| TS strict + 3 ESLint error 规则                    | 防止 floating promise,no-floating-promises 是 UE 内存泄漏主要来源 | ✓ Good                                 |
| 13 个 SSoT 回归守卫                                | 防止 Phase 9 决策被未来"重构"复活                                 | ✓ Good (`test/unit/core/ssot.test.ts`) |

---

_Last updated: 2026-07-24 after Phase 3 artifact audit (implementation complete; real UE smoke pending human verification)_

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):

1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):

1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

### Phase 2 evolution (2026-07-23)

**Status:** Phase 2 落地 (00 + 2.1 + 2.2 + 2.3 全 4 plans 完成)

1. **新验证的 REQ**: 无 — Phase 2 是规范/流程工作,无新 feature 交付 (per ROADMAP §Phase 2)
2. **新 Active REQ**: 无 (与 1 同)
3. **新 Key Decisions** (3 项,已写 ADR):
   - **Phase 8 SSoT** — `WorkspaceState` 单一真相源 (ADR 0001, 2026-07-23 追溯)
   - **Phase 9 ClangdOps** — `.clangd` 唯一写入 API (ADR 0002, 2026-07-23 追溯)
   - **Live Coding 5s 节流** — 放弃完美单文件 UHT (ADR 0003, 2026-07-23 追溯)
4. **Out of Scope 维持**: 跨平台 / 远程构建 / Blueprint 等
5. **Codebase state 更新**:
   - ESLint `no-explicit-any` 升 `error`; `consistent-type-imports` 降 `warn` (126 警告存量, 92 个可自动修复)
   - `src/core/result.ts` + `src/core/errors.ts` 新基础设施 (Result<T, E> + 错误码体系)
   - 12 个流程文档 (CONTRIBUTING / DEBUG / RELEASE / 3 ADR / 4 design doc / PR 模板)
   - `src/` 137 → 145 TS 文件; `test/unit/` 72 → 74 文件
6. **DEBT-02/03 状态**: 已在 Phase 2 重定义前完成 (per ROADMAP §Backlog)
7. **DOC-01/03 状态**: 延后到 backlog (per ROADMAP §Backlog) — 不在 Phase 2 范围 (per CONTEXT §Deferred Ideas)
8. **未来 Phase 3-6 决策建议** (from `docs/design/phase{3,4,5,6}-*.md`):
   - Phase 3 拆 1002 行 `compileCommands.ts` 为 5 文件
   - Phase 4 拆 4 个中型 god 文件 (workspace / config / controlPanel / bridge) 为 12 文件
   - Phase 5 Live Coding + AI 集成 (规则引擎, 零 LLM 依赖)
   - Phase 6 汉化 TODO 决断 (设计 doc 推荐选项 A 下架, 4-6h,优于选项 B 填充 8-12h)

### Phase 3 evolution (2026-07-23)

**Status:** Phase 3 实现落地（03-01 至 03-05 全 5 plans 完成），真实 UE 验证待闭环。

1. **实现完成的 REQ:** REQ-PERF-01 — 主入口 492 行，四子模块和公共 API/callers 自动化验证通过。
2. **设计校正:** 原规划的第四模块 `fingerprint` 与既有 SHA256 `src/clangd/fingerprint.ts` 冲突，按研究结果改为 `fillMissing.ts`。
3. **验证债务:** 真实 UE / Extension Host `Generate Compile Commands` smoke 因本环境无可运行 `.uproject` / UE / UBT 未执行；未伪造通过。
4. **下一焦点:** 完成 Phase 3 人工 UAT 后，才进入 Phase 4 — 4 个中型 god 文件拆分（REQ-PERF-02）。
