# Roadmap: VSCodeUEHelper

**Defined:** 2026-07-23
**Source:** `.planning/PROJECT.md` + `.planning/REQUIREMENTS.md` + `.planning/codebase/` (7 docs, 2088 lines, 2026-07-23)
**Project mode:** standard (Horizontal Layers) — refactor + 文档 + 债务 + 小特性,无巨型独立 feature
**Granularity:** Standard (6 phases, 1-3 plans each, 估算 5-25h/phase)

## Phase 概览

| # | Phase | Goal | REQ-IDs | 估算 |
|---|-------|------|---------|------|
| 1 | 文档质量校正 | 仓库知识库与实测同步,反漂移 | DOC-01, DOC-02, DOC-03 | 2-3h |
| 2 | 技术债清理 (小) | 删死代码/换图标/卸依赖 | DEBT-01, DEBT-02, DEBT-03 | 4-5h |
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

## Phase 2: 技术债清理 (小)

**Goal:** 删除死代码、换图标、卸零引用依赖,降低未来 on-call 风险

**Mode:** standard

**Success Criteria:**
1. `src/core/config.ts` 删 `completionMode` getter,`src/ui/controlPanel.ts` / `src/commands/createProject.ts` / `src/commands/showProjectInfo.ts` 改读静态常量,`grep "config.completionMode" src/` 零匹配
2. `package.json#dependencies` 移除 `execa` / `neverthrow` / `xstate`,`npm run build` + `npm run test:unit` + `npm run typecheck` + `npm run lint` 全部通过
3. `resources/icon.png` 替换为合规 128×128 PNG(`file` 命令验证尺寸 + 非零字节)

**Requirements:** DEBT-01, DEBT-02, DEBT-03

**Plans:**
- Plan 2.1: `Config.completionMode` API 收口(2h)
- Plan 2.2: 卸 3 个零引用 runtime 依赖(1.5h)
- Plan 2.3: 替换 `resources/icon.png` 占位(30min)

**Risks:** 
- 卸依赖后有隐藏引用 → Plan 2.2 验证步骤:卸完后跑全测 + grep
- icon 替换不通过 Marketplace 审核 → 验证方式:对照 .vsix 资产规范

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
| 卸依赖后有隐藏引用 | 2 | 卸完后跑全测 + grep |
| compileCommands 拆分破坏公共 API | 3 | Plan 3.5 验证 step 必须 0 警告 0 错误 |
| bridge.ts 拆分破坏 LSP 顺序 | 4 | 保留请求/响应相关性测试 |
| AI 建议生成 > 3s 破坏 Live Coding 节奏 | 5 | 同 LIVE 节流策略 |
| 汉化扩展范围膨胀 | 6 | 默认选项 A,选项 B 需 user 明确选 |

---

## Phase Dependencies

```
Phase 1 (docs) → 无依赖,优先做
Phase 2 (debt) → 独立,可与 Phase 1 并行
Phase 3 (compileCommands) → 依赖 Phase 2 完成(避免与 DEBT-02 冲突)
Phase 4 (god files) → 依赖 Phase 2 完成(Config 拆分)
Phase 5 (AI 集成) → 独立,可在 Phase 3/4 之后
Phase 6 (i18n) → 最后,独立
```

---
*Roadmap defined: 2026-07-23*
*Last updated: 2026-07-23 after Phase 1.1 completion (Plan 1.2 / 1.3 deferred to Phase 2)*
