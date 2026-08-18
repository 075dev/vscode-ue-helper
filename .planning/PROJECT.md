# VSCodeUEHelper

## What This Is

VSCodeUEHelper 是面向 Windows + Unreal Engine 5.2+ 的 C++ 开发者的 VS Code 扩展，0.1.0 已发布。
它把 UBT 构建、Live Coding 热重载、clangd 智能提示、可选 MCP AI Agent 集成与独立 clangd LSP
代理整合进单一插件，使用户不离开编辑器就能完成 UE5 C++ 的整条开发链路。

当前正处于 **v0.1.x → v0.2.x 的治理迁移阶段**：把此前分散在 `.specify/memory/constitution.md`、
`AGENTS.md`、`REMEDIATION-PLAN.md`、`AUDIT-REPORT.md` 的治理职责全部收敛到 `.planning/` 系列
文档，使 `.planning/` 成为项目治理与执行的**唯一演化真源**。`.specify/`、`REMEDIATION-PLAN.md`、
`AUDIT-REPORT.md` 保留为历史档案但标记 deprecated，不再写入新内容。

## Core Value

**"在 Windows + VS Code 上，让 UE5 C++ 开发者不离开编辑器就能完成
构建 / 热重载 / 智能提示 / AI 协作这一整条链路。"**

任何不能直接服务于这条链路的变更都会在 Phase 规划阶段被拒绝；任何损害这条链路稳定性的
变更（例如破坏 Windows-only 边界、引入 SubprocessRegistry 之外的 spawn）会立即阻断合入。

## Requirements

### Validated

以下能力已通过 `git log` + `AGENTS.md` 状态速览 + `f71fa8d` 之前的 `.planning/` 历史交叉验证
为**已交付**。Phase 1 起的 Roadmap 在执行前必须把这些视为前提条件，不要重新打开。

- ✓ **Phase 0–9 架构落地**：项目骨架 / `.uproject` 检测 / UBT 构建 / Live Coding / MSVC 解析
  / clangd 集成 / MCP 服务 / 控制面板 / `WorkspaceState` + `ClangdOps` 单一真相源 / 子进程清理
- ✓ **22 条命令注册**：`package.json#contributes.commands` 完整；命令 title 走 `package.nls.json`
  + `package.nls.zh.json` 双语
- ✓ **测试基础设施**：Vitest 71 文件 / ~12k 行 / v8 阈值 75/70/70/75（`npm run test:unit`）
- ✓ **SubprocessRegistry**：`src/core/subprocessRegistry.ts` 统一管理本插件 spawn 的 child，
  deactivate 走 `taskkill /F /T /PID`，3s 升级强杀；4 类豁免（短探测 + Task system 托管）明文登记
- ✓ **ClangdOps 单一写入点**：22 callers 统一走 `mutate / applyAddFlags / writeFull`；旧的
  `setAddFlag / replaceAddBlock / setIndexBackground / updateSystemIncludes` 不作为公开 API
- ✓ **WorkspaceState 单一真相源**：13 import / 36 callers / 10 个命令文件的
  `resolveSelectedProject/Engine()` 收口
- ✓ **completionMode 合并**：fast/slow 合并为唯一 `slow`；`ue5-fast.json` 已删，新代码不
  应据 `completionMode` 字段做分支
- ✓ **.clangd 唯一写入**：删除 `writeClangdConfig` / `findClangdConfig`，统一走 `ClangdOps`
- ✓ **deactivate 子进程清理 P0**：所有新 spawn 必须经 SubprocessRegistry（4 类豁免明文）

### Active

以下需求当前 in-flight。每个条目都映射到 `REMEDIATION-PLAN.md` 的 Wave + Task 编号，可被
Roadmap 阶段直接引用。完成时移除 `[ ]`、引用 Phase 编号、移入 Validated。

#### REM-* — REMEDIATION-PLAN 剩余 wave 闭环

- [ ] **REM-001**：完成 Wave 1 P0 必修全部 4 task 的验证证据（`npm run typecheck` /
  `lint` / `test:unit` / `build` 全绿 + 现场烟测如适用）
- [ ] **REM-002**：完成 Wave 2 P1 高价值全部 8 task 的验证证据
- [ ] **REM-003**：完成 Wave 3 P2 文档对齐全部 5 task（README / AGENTS 校准 + 仓库陷阱条目同步）
- [ ] **REM-004**：完成 Wave 4 P3 架构债务全部 9 task（DDD 三层实质化 / `Config.update`
  文档同步 / 死别名与死 i18n key 清理 等）
- [ ] **REM-005**：完成 Wave 5 P4 长期全部 5 task（macOS 工具链探测 RFC 草稿等）

#### GOV-* — 治理迁移

- [ ] **GOV-001**：把 `.specify/constitution.md` 5 条核心原则 + 5 条开发工作流**完整迁移**到
  本文件 "扩展原则"章节，保留 verbatim 措辞与 normative 强度（MUST / SHOULD / MAY）
- [ ] **GOV-002**：在 `.specify/constitution.md`、`REMEDIATION-PLAN.md`、`AUDIT-REPORT.md`
  文件顶部插入 `> DEPRECATED: moved to .planning/PROJECT.md on 2026-08-18` 横幅；保留所有内容
  与 git 历史可读；**不物理删除**
- [ ] **GOV-003**：更新 `AGENTS.md` 头部"治理依据"段指向 `.planning/PROJECT.md`；
  更新 `README.md` "Governance" 段指向 `.planning/PROJECT.md`；这两个文件改动不属于 GOV-001
  的范畴，需要单独的 commit

#### MCP-* — MCP 维持现状

- [ ] **MCP-001**：保持 6 个工具（`ue_build` / `ue_launch_editor` / `ue_live_coding` /
  `ue_generate_compile_commands` / `ue_show_project_info` / `ue_set_system_includes`）；保持
  Cursor / Claude Code 环境变量嗅探启动策略；普通 VS Code 仍为 no-op

#### PLAT-* — 平台边界探索

- [ ] **PLAT-001**：撰写 macOS 工具链探测可行性 RFC 草稿（只产出 markdown，不动代码），
  描述关键风险点（Xcode clang vs MSVC clang 差异、include path 探测、UBT 在非 Windows
  下不存在等）。RFC 完成 → 视为评估完成，不构成修宪依据

### Out of Scope

- ✗ 立即修宪扩张到 macOS / Linux（需先有正式 RFC + 用户复核，且需 `.planning/PROJECT.md`
  "扩展原则"章节同步修订）
- ✗ 物理删除 `.specify/` 或 `.omp/commands/speckit.*`（会立即破坏 Spec Kit 命令注册）
- ✗ 物理删除 `REMEDIATION-PLAN.md` / `AUDIT-REPORT.md` 文件（保留为历史档案）
- ✗ 重写 MCP 模块整体架构（仅维持现状 + 缺陷修复）
- ✗ 引入新运行时依赖（除非有具体边界问题且走宪法 V "Minimal, Traceable, Reversible
  Evolution" 流程）
- ✗ 复活历史 `.planning/` 中已被移除的兼容函数（例：`populateAddCompletions`、
  `headerWatcher`、`writeClangdConfig`、`findClangdConfig`、`toggleCompletionMode`）

## Context

- **治理迁移背景**：`f71fa8d chore: 移除废弃计划文档(.planning/.hermes)` 在 2026-08-11
  整体删除旧 `.planning/`（5267 行，3 个已闭环 phase）。当前 `.specify/memory/constitution.md`
  v1.0.1（`LAST_AMENDED` 2026-07-26）是仓库自报的最高治理文件，本次 new-project 将其迁入本文。
- **技术环境**：Node 18+ / VS Code 1.85+ / TypeScript strict / Vitest / esbuild 双产物
  （`out/extension.js` + `out/clangdProxy.js` + `out/launcher/proxy-launcher.{bat,sh}`）；
  `package.json#platforms: ["win32"]`；强制别名 `@core` `@detection` `@build` `@clangd`
  `@commands` `@ui` `@parsers` `@mcp` `@i18n` `@rules`
- **真实 UE 项目验证路径**：`E:\Dream\XianDreamwalking`（`XianDreamwalking.uproject`）——
  仅在 build / clangd 相关 phase 涉及行为变更时使用，使用前须自行确认 UE 引擎 + UBT + EDH 可用
- **已知风险**：
  - 仓库陷阱 14 条（`AGENTS.md`），其中 #11 `completionMode` 字段保留为兼容 getter 但恒为 `slow`，
    新代码不得据此分支
  - `Config.update` 写后必须 `refreshRoot()` 立即刷新；跨实例/跨闭包缓存 `config` 引用仍
    会读到旧值
  - chokidar 必须在 vitest mock，否则 `fileWatcher` 测试会启动真实 fs watcher 卡进程
  - MSVC 错误正则 `package.json#problemMatchers` 与 `src/parsers/msvcParser.ts` 必须同步修改
- **历史教训**：`f71fa8d` 删除的旧 `.planning/` 有过 3 个 phase 的完整执行记录，本次重建需
  复盘其失败原因（冗余模板、Evolution 区重复、与 `.specify/` 治理职责重叠），避免重蹈覆辙

## Constraints

- **Platform**: Windows-only（UE 5.2+ / MSVC / Windows SDK 硬依赖）—— 宪法 I 迁移
- **Build**: TypeScript strict 全开（`noUncheckedIndexedAccess` / `noUnusedLocals/Parameters`
  / `noImplicitReturns` / `noFallthroughCasesInSwitch`）；ESLint 强制 `@typescript-eslint/
  no-floating-promises` / `no-misused-promises` / `await-thenable` 为 `error`
- **i18n**: 用户可见字符串 MUST 经 `t('key', params)`；新增 MUST 同步 `en.json` + `zh.json`
- **Lifecycle**: 任何 `child_process.spawn` MUST 经 `SubprocessRegistry.register`；4 类豁免
  明文登记在 `AGENTS.md` 仓库陷阱 #14
- **Architecture**: `WorkspaceState` + `ClangdOps` 单一真相源；命令处理器只编排不重实现；
  禁止相对导入（必须走路径别名）
- **Verification gates**: 永久行为/公共契约变更 MUST 附确定性测试；每次实现 MUST 通过
  `npm run typecheck` / `lint` / `test:unit`；构建/clangd 行为变更 MUST 含 Windows UE 现场
  烟测（如环境可用）；不可用时 MUST 报告缺失而非虚构成功
- **Compatibility**: 历史上对 `.planning/` 做过 5267 行删除（`f71fa8d`），任何后续 phase
  不得"复活"被明确移除的兼容函数
- **Governance hierarchy**: `.planning/PROJECT.md` 是演化真源；让渡条款——本文件未设上位
  文件，`.specify/constitution.md` 在 GOV-001 迁移完成后冻结但保留存在（避免破坏
  `.omp/commands/speckit.*` 路径）；任何后续修宪须同步修订本文 "扩展原则"章节

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| `.planning/PROJECT.md` 升格为唯一演化治理文件 | `.specify/constitution.md` 整体迁移；`.planning/` 成为演化真源 | — Pending |
| 平台边界保持 `win32` | macOS 探索走 RFC 入口（PLAT-001），不修宪、不落地 | — Pending |
| MCP 保持现状 | 6 工具 + Cursor/Claude Code 嗅探策略不变；不扩张工具/宿主 | — Pending |
| `REMEDIATION-PLAN.md` 转 deprecated | `.planning/REQUIREMENTS.md` 为唯一需求真源；保留 git 历史 | — Pending |
| Coarse 粒度 + P0 优先 | 贴合 REMEDIATION-PLAN 6 Wave 合并为少 Phase；3–5 Phase | — Pending |
| 可选烟测 | 与宪法 IV "when the required environment is available" 对齐 | ✓ Good |
| 4 类 spawn 豁免保留 | 短探测 + Task system 托管，避免子进程 leak | ✓ Good |
| 删除旧 `.planning/` 后重建 | 历史 `.planning/` 失败原因（与 `.specify/` 治理重叠 / 模板冗余）已记录在 Context；本次重建避免重蹈 | ✓ Good |
| `.specify/` 与 `.omp/commands/speckit.*` 不物理删除 | 立即破坏命令注册；标记 deprecated 但保留 | ✓ Good |

## 扩展原则（迁移自 `.specify/memory/constitution.md` v1.0.1）

> **迁移来源**：本节于 2026-08-18 由 GOV-001 从 `.specify/memory/constitution.md` v1.0.1
> （`LAST_AMENDED` 2026-07-26）完整迁移，措辞与 normative 强度（MUST / SHOULD / MAY）保留
> verbatim。原文件标记 deprecated 但保留存在，避免破坏 `.omp/commands/speckit.*` 命令路径。
> 本节迁移完成后，`.specify/constitution.md` 即时冻结；任何后续宪法修订须同时修订本节与
> 旧文件，并在本节顶部追加 Sync Impact Report。

### I. Windows-First Unreal Scope

VSCodeUEHelper targets Windows 10/11, Unreal Engine 5.2+, the MSVC toolchain, the Windows
SDK, VS Code 1.85+, and Node.js 18+. New behavior MUST preserve this support boundary and
MUST NOT advertise or implement Mac/Linux support unless a constitution amendment explicitly
changes the product scope. Feature specifications MUST identify dependencies on a real Unreal
project or host integration. This boundary prevents unsupported paths from becoming accidental
product commitments.

### II. Single Sources of Truth and Boundary Discipline

Workspace, project, engine, and derived-path state MUST flow through `WorkspaceState`.
`.clangd` reads and writes MUST flow through `ClangdOps`. New TypeScript code MUST use the
configured path aliases and respect module dependency direction; it MUST NOT duplicate detection
state, construct governed paths ad hoc, or write `.clangd` directly. Command handlers MUST
orchestrate lower layers rather than reimplement their business logic. These rules keep state
and side effects deterministic across the extension, UI, and MCP entry points.

### III. Localized, Observable, Resource-Safe UX

Every user-visible string MUST use the bilingual `en` and `zh` i18n resources. Every module
log MUST carry its module prefix and enough context to diagnose the operation or failure. The
clangd proxy MUST reserve stdout for LSP protocol frames and send diagnostics elsewhere. Every
VS Code resource MUST be disposed through `context.subscriptions` or an equivalent owned
lifecycle. Generated configuration writes MUST be atomic and MUST preserve explicitly user-owned
content. These requirements make failures diagnosable without corrupting the host or user files.

### IV. Verification Gates Before Delivery

Permanent behavioral or public-contract changes MUST include deterministic tests at the affected
boundary; documentation-only changes MAY omit tests. Every implementation change MUST pass
`npm run typecheck`, `npm run lint`, and `npm run test:unit`. Changes to package metadata or
bundling MUST also pass `npm run build`. Changes to build or clangd behavior MUST include a
verified Windows Unreal smoke scenario when the required environment is available; missing
prerequisites MUST be reported rather than replaced by an unsubstantiated success claim. Specs,
plans, and task lists MUST state acceptance evidence before implementation begins. This gate
keeps regressions visible and prevents scaffolds or narrow checks from being presented as done.

### V. Minimal, Traceable, Reversible Evolution

New runtime dependencies MUST have a concrete use, a documented tradeoff, and an explicit
review decision. New abstractions MUST solve an observed boundary or complexity problem;
speculative framework layers are prohibited. Breaking public APIs or governance rules MUST carry
a migration plan, an ADR when architecture is affected, and the appropriate semantic-version
bump. Deprecated paths MUST NOT receive new callers and SHOULD be removed through a clean
cutover. Generated outputs and release metadata MUST be changed only when they are intentional
artifacts. This discipline limits maintenance cost and leaves an auditable recovery path.

## Evolution

本文在 Phase 转换与里程碑边界演化。

**Phase 转换后**（via `/gsd-transition`）：
1. 需求被证伪？→ 移入 Out of Scope 并附理由
2. 需求被验证？→ 移入 Validated 并附 Phase 引用
3. 新需求涌现？→ 加入 Active
4. 决策需登记？→ 加入 Key Decisions
5. "What This Is" 仍准确？→ 若漂移则更新

**里程碑完成后**（via `/gsd:complete-milestone`）：
1. 全章节复审
2. Core Value 检查——仍是正确优先级？
3. Out of Scope 审计——理由仍有效？
4. 更新 Context 反映当前状态

---
*Last updated: 2026-08-18 after brownfield initialization (.specify/constitution.md v1.0.1 → .planning/PROJECT.md)*