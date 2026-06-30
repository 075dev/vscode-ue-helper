# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — 控制面板

**Shipped:** 2026-07-01
**Phases:** 3 | **Plans:** 3 | **Sessions:** ~1 day

### What Was Built
- 4-Tab WebView 控制面板（Actions/Config/Proxy/Status）
- 16 个一键操作按钮覆盖所有插件命令
- 15 个配置字段可视化编辑（Config 7 + Proxy 8）
- 实时状态展示（项目/构建/代理信息）
- 完整中英文 i18n 支持
- 498 个测试，35 个测试文件

### What Worked
- **纯 WebView API + 无前端框架**：零额外依赖，构建简单，部署轻量
- **消息协议设计**：postMessage/onDidReceiveMessage 模式清晰，扩展方便
- **分 3 阶段交付**：Phase 1 按钮（最大价值先行），Phase 2 配置，Phase 3 状态
- **CONFIG_KEY_MAP 映射**：字段名 ↔ VS Code config key 映射清晰可维护

### What Was Inefficient
- **GSD 管理器未跟踪执行**：开发直接完成所有阶段后再归档，导致 init.manager 显示 incomplete
- **缺乏阶段性验证记录**：没有为每个阶段创建 SUMMARY/VERIFICATION 文件，归档时需要手动重建

### Patterns Established
- **控制面板 4 Tab 分区**：Actions/Config/Proxy/Status 功能正交
- **Unicode 图标替代图标库**：避免前端依赖，跨平台兼容
- **配置批量保存 + 回执机制**：saveConfig → saveResult 异步确认

### Key Lessons
1. 在 GSD 工作流中执行时，应每个阶段完成后运行 `/gsd-verify-work` 创建验证记录
2. 纯 HTML/CSS/JS 的 WebView 方案对 VS Code 插件足够，无需引入前端框架
3. 消息协议应先定义类型再实现，避免后期类型不匹配

### Cost Observations
- Model mix: 本次为单模型会话
- Sessions: 1 个开发会话
- Notable: 所有工作在单个连续会话中完成

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~1 day | 3 | 初始里程碑，项目从 0 到 1 |

### Cumulative Quality

| Milestone | Tests | Files | LOC Change |
|-----------|-------|-------|------------|
| v1.0 | 498 | 46 | +3,303 / -140 |

### Top Lessons (Verified Across Milestones)

1. *(First milestone — no cross-validation yet)*
