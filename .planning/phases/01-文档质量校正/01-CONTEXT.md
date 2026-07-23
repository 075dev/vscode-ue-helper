# Phase 1: 文档质量校正 - Context

**Gathered:** 2026-07-23
**Status:** Ready for planning

## Phase Boundary

校正仓库知识库 (`AGENTS.md` / 8 模块 `AGENTS.md` / `resources/README.md`) 与 2026-07-23 实测状态的反漂移。**Phase 1 范围限定**:仅改 `AGENTS.md` 根文件的 4 处仓库陷阱措辞 (#1/#2/#7/#10);模块 AGENTS.md 数字校正与 `resources/README.md` 重写延后到 Phase 2 同主题延续(见 Deferred Ideas)。

## Implementation Decisions

### AGENTS.md 仓库陷阱措辞校准

- **D-01 (trap-1 改写):** 在第 102 行 #1 条目末尾追加斜体拄释,标记 T1.1 闭环 — **Reversibility:** reversible — 仅 1 行文档拄释,撤销成本为删除拄释
  - Before: `1. **\`npm run test:integration\` 已坏** — 脚本指向 \`test/integration/runTests.js\`,该目录不存在。\`npm test\` 跑 unit + integration,integration 步会失败。**只跑 unit**:\`npm run test:unit\`。`
  - After: `1. **\`npm run test:integration\` 已坏** — 脚本指向 \`test/integration/runTests.js\`,该目录不存在。\`npm test\` 跑 unit + integration,integration 步会失败。**只跑 unit**:\`npm run test:unit\`。*(T1.1 闭环 2026-07-23:\`package.json#470\` \`test\` script alias 到 \`test:unit\`,原 \`npm run test:integration\` 已删除)*`

- **D-02 (trap-2 改写):** 在第 103 行 #2 条目末尾追加斜体拄释,标记 T2.1 闭环 + 新代码正确路径 — **Reversibility:** reversible — 1 行拄释,撤销成本为删除
  - After: `2. **\`completionMode\` 设置已废弃** — \`package.json\` 里 \`deprecationMessage\` 标明,值 \`'fast'\` 在 \`Config.completionMode\` getter 归一化为 \`'slow'\`。\`resources/preparse-includes/ue5-fast.json\` 已被删除,只剩 \`ue5-slow.json\`。**不要新增 fast/slow 分支代码**。*(T2.1 闭环 2026-07-23: 新代码读静态常量 \`COMPLETION_MODE = 'slow'\`,不再读 \`config.completionMode\`;\`src/core/config.ts:137-139\` getter 保留仅作废弃 API 兼容)*`

- **D-03 (trap-7 改写):** 在第 108 行 #7 条目末尾追加斜体拄释,标记 T4.7 闭环 + 实际生效情况 — **Reversibility:** reversible — 1 行拄释
  - After: `7. **MSVC 错误正则**: \`^(.*?)\\\\((\\\\d+)(?:,(\\\\d+))?\\\\)\\\\s*:\\\\s*(error|warning|note|fatal error)\\\\s+([A-Z]+\\\\d+)\\\\s*:\\\\s*(.*)$\`,定义在 \`package.json#contributes.problemMatchers\`, \`src/parsers/msvcParser.ts\` 用同一正则。改一处要同步另一处。*(T4.7 闭环 2026-07-23: 正则已统一;**实际生效的是 \`src/parsers/msvcParser.ts\`, \`package.json#problemMatchers\` 仅作 Task 用户手工配置参考**(本插件不自动 task 消费 UBT 输出))*`

- **D-04 (trap-10 改写):** 在第 111 行 #10 条目末尾追加斜体拄释,标记 T1.x 部分闭环 + 真正陷阱 — **Reversibility:** reversible — 1 行拄释
  - After: `10. **\`Config.update\` 写完必须 refresh** — \`src/core/config.ts\` 内部已处理,但调用方常见误用:\`await config.update(); 立刻读 config.xxx\` 会拿到旧值(VS Code 同进程内不主动通知 WorkspaceConfiguration 失效)。改动该类代码要测试写入后读回。*(T1.x 部分闭环 2026-07-23: \`Config.update\` 内部已调 \`refreshRoot()\` 立即刷新;**但**跨实例/跨闭包缓存 \`config\` 引用仍会读到旧值)*`

### 不动的陷阱

- #3-#6 / #8 / #9 / #13:不在 Phase 1 范围,保留原文
- #11:本次不与 #2 合并(虽都是 `completionMode` 主题),独立条目保留 `completionMode` 已死但 API 还在的描述 — 两条目互补,#2 是配置/资源删除视角,#11 是 API surface 视角
- #12:已用 ✅ + 删除线正确表达,不动

### 改写风格 (D-05)

- 统一斜体拄释,放在条目末尾,括号内给:T编号 + 闭环日期 + 简明现状 + 真正陷阱(如适用)
- 风格与 #12 `✅ 已解决` 标记呼应
- 选这个风格是因为:**最小化视觉干扰,保留原条目作为历史档案**(未来读者能看到 trap 是怎么演化的)
- 不选删除线:`#12` 用删除线 + ✅ 是因为有"不要复活"警告; #1/#2/#7/#10 都不需要这种警告
- 不选 emoji 标记 ✅:`#12` 是唯一闭环的,#1/#2/#7/#10 都是部分闭环或语义已变,用 T编号更准确(避免误导"已完全解决")

### Claude's Discretion

- 4 处拄释的具体措辞由 Claude 起草(基于 CONCERNS.md 2026-07-23 校准段)
- 校准后是否需要在文末追加 "Last updated: 2026-07-23 after T1.x calibration":**否**,AGENTS.md 已有 git log,加 footer 是噪音

### Folded Todos

(无 — `cross_reference_todos` 步骤无匹配)

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project context
- `.planning/PROJECT.md` § Key Decisions — Phase 8/9 SSoT / Live Coding 5s 节流 等决策
- `.planning/REQUIREMENTS.md` § v1 Requirements — DOC-01/02/03 是 Phase 1 主题
- `.planning/ROADMAP.md` § Phase 1 — 3 个 plan (1.1 AGENTS.md diff, 1.2 resources/README, 1.3 模块数字批处理)
- `.planning/codebase/CONCERNS.md` § Tech Debt — 13 仓库陷阱的"原始 concern" vs "当前实际状态"对比表
- `.planning/codebase/CONCERNS.md` § 严重度总览 — T1.1/T1.2/T2.1/T2.6/T4.7 标 ✅,T1.3/T2.2/T3.3 等标 ⚠️ 未执行

### AGENTS.md 仓库陷阱源
- `AGENTS.md` (项目根) — 仓库陷阱 #1-#13 原文,本次仅改 #1/#2/#7/#10

### 校准依据
- `.planning/codebase/ARCHITECTURE.md` — 校正后数字参考(38 callers / 9 直接 import / 72 测试 / 16.3k 行 / 9 路径别名 / 22 命令)
- `.planning/codebase/CONVENTIONS.md` § MSVC 错误正则同步 — T4.7 修复细节
- `src/core/config.ts:137-139` — T2.1 简化后 getter 现状
- `package.json:444` problemMatchers + `package.json:470` test script — 当前配置状态

## Existing Code Insights

### Reusable Assets
- (N/A — 纯文档工作,无代码资产)

### Established Patterns
- **仓库陷阱格式**:`# 编号` + `**粗体短句**` + `— 解释` + `*(斜体拄释)*` — 现有 #12 已示范
- **AGENTS.md 是仓库知识库**:13 项仓库陷阱每条都是历史真实事故,改代码前必读;Phase 1 维护"反漂移"是核心价值

### Integration Points
- `AGENTS.md` 是新贡献者第一份读物;`src/core/AGENTS.md` + 7 个模块 AGENTS.md 都引用根 AGENTS.md 的仓库陷阱编号
- `package.json#contributes.configuration` 的 `deprecationMessage` 字段实际标注了 `completionMode` (D-02 校准后这个标注仍有意义)

## Specific Ideas

- 用户偏好:minimum-scope + 默认走"AGENTS.md 仓库陷阱"方向而非"模块 AGENTS.md 数字校正"(后者更机械化)
- 用户偏好:斜体拄释风格(与 #12 ✅ 标记呼应,最小视觉干扰)
- 用户偏好:不动 #11(虽与 #2 同主题,保留互补视角)
- 用户偏好:同步动 #1/#2/#7/#10 (4 处,而不是只动 #1 最小扩散)— 决策是"批量校准比分散 PR 更干净"

## Deferred Ideas

### Reviewed Todos (not folded)

### Phase 1 范围内延后
- **DOC-03 数字校正** (8 模块 AGENTS.md 数字:38 callers / 9 import / 72 测试 / 16.3k 行 / 9 别名 / 22 命令 / `.sh` 已删 / DDD 不活跃)— Phase 2 续做(同主题)
- **DOC-01 resources/README.md 重写** — Phase 2 续做(同主题,删 ue5-fast.json / banner.png 描述)
- **漂移防护机制** (grep guard / pre-commit hook / phase 决策文档)— 新增独立 task,可作为 Phase 2 一部分;用户问过但未在 Phase 1 范围

### 后续 phase
- **DOC-02 中 #3-#6 / #8 / #9 / #13 措辞** — 这些未与实测漂移,本期不动;若未来漂移再单独校准
- **#11 completionMode 已死但 API 还在** — 措辞本期不动;但实际 API 收口在 Phase 2 DEBT-01 完成(`Config.completionMode` getter 删除 + caller 改静态常量);Phase 2 完成后 #11 也应标闭环

---

*Phase: 1-文档质量校正*
*Context gathered: 2026-07-23*
