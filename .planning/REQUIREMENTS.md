# Requirements: VSCodeUEHelper

**Defined:** 2026-07-23
**Core Value:** 在 Windows + VS Code 上提供与 Rider 等价的 UE5 C++ 开发体验,且冷启动与内存开销显著优于 Rider
**Source:** Brownfield onboard from `.planning/codebase/` (7 docs, 2088 lines, 2026-07-23)

## v1 Requirements

<!-- 从 .planning/PROJECT.md ## Active 推断,10 条需求按 4 个 category 分组 -->

### Documentation / 文档质量 (P1)

- [ ] **DOC-01**: 重写 `resources/README.md` 删除已删的 `ue5-fast.json` / `banner.png` 描述
- [ ] **DOC-02**: AGENTS.md 仓库陷阱 #1 / #7 / #10 / #11 / #12 措辞更新(反漂移 — 实际已修复但描述未跟进)
- [ ] **DOC-03**: 8 个模块 `src/<module>/AGENTS.md` 与实测差异校正:
  - `WorkspaceState` 38 callers (not 36)
  - `ClangdOps` 9 直接 import (not 22)
  - 72 测试文件 / 16.3k 行 (not 71 / 12k)
  - 9 路径别名 (not 11, `@platform` 死,`@rules` 仅 doc)
  - 22 命令文件 (not 21)
  - `out/launcher/*.sh` 已删 (N2 cleanup)
  - DDD `application/` / `infrastructure/` 是 H3 决策占位,不活跃

### Tech Debt / 技术债清理 (P0)

- [ ] **DEBT-01**: `Config.completionMode` 死分支 API 收口 — 删 getter,caller 改读静态常量 `'slow'`
- [ ] **DEBT-02**: 卸载 3 个零引用 runtime 依赖 — `execa` / `neverthrow` / `xstate` (从 `package.json#dependencies` 移除 + 验证 `npm run build` 仍通过)
- [ ] **DEBT-03**: 67 字节占位 `icon.png` 替换为合规 128×128 Marketplace icon (`.vscodeignore` 已配置,只需替换源文件)

### Refactor / 重构 god 文件 (P1,大型任务)

- [ ] **PERF-01**: 拆分 `src/clangd/compileCommands.ts` god 文件为 4 个子模块 — `compileCommands/{task,cache,symlink,fillMissing}.ts`，公共 API 保持（实现与自动化验收完成；真实 UE command smoke 尚未完成，因此按 execute-phase 工作流保持未勾选）
- [ ] **PERF-02**: 拆分 4 个中型 god 文件:
  - `src/core/workspace.ts` 307 行
  - `src/core/config.ts` 317 行
  - `src/ui/controlPanel.html.ts` 615 行
  - `src/clangd/proxy/bridge.ts` 692 行
    按职责拆 2-3 个子文件,公共 API 保持,8-10h 估算

### Feature / 新能力交付 (P2)

- [ ] **LIVE-01**: Live Coding 命中 P0 错误时一键修复流程 — 基于 MCP 工具链,AI 自动建议 + 用户确认(prototype)
- [ ] **LIVE-02**: 6 个汉化 TODO 僵尸处理 — `src/clangd/proxy/localization.ts:79/91/103` + `src/clangd/proxy/bridge.ts:676/685/694`
  - 选项 A(推荐,2h):删 panel UI 汉化 toggle + AGENTS.md 改"目前仅 hover 词典生效"
  - 选项 B(2-3 天):填充 6 个 TODO

## v2 Requirements

<!-- 延后到 v2 之后 -->

### Performance / 性能深度优化

- **PERF-V2-01**: 完整拆分 `src/clangd/proxy/bridge.ts` 692 行为更细粒度模块(超出 v1 范围)
- **PERF-V2-02**: 添加 e2e 测试覆盖(目前只有单测 + 集成测试 broken)

### IDE 增强

- **IDE-V2-01**: 跨平台 Mac/Linux 支持调研(用户明确表示不优先,但记录在案)

## Out of Scope

| Feature                                               | Reason                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| Mac/Linux 跨平台支持                                  | 已在 `package.json#platforms: ["win32"]` 强制;用户专攻 Windows + VS Code |
| 非 UE5 项目(Unity/纯 C++/Rust)                        | 扩展 parsers/MSVC/UBT 全部 UE 特有                                       |
| 远程构建                                              | UBT 走本地 spawn,无远程支持;团队用 VPN 替代                              |
| 完整 Rider 替代(Blueprint/Content Browser/Scene 编辑) | VS Code 不做重量级 IDE 功能                                              |
| 6 类之外的 LSP 协议汉化(Definition/Reference/Rename)  | 只覆盖 4 类典型;扩展范围会快速膨胀                                       |
| fast/slow completion mode 分支                        | Phase 8 已合并为 `slow`,`Config.completionMode` 已死                     |
| `populateAddCompletions` 复活                         | Phase 9 SSoT 已删,13 个 SSoT 守卫防复活                                  |
| `headerWatcher` 主动扫描                              | Phase 8 替换为 `UeDiagnosticWatcher` 被动触发,主动 watcher 浪费资源      |

## Traceability

<!-- 由 roadmapper 填写,这里给个初始映射 -->

| Requirement | Phase   | Status                                            |
| ----------- | ------- | ------------------------------------------------- |
| DOC-01      | Phase 1 | Pending                                           |
| DOC-02      | Phase 1 | Pending                                           |
| DOC-03      | Phase 1 | Pending                                           |
| DEBT-01     | Phase 2 | Pending                                           |
| DEBT-02     | Phase 2 | Pending                                           |
| DEBT-03     | Phase 2 | Pending                                           |
| PERF-01     | Phase 3 | Implemented; human verification pending            |
| PERF-02     | Phase 4 | Pending                                           |
| LIVE-01     | Phase 5 | Pending                                           |
| LIVE-02     | Phase 6 | Pending                                           |

**Coverage:**

- v1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0 ✓

---

_Requirements defined: 2026-07-23_
_Last updated: 2026-07-24 after Phase 3 artifact audit (automated acceptance passed; real UE smoke pending)_
