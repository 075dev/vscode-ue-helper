# Codewiki 更新日志

## [v1.0.1] 2026-06-26
- 触发: pa 指令 —— codewiki-engineer 参考源信息写入目标修正
- 变更: `.codewiki/architecture.md` 新增 §7 项目溯源
- 内容: 从 `doc/01-architecture.md:270-365` 同步 §9 项目溯源
  - 7.1 参考源概览（engine-link + unreal-clangd）
  - 7.2 engine-link 贡献分析（6 项继承模式 + 3 项未被继承的决策）
  - 7.3 unreal-clangd 贡献分析（6 项继承模式 + 3 项未被继承的决策）
  - 7.4 融合架构决策（4 个融合点）
  - 7.5 参考信息表（12 维度对比）
- 文件大小: 98 → 194 行 (+96 行)

## [v1.0.0] 2026-06-26
- 触发: dev-vp 指令，全量 Codewiki 生成
- 变更范围: 全项目
- 模块数: 11 个核心模块 + extension.ts
- 产出:
  - `INDEX.md` — 全局导航索引
  - `architecture.md` — 架构总览（激活流程、模块依赖图、设计决策）
  - `dependencies.md` — 全局依赖图（Mermaid）、依赖矩阵、循环检测、耦合分析
  - `traceability.md` — 溯源索引（43+ 条结论，含文件:行号）
  - `modules/core.md` — core 模块文档
  - `modules/i18n.md` — i18n 模块文档
  - `modules/detection.md` — detection 模块文档
  - `modules/build.md` — build 模块文档
  - `modules/clangd.md` — clangd 模块文档
  - `modules/commands.md` — commands 模块文档
  - `modules/ui.md` — ui 模块文档
  - `modules/mcp.md` — mcp 模块文档
  - `modules/parsers.md` — parsers 模块文档
  - `modules/rules.md` — rules 模块文档
  - `modules/extension.md` — extension.ts 入口文档
  - `changelog.md` — 本文件
- 关键数据: 11 模块, 43+ 溯源条目, 0 循环依赖, 耦合度低
