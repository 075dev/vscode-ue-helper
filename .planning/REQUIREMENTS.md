# Requirements: VSCode UE Helper — Proxy 本地化增强

**Defined:** 2026-07-01
**Core Value:** UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## v1.1 Requirements

Requirements for milestone v1.1. Each maps to a roadmap phase.

### LOC-01: CLI 层传递 localization 配置给 LspBridge

- [ ] **LOC-01-01**: `cli.ts` 在创建 LspBridge 时构造 `LocalizationOptions` 对象并传递
- [ ] **LOC-01-02**: 从 `CliOptions` 读取 `localizationEnabled` / `localizationMode` / `localizationTargets` 构建选项
- [ ] **LOC-01-03**: 调用 `createDefaultLocalizationTable()` 作为规则表
- [ ] **LOC-01-04**: localization 禁用时传递 `undefined`，保持向后兼容

### LOC-02: 两种汉化模式支持

- [ ] **LOC-02-01**: 新增 `zh-only` 模式别名，语义为"仅中文"（替换英文原文）
- [ ] **LOC-02-02**: `append` 模式保持"中英双语"（原文 + `[中文翻译]` 追加）
- [ ] **LOC-02-03**: CLI 参数 `--localization-mode` 接受 `append` / `zh-only`
- [ ] **LOC-02-04**: Config 类型 `ClangdProxyLocalizationMode` 新增 `zh-only` 值
- [ ] **LOC-02-05**: bridge.ts `getAdaptedTable()` 将 `zh-only` 映射为 rule 层 `replace` 模式
- [ ] **LOC-02-06**: 控制面板 Proxy Tab 模式选择器标签更新（中英双语 / 仅中文）
- [ ] **LOC-02-07**: 模式切换后提示用户重启 Proxy 生效

### LOC-03: 完善汉化规则

- [ ] **LOC-03-01**: 新增 UE 常见诊断规则（虚函数覆盖未标记 override、隐式转换丢失精度等）
- [ ] **LOC-03-02**: 规则总数从 22 条扩展至 30+ 条
- [ ] **LOC-03-03**: 为新增规则添加单元测试

### LOC-04: 端到端验证

- [ ] **LOC-04-01**: 编写集成测试验证 CLI args → LspBridge 的 localization 传递
- [ ] **LOC-04-02**: 编写集成测试验证 append 模式下输出为"原文 + 翻译"
- [ ] **LOC-04-03**: 编写集成测试验证 zh-only 模式下输出仅为翻译
- [ ] **LOC-04-04**: 确认现有 498 个测试全部通过（无回归）

## v2 Requirements

### 面板增强

- **CTRL-F1**: 面板支持快捷键绑定
- **CTRL-F2**: 面板支持自定义按钮排序
- **CTRL-F3**: 面板支持构建历史查看

### 本地化增强

- **LOC-F1**: 自动检测 VS Code 语言环境启用本地化
- **LOC-F2**: 每条规则可单独配置 mode
- **LOC-F3**: 自定义规则表编辑 UI
- **LOC-F4**: 规则优先级配置

## Out of Scope

| Feature | Reason |
|---------|--------|
| 替换现有状态栏 | 状态栏和控制面板互补，用户可同时使用 |
| 实时构建日志输出到面板 | 构建日志在 Output 通道更合适 |
| 自定义规则编辑 UI | 复杂度高，推迟到 v2+ |
| 自动检测语言环境启用本地化 | 依赖 VS Code API，推迟到 v1.2 |
| Phase 4+ 面板增强 | 推迟到 v1.2 |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOC-01-01 ~ LOC-01-04 | Phase 4 | Pending |
| LOC-03-01 ~ LOC-03-03 | Phase 4 | Pending |
| LOC-02-01 ~ LOC-02-05 | Phase 5 | Pending |
| LOC-02-06 ~ LOC-02-07 | Phase 6 | Pending |
| LOC-04-01 ~ LOC-04-04 | Phase 6 | Pending |

**Coverage:**
- v1.1 requirements: 18 sub-items total
- Mapped to phases: 18
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-01*
*Last updated: 2026-07-01 — updated traceability for Phase 4-6 roadmap*
