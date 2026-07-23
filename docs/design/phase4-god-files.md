# Phase 4 Design: 4 个中型 god 文件拆分

**Phase 编号**: 4
**REQ-IDs**: PERF-02
**估算**: 8-10h

## 为什么拆

Phase 2 评估列 4 个"中型 god 文件"(500-1000 行,未达 Phase 3 的 1000+ 严重线但仍超 500 行合理线):

1. `src/core/workspace.ts` (~800 行) —— Phase 8 SSoT 后 getter 数量膨胀
2. `src/core/config.ts` (~600 行) —— 配置类 + refresh 逻辑 + 派生 getter
3. `src/ui/controlPanel.ts` (~700 行) —— Webview provider + HTML 生成 + 消息协议
4. `src/clangd/proxy/bridge.ts` (~900 行) —— LSP proxy 转发 + 拦截增强

每个文件的问题:

- **多类职责并存**: 例 `controlPanel.ts` 同时含 webview 注册 / HTML 字符串生成 / host-webview 消息路由
- **测试 fixture 难构造**: 测 1 个细节要 mock 整个 webview 上下文
- **新人 diff 难聚焦**: 改 HTML 字符串 vs 改消息协议,在同一文件 PR review 看 700 行

## 拆什么

| 文件 | 当前 | 拆后(预计) |
|---|---|---|
| `src/core/workspace.ts` | 800 行 | `workspaceState.ts` (350) + `workspaceDerive.ts` (250) + `workspaceSelect.ts` (200) |
| `src/core/config.ts` | 600 行 | `config.ts` (250) + `configDerive.ts` (200) + `configPersist.ts` (150) |
| `src/ui/controlPanel.ts` | 700 行 | `controlPanelProvider.ts` (200) + `controlPanelHtml.ts` (300) + `controlPanelMessages.ts` (200) |
| `src/clangd/proxy/bridge.ts` | 900 行 | `bridgeCore.ts` (400) + `bridgeTranslate.ts` (300) + `bridgeState.ts` (200) |

`index.ts` 全部 re-export 保 API 兼容。

## Tradeoffs

- **+ 12 个文件替代 4 个**: 每文件 200-400 行,职责单一
- **+ 测试可单文件级**: 例 `controlPanelMessages.test.ts` 只 mock message protocol,不依赖 webview
- **− 跨文件调用链**: 例 `bridge` 拆分后,改一个 LSP 拦截点要跳读 3 个文件
- **− re-export 层维护**: 12 个新文件的导出都要在 `index.ts` 显式列出

## 决策依据

- **为什么 4 个一起拆**: 都是 500-1000 行"中等 god",模式相似(单文件多职责),一起拆可以共用测试 mock 工具与 re-export 模式
- **为什么 re-export**: 22+ 已有 callers 不能改 import,这是**必要**的兼容成本
- **为什么不拆 1000+ 行的 `compileCommands.ts`**: 那属于 Phase 3 范围(单一文件超 1000 行),不混在 Phase 4

## 验收

- 4 个原文件每个 ≤ 400 行
- 12 个新文件每个 ≤ 400 行
- `npm run test:unit` 全绿 + 新增单测 ≥ 20 个(平均每个原文件 5 个)
- 公共 API 0 改动(re-export 守门)
- 性能不退步(P95 ±5%)

## 风险

- **R1 (High)**: 跨文件 mock 增加测试 setup 复杂度 —— Mitigation: 抽 `mockBridge()` / `mockWebview()` 等工具 helper 到 `test/unit/__helpers__/`
- **R2 (Medium)**: 误删原文件导致 callers 找不到符号 —— Mitigation: `index.ts` re-export 守门,`tsc` 编译期检查
- **R3 (Medium)**: `workspace.ts` 拆分后 `WorkspaceState` 状态机断裂 —— Mitigation: 先写 13 import 的集成测试,确保拆分前后行为一致
- **R4 (Low)**: `bridge.ts` LSP 状态机有微妙 race condition —— Mitigation: 拆分前先 `grep -nE 'setTimeout|setInterval|Promise\.resolve'` 列出所有异步点,逐个保留语义
