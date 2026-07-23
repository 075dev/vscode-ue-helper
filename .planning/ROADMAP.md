# Roadmap: VSCodeUEHelper

**Defined:** 2026-07-23
**Source:** `.planning/PROJECT.md` + `.planning/REQUIREMENTS.md` + `.planning/codebase/` (7 docs, 2088 lines, 2026-07-23)
**Project mode:** standard (Horizontal Layers) — refactor + 文档 + 债务 + 小特性,无巨型独立 feature
**Granularity:** Standard (6 phases, 1-3 plans each, 估算 5-25h/phase)

## Phase 概览

| # | Phase | Goal | REQ-IDs | 估算 |
|---|-------|------|---------|------|
| 1 | 文档质量校正 | 仓库知识库与实测同步,反漂移 | DOC-01, DOC-02, DOC-03 | 2-3h |
| 2 | 代码规范化 + 流程清晰化 | 12 项子交付物(规范 8 + 流程 4) | — | 6-10h |
| 3 | compileCommands 重构 | 拆 1002 行 god 文件 | PERF-01 | 6-8h |
| 4 | 4 个中型 god 文件拆分 | workspace / config / controlPanel / bridge | PERF-02 | 8-10h |
| 5 | Live Coding AI 集成 | 一键修复 prototype | LIVE-01 | 8-12h |
| 6 | 汉化 TODO 决断 | 选项 A (下架) 或 选项 B (填充) | LIVE-02 | 2h / 2-3d |

**总计:** 6 phases, 10 requirements, 30-40h (选项 A 路径) / 50-60h (选项 B 路径)

---

## Phase 1: 文档质量校正

**Goal:** 把仓库知识库(AGENTS.md / 8 模块 AGENTS.md / resources/README.md)与 2026-07-23 实测状态对齐,反漂移

**Mode:** standard

**Success Criteria:**
1. `resources/README.md` 不再提及已删的 `ue5-fast.json` / `banner.png`
2. AGENTS.md 仓库陷阱 #1 / #7 / #10 / #11 / #12 措辞更新,反映 2026-07-23 实际状态(`test:integration` 已删、MSVC 正则已同步、`Config.update` 已内置 refresh、`Config.completionMode` 已死分支、`populateAddCompletions` 已删并有 13 守卫)
3. 8 个模块 `src/<module>/AGENTS.md` 数字校正:WorkspaceState 38 callers / ClangdOps 9 / 72 测试 / 16.3k 行 / 9 别名 / 22 命令 / `.sh` 已删 / DDD 不活跃

**Requirements:** DOC-01, DOC-02, DOC-03

**Plans:**
- [x] Plan 1.1: ~~读 7 份 codebase 文档,生成 AGENTS.md 修订 diff(纯文档,1h)~~ **DONE** (4 处仓库陷阱 #1/#2/#7/#10 末尾追加斜体注释,2026-07-23) — see `01-01-SUMMARY.md`
- [ ] Plan 1.2: ~~重写 `resources/README.md`(纯文档,30min)~~ **DEFERRED → Phase 2**(per CONTEXT.md §Deferred Ideas,DOC-01 续做)
- [ ] Plan 1.3: ~~8 个模块 AGENTS.md 数字校正批处理(30min)~~ **DEFERRED → Phase 2**(per CONTEXT.md §Deferred Ideas,DOC-03 续做)

**Risks:** AGENTS.md 修订引入新错误 → 验证方式:grep 每个被改数字,确认与实测一致

---

## Phase 2: 代码规范化 + 流程清晰化

**Goal:** 把仓库从"功能正确但结构松散"提升到"代码规范统一 + 流程文档齐备"。两轴,3 plans,12 项子交付物(代码规范 8 + 流程清晰化 4)。

**Mode:** standard

**Scope 重定义(2026-07-23 D-01):** 原 Phase 2 (DEBT-01/02/03 + DOC 续做) 全部退入 backlog;新范围按轴划分,Plan 2.1 / 2.2 代码规范,Plan 2.3 流程清晰化。

**Success Criteria:**
1. **ESLint 硬约束**:`@typescript-eslint/no-explicit-any` 升 `error`;`consistent-type-imports` 配置;`npm run lint` 0 错 0 警
2. **目录与别名**:8 模块 `src/<module>/AGENTS.md` 与 `ls` 实际文件列表同步(差异 ≤ 1/模块);`@platform` / `@rules` 死别名在 3 个 configs 全部清理;DDD `application/` `infrastructure/` 确认不存在
3. **类型层**:`any` / `as any` / `<any>` / `@ts-ignore` 0 匹配;`@core/result` (Result<T,E>) 与 `@core/errors` (VSCodeUEHelperError + 4 个 E_*) 新基础设施就位;index 重导出完整
4. **API surface**:logger 前缀约定文档化(已在 ESLint 锁 `new Logger()`);所有 `logger.X('...')` 调用首参数含 `[moduleName]`
5. **开发流程**:`CONTRIBUTING.md` ≥ 100 行含 8 章节;`.github/PULL_REQUEST_TEMPLATE.md` 含 Phase / 模块 / 测试 / Screenshots / Breaking Changes / Checklist 6 字段;`AGENTS.md` §风格与约定 段追加 commit msg 规范
6. **调试/发布**:`docs/DEBUG.md` ≥ 50 行含 5 段;`docs/RELEASE.md` ≥ 50 行含 7 段(手动 CHANGELOG, 不引入 release-please);`.vscodeignore` 覆盖 .github/ / .cursor/
7. **ADR**:`docs/adr/README.md` + 3 份关键决策追溯(Phase 8 SSoT / Phase 9 ClangdOps / Live Coding 5s 节流)
8. **Phase design**:`docs/design/phase{3,4,5,6}-*.md` 4 份(为什么拆 / 拆什么 / Tradeoffs / 决策依据)

**Requirements:** (无 — 本阶段是规范/流程工作,无新 feature 交付,零 REQ-IDs)

- [x] Plan 2.1: 代码风格 + 目录结构(D-05 / D-06 / D-07 / D-08 / D-09 / D-10)— 6 项子交付物,2 个 task,wave 1 — see `02-01-SUMMARY.md` **(DONE 2026-07-23)**
- [x] Plan 2.2: TS strict + API surface(D-11 / D-12 / D-13 / D-14 / D-15)— 5 项子交付物,3 个 task,wave 2(依赖 Plan 2.1 修 `src/core/AGENTS.md`)— see `02-02-SUMMARY.md` **(DONE 2026-07-23)**
- [x] Plan 2.3: 文档 + ADR + 调试/发布(D-16 / D-17 / D-18 / D-19 / D-20 / D-21 / D-22 / D-23)— 8 项子交付物,3 个 task,wave 1 — see `02-03-SUMMARY.md` **(DONE 2026-07-23)**
- [x] **Pre-plan 0: ueLinkManager 收尾** (Phase 2 启动前置 gate, 用户决策)— 修 Windows 路径分隔符 + activateClangd 早退; 详见 `00-SUMMARY.md` (DONE 2026-07-23)

**Risks:**
- 升级 `no-explicit-any` warn→error 触发 ≥ 5 处新错误 → Plan 2.1 Step 1.2 显式回退 + 延后到独立 phase
- 8 模块 AGENTS.md 同步漏模块 → verify 步骤对 8 模块逐一 grep `comm -23`
- DDD 空壳意外复活 → Plan 2.1 Step 2.1 显式 `rmdir` 兜底
- ADR 数字引用漂移 → 写时 grep 验证(13 SSoT 守卫 / 36 callers / 22 callers / 9 import)

**决策记录:** 详见 `.planning/phases/02-代码规范化与流程清晰化/02-CONTEXT.md` §Implementation Decisions(12 项 D-01~D-23)
---

## Phase 3: compileCommands 重构

**Goal:** 把 1002 行 god 文件按职责拆 4 个子模块,公共 API 保持

**Mode:** standard

**Success Criteria:**
1. `src/clangd/compileCommands/{task,cache,symlink,fingerprint}.ts` 4 个子模块就位,公共类型在 `src/clangd/compileCommands/index.ts` 重新导出
2. `grep "import.*compileCommands" src/` 全部通过,无新 import 失败
3. `npm run test:unit` 全绿,新增 `test/unit/clangd/compileCommands/{task,cache,symlink,fingerprint}.test.ts` ≥ 4 个测试文件,覆盖拆出来的子模块

**Requirements:** PERF-01

**Plans:**
- Plan 3.1: 拆分 UBT -ProjectFiles task 执行(150 行)
- Plan 3.2: 拆缓存层(200 行)
- Plan 3.3: 拆 symlink workspace 根(150 行)
- Plan 3.4: 拆 fingerprint/缓存键逻辑(200 行)
- Plan 3.5: 重写 index.ts 重新导出,验证集成测试

**Risks:** 拆分破坏公共 API 兼容性 → Plan 3.5 验证 step 必须 0 警告 0 错误 + 全测

---

## Phase 4: 4 个中型 god 文件拆分

**Goal:** 把 4 个 300-700 行的中型 god 文件按职责拆 2-3 个子文件,公共 API 保持

**Mode:** standard

**Success Criteria:**
1. `src/core/workspace/{...}.ts` 拆 workspace.ts 307 行
2. `src/core/config/{...}.ts` 拆 config.ts 317 行
3. `src/ui/controlPanel/{...}.html.ts` 拆 controlPanel.html.ts 615 行
4. `src/clangd/proxy/bridge/{...}.ts` 拆 bridge.ts 692 行
5. 全部子文件 ≤ 250 行
6. `npm run test:unit` 全绿,每个被拆文件新增测试文件覆盖新增的子模块

**Requirements:** PERF-02

**Plans:**
- Plan 4.1: workspace.ts 拆分(2h)
- Plan 4.2: config.ts 拆分(2h)
- Plan 4.3: controlPanel.html.ts 拆分(3h,最大)
- Plan 4.4: proxy/bridge.ts 拆分(3h)
- Plan 4.5: 集成回归(1h)

**Risks:** 
- 拆分时跨文件引用混乱 → 每个 plan 末尾必须 0 typecheck 错误
- bridge.ts 涉及 LSP 协议处理,拆分后响应顺序错乱 → Plan 4.4 必须保留请求/响应相关性测试

---

## Phase 5: Live Coding AI 集成

**Goal:** Live Coding 命中 P0 错误时,基于 MCP 工具链提供 AI 自动建议 + 用户确认流程

**Mode:** standard

**Success Criteria:**
1. MCP 新增 `ue_suggest_fix` 工具,接收 P0 错误 + 上下文,返回 AI 修复建议
2. 用户在 Problems Panel 看到 P0 错误时,QuickFix 菜单出现"AI 建议修复"选项
3. 端到端 demo:故意写错代码 → Live Coding → 命中 P0 → QuickFix → AI 建议 → 用户确认 → 应用 patch

**Requirements:** LIVE-01

**Plans:**
- Plan 5.1: 调研 MCP 工具扩展点 + UE AI agent 行为(2h)
- Plan 5.2: `ue_suggest_fix` MCP 工具实现(3h)
- Plan 5.3: Problems Panel QuickFix 集成(3h)
- Plan 5.4: 端到端 demo + 文档(2h)

**Risks:** 
- 性能:AI 建议生成 > 3s 会破坏 Live Coding 节奏 → 节流同 LIVE
- 用户接受度:AI 建议错误率 → 默认"建议"非"自动应用"

---

## Phase 6: 汉化 TODO 决断

**Goal:** 6 个汉化 TODO 僵尸 (`localization.ts:79/91/103` + `bridge.ts:676/685/694`) 决断

**Mode:** standard

**Success Criteria (选项 A — 推荐,2h):**
1. 删 controlPanel UI 汉化 toggle(用户不会主动开启)
2. AGENTS.md 改"目前仅 hover 词典生效"
3. 6 个 TODO 函数体保留返回原值(不删函数,保留扩展点)
4. `grep "汉化" src/` 无 stale 引用

**Success Criteria (选项 B — 2-3d):**
1. 6 个 TODO 函数体填充实际汉化逻辑(Completion/SignatureHelp/InlayHint)
2. 翻译源:`src/clangd/proxy/localization.json` 扩展键
3. 新增测试覆盖 6 个扩展点
4. 控制面板 toggle 默认关,文档说明 6 类扩展已实现

**Requirements:** LIVE-02

**Plans (选项 A):**
- Plan 6.1: 删 controlPanel 汉化 toggle UI(30min)
- Plan 6.2: AGENTS.md 措辞更新(30min)
- Plan 6.3: 验证 6 个 TODO 函数仍可扩展(1h)

**Plans (选项 B):**
- Plan 6.1-6.6: 6 个 TODO 各 1 plan,每天 1-2 个

**Decision gate:** Phase 6 启动前 user 选 A 或 B(默认 A,推荐)

---

## 后续 (v2)

- **PERF-V2-01**: bridge.ts 深度拆分(超出 v1 范围)
- **PERF-V2-02**: e2e 测试覆盖
- **IDE-V2-01**: 跨平台调研(用户低优先)

---

## Risk Register

| Risk | Phase | Mitigation |
|------|-------|------------|
| AGENTS.md 修订引入新错误 | 1 | grep 每个被改数字,验证与实测一致 |
| 升级 `no-explicit-any` 触发 ≥ 5 处新错误 | 2 | Plan 2.1 Step 1.2 显式回退 warn + 延后到独立 phase |
| compileCommands 拆分破坏公共 API | 3 | Plan 3.5 验证 step 必须 0 警告 0 错误 |
| bridge.ts 拆分破坏 LSP 顺序 | 4 | 保留请求/响应相关性测试 |
| AI 建议生成 > 3s 破坏 Live Coding 节奏 | 5 | 同 LIVE 节流策略 |
| 汉化扩展范围膨胀 | 6 | 默认选项 A,选项 B 需 user 明确选 |

## Phase Dependencies

```
Phase 1 (docs) → 无依赖,优先做
Phase 2 (代码规范化 + 流程清晰化) → 独立(原依赖 DEBT-02 卸依赖后已无冲突),可与 Phase 1 并行
Phase 3 (compileCommands) → 独立,Phase 2 不再阻塞(原"避免与 DEBT-02 冲突"已失效)
Phase 4 (god files) → 独立
Phase 5 (AI 集成) → 独立,可在 Phase 3/4 之后
Phase 6 (i18n) → 最后,独立
```

---

## Backlog (deferred from prior phases)

原 Phase 1.2 / 1.3 / 2 范围(per 2026-07-23 D-01 重定义),显式延后:

| ID | Item | 原 Phase | 状态 | 备注 |
|----|------|----------|------|------|
| **DEBT-01** | `Config.completionMode` 死分支 API 收口(2 caller 改读 `COMPLETION_MODE` 静态常量 + 1 mock 调整) | Phase 2(原) | **TODO** | DEBT-02/03 已 DONE;此为收口残余 |
| **DEBT-02** ✅ | 卸 3 个零引用 runtime 依赖 — `execa` / `neverthrow` / `xstate` | Phase 2(原) | **DONE** | `package.json#dependencies` 已无;`grep "from ['\"](execa\|neverthrow\|xstate)"` 0 匹配 |
| **DEBT-03** ✅ | 替换 `resources/icon.png` 占位为合规 128×128 PNG | Phase 2(原) | **DONE** | commit `deb7ac7 chore(assets): 替换占位 icon.png ...`(2026-07-23) |
| **DOC-01** | `resources/README.md` 重写(删 `ue5-fast.json` / `banner.png` 描述 + icon TODO 行) | Phase 1.2(原) | **TODO** | 资源描述同步,等 Phase 2 流程清晰化顺手做 |
| **DOC-03** | 8 模块 AGENTS.md 数字校正(38 callers / 9 import / 72 测试 / 16.3k 行 / 9 别名 / 22 命令) | Phase 1.3(原) | **TODO** | 与 Phase 2 流程清晰化同主题延后 |

**后续 phase 可承接**(从 Phase 2 决策抽出):

- **CI/CD 流程**(GitHub Actions / husky / release-please)— 用户在 D-03 全拒,独立 phase 可承接
- **Phase 3-6 design doc 详细化** — D-23 仅写 1-2 段;后续 phase 可扩为完整 design
- **错误码体系替代现有 throw 路径** — D-14 仅新代码使用,旧 throw 路径延后
- **`any` / `@ts-ignore` 改写**(若 D-11 报告 ≥ 5 处)— 独立 phase

---

*Roadmap defined: 2026-07-23*
*Last updated: 2026-07-23 after Phase 2 complete (4 plans done: 00 + 2.1 + 2.2 + 2.3; 19 项子交付物全部落地)*
