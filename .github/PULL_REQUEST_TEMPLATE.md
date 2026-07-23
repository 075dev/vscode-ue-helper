## Phase

<!-- 勾选本 PR 归属的 Phase -->

- [ ] Phase 1 — 文档质量校正
- [ ] Phase 2 — 代码规范化与流程清晰化
- [ ] Phase 3 — compileCommands 重构
- [ ] Phase 4 — 4 个中型 god 文件拆分
- [ ] Phase 5 — Live Coding AI 集成
- [ ] Phase 6 — 汉化 TODO 决断
- [ ] Other / N/A

## 影响模块

- [ ] build
- [ ] clangd
- [ ] commands
- [ ] core
- [ ] detection
- [ ] mcp
- [ ] ui
- [ ] i18n
- [ ] 文档(AGENTS / CONTRIBUTING / DEBUG / RELEASE)
- [ ] 配置(package.json / .eslintrc / tsconfig)

## 测试步骤

<!-- 描述如何验证本次改动 -->

1. ...
2. ...

## Screenshots / Logs

<!-- UI 改动附截图;UBT 输出 / LSP 日志附文本 -->

## Breaking Changes

- [ ] 无 breaking change
- [ ] 有 breaking change(请在描述里说明)

## Checklist

- [ ] `npm run typecheck` 0 errors
- [ ] `npm run lint` 0 errors
- [ ] `npm run test:unit` 全绿
- [ ] i18n 双语同步(若改了文案)
- [ ] 中文 JSDoc 覆盖(若新增 export 函数)
- [ ] 改 AGENTS.md 时附 `*(T-NN 闭环 ...)*` 风格注释
- [ ] 不引入新 runtime 依赖
