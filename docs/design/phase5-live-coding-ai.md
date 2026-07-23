# Phase 5 Design: Live Coding AI 集成

**Phase 编号**: 5
**REQ-IDs**: LIVE-01
**估算**: 8-12h

## 为什么做

VSCodeUEHelper 的 Live Coding 现状(2026-07,Phase H1 完成后)只能"保存 .h → 触发 UHT + reparse",**不修复任何编译错误**。UE5 C++ 用户最常遇到的痛点:

1. 头文件改完忘改 cpp → 链接错误
2. GENERATED_BODY() 漏写 → "unknown_typename" 错误
3. UFUNCTION 缺 Category/BlueprintPure meta → 编辑器运行时报错
4. UCLASS 反射宏不匹配 → UHT 直接 crash

Rider 通过 IDE 内嵌诊断 + AI 补全(部分版本)减少这些错误。VSCodeUEHelper 借助 MCP 暴露 UE C++ 工作流给 Cursor / Claude Code,让 AI 主动修复。

## 拆什么

**不是新拆**,是**功能扩展** —— 在现有 `src/clangd/ueLinkManager.ts` (H1) + `src/mcp/tools.ts` (6 个工具) 基础上加:

1. **错误捕获**: `src/parsers/msvcParser.ts` 已经解析 UBT 错误为 `ParsedDiagnostic[]`,但只写入 Problems 面板。新增:把 ParsedDiagnostic 暴露给 MCP 工具
2. **AI 修复入口**: MCP 工具 `ue_diagnose_and_suggest_fix(diagnostic)`: 给定错误诊断,返回"AI 建议的修复"(基于文件内容 + 错误类型 pattern match)
3. **一键应用**: MCP 工具 `ue_apply_fix(diagnostic_id, suggested_fix)`: 把 AI 建议写入文件 + 触发保存
4. **状态栏 UI**: 错误状态栏按钮,点击显示当前文件最近 5 个错误 + "AI 修复"按钮

**新增文件**:

| 文件 | 行数 | 职责 |
|---|---|---|
| `src/mcp/aiFix.ts` | ~150 | AI 建议生成(基于错误类型 + 上下文的简单规则,不依赖 LLM API) |
| `src/ui/aiFixButton.ts` | ~80 | 状态栏 AI 修复按钮 |
| `src/mcp/tools.ts` 扩展 | +20 行 | 新增 2 个工具 |

**不新增** LLM API 依赖 —— 用规则 + 文件内容分析("GENERATED_BODY() 缺失时补"等),保持"零 runtime 依赖"约束(per PROJECT.md §Constraints)。

## Tradeoffs

- **+ 用户价值**: 头文件改完忘改 cpp → AI 主动建议,体感对标 Rider
- **+ 复用现有**: msvcParser / ueLinkManager 都是 Phase 1-2 验证的代码,集成风险低
- **− 简单规则 vs LLM**: 规则只能处理 4 类常见错误(头/cpp 错配 / GENERATED_BODY 缺失 / Category 缺失 / 反射宏不匹配),LLM 能处理更多但引入 API 依赖
- **− 状态栏 UI 复杂度**: 11 → 12 个按钮(接近视觉密度极限)

## 决策依据

- **为什么 MCP 入口**: 仓库已有 MCP 框架(Phase 2 验证),`tools.ts` 6 工具已注册,加 2 个成本低
- **为什么不用 LLM API**: 零 runtime 依赖是硬约束(D-03 + PROJECT.md),LLM API 增加 token 成本与网络依赖
- **为什么 4 类错误**: 仓库已有 11 个 ueReflectionLinter 规则,扩到 4 类"AI 修复"刚好覆盖最常见 case
- **为什么不做 edit 命令链**: 现有 ue_apply_fix 一次性写文件,简化交互;后续 phase 可加"diff preview"步骤

## 验收

- 4 类错误各自有规则匹配 + 修复建议(总计 4+ 个 test case)
- 状态栏按钮正常显示(11 → 12 按钮布局)
- MCP 工具注册总数: 6 → 8
- `npm run test:unit` 全绿 + 新增 ≥ 8 个测试
- 0 个新 runtime 依赖(规则引擎纯函数)

## 风险

- **R1 (Medium)**: 状态栏 12 按钮视觉密度 —— Mitigation: 收纳到"右键菜单的子菜单",11 个主按钮不变
- **R2 (Medium)**: 误修复导致新 bug —— Mitigation: 修复前 diff preview(让用户确认);若不接受就 skip
- **R3 (Low)**: 规则引擎 vs LLM 体验差距大 —— Mitigation: 文档明示"AI 修复 = 规则匹配,不是 LLM",用户预期对齐
- **R4 (Low)**: MCP 工具膨胀(8 个) —— Mitigation: `ue_*` 命名空间已分组,新增不冲突
