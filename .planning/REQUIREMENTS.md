# Requirements: VSCode UE Helper — clangd 智能提示与集成完善

**Defined:** 2026-07-04 (re-scoped from localization)
**Core Value:** UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## v1.1 Requirements (已交付)

Requirements for milestone v1.1 — 全部已完成。

### LOC-01: CLI 层传递 localization 配置给 LspBridge ✅

- [x] **LOC-01-01**: `cli.ts` 在创建 LspBridge 时构造 `LocalizationOptions` 对象并传递
- [x] **LOC-01-02**: 从 `CliOptions` 读取 `localizationEnabled` / `localizationMode` / `localizationTargets` 构建选项
- [x] **LOC-01-03**: 调用 `createDefaultLocalizationTable()` 作为规则表
- [x] **LOC-01-04**: localization 禁用时传递 `undefined`，保持向后兼容

### LOC-02: 两种汉化模式支持 ✅

- [x] **LOC-02-01**: 新增 `zh-only` 模式别名，语义为"仅中文"（替换英文原文）
- [x] **LOC-02-02**: `append` 模式保持"中英双语"（原文 + `[中文翻译]` 追加）
- [x] **LOC-02-03**: CLI 参数 `--localization-mode` 接受 `append` / `zh-only`
- [x] **LOC-02-04**: Config 类型 `ClangdProxyLocalizationMode` 新增 `zh-only` 值
- [x] **LOC-02-05**: bridge.ts `getAdaptedTable()` 将 `zh-only` 映射为 rule 层 `replace` 模式
- [x] **LOC-02-06**: 控制面板 Proxy Tab 模式选择器标签更新（中英双语 / 仅中文）
- [x] **LOC-02-07**: 模式切换后提示用户重启 Proxy 生效

### LOC-03: 完善汉化规则 ✅

- [x] **LOC-03-01**: 新增 UE 常见诊断规则（虚函数覆盖未标记 override、隐式转换丢失精度等）
- [x] **LOC-03-02**: 规则总数从 22 条扩展至 30+ 条
- [x] **LOC-03-03**: 为新增规则添加单元测试

### LOC-04: 端到端验证 ✅

- [x] **LOC-04-01**: 编写集成测试验证 CLI args → LspBridge 的 localization 传递
- [x] **LOC-04-02**: 编写集成测试验证 append 模式下输出为"原文 + 翻译"
- [x] **LOC-04-03**: 编写集成测试验证 zh-only 模式下输出仅为翻译
- [x] **LOC-04-04**: 确认现有 498 个测试全部通过（无回归）

## v2 Requirements (future)

### 面板增强

- **CTRL-F1**: 面板支持快捷键绑定
- **CTRL-F2**: 面板支持自定义按钮排序
- **CTRL-F3**: 面板支持构建历史查看

## Out of Scope

| Feature | Reason |
|---------|--------|
| 替换现有状态栏 | 状态栏和控制面板互补，用户可同时使用 |
| 实时构建日志输出到面板 | 构建日志在 Output 通道更合适 |
| 面板增强（快捷键/排序/历史） | 推迟到 v2 |
| v1.2 原主题（汉化 58→150+） | 2026-07-04 主题变更，回归 v1.1 已交付范围 |
| Hover 内容汉化 | 2026-07-04 主题变更，回归 v1.1 已交付范围 |

## v1.2 Requirements

Requirements for milestone v1.2 (clangd 完善). Each maps to a roadmap phase.

### CLANGD-01: clangd 性能优化 (Phase 7)

- [ ] **CLANGD-01-01**: compile_commands.json 生成时间在大型 UE 工程（>5000 文件）< 5s
- [ ] **CLANGD-01-02**: preparse-includes 缓存命中率 > 80%（二次构建）
- [ ] **CLANGD-01-03**: 文件变更后增量扫描延迟 < 200ms
- [ ] **CLANGD-01-04**: vscode-clangd 与自研 LSP Proxy 协同不引入额外开销

### CLANGD-02: 代码理解增强 (Phase 8)

- [ ] **CLANGD-02-01**: UE 类型（TObjectPtr、TSubclassOf、FGameMode、UClass 等）补全正常
- [ ] **CLANGD-02-02**: include 路径自动补全（支持 `Public/`、`Private/`、`*.generated.h` 模式）
- [ ] **CLANGD-02-03**: 跳转定义穿透 `UPROPERTY()`、`UFUNCTION()` 宏到真实声明
- [ ] **CLANGD-02-04**: 引用搜索识别 `UCLASS` / `USTRUCT` 等反射注册宏

### CLANGD-03: 工具链集成 (Phase 9)

- [ ] **CLANGD-03-01**: 编辑器内点击源码文件 → VS Code 跳转对应行（编辑器双向通信）
- [ ] **CLANGD-03-02**: Hot Reload 后无需手动 reload Window，clangd 自动同步
- [ ] **CLANGD-03-03**: VS Code 内右键 UE 类型符号可一键在编辑器内定位
- [ ] **CLANGD-03-04**: 调试配置支持 attach 到 UE 进程（含断点映射）

### CLANGD-04: 诊断增强 (Phase 10)

- [ ] **CLANGD-04-01**: UE 编译错误（链接失败、模块缺失等）显示明确诊断 + 修复建议
- [ ] **CLANGD-04-02**: `UPROPERTY()` 宏缺失/类型错误提供 code action 快速修复
- [ ] **CLANGD-04-03**: Module 依赖错误（缺 `PublicDependencyModuleNames`）自动建议
- [ ] **CLANGD-04-04**: 用户可自定义本地规则表（外部 JSON 文件）

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| LOC-01-01 ~ LOC-01-04 | Phase 4 | ✅ Complete |
| LOC-02-01 ~ LOC-02-07 | Phase 5/6 | ✅ Complete |
| LOC-03-01 ~ LOC-03-03 | Phase 4 | ✅ Complete |
| LOC-04-01 ~ LOC-04-04 | Phase 6 | ✅ Complete |
| CLANGD-01-01 ~ CLANGD-01-04 | Phase 7 | ○ Re-scoped |
| CLANGD-02-01 ~ CLANGD-02-04 | Phase 8 | ○ Re-scoped |
| CLANGD-03-01 ~ CLANGD-03-04 | Phase 9 | ○ Re-scoped |
| CLANGD-04-01 ~ CLANGD-04-04 | Phase 10 | ○ Re-scoped |

**Coverage:**

- v1.1 requirements: 18 sub-items total — ✅ Complete
- v1.2 requirements: 16 sub-items across 4 categories (CLANGD-01/02/03/04) — pending discussion
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-07-01 (v1.1) and 2026-07-04 (v1.2 re-scoped)*
*Last updated: 2026-07-04 — v1.2 re-scoped from localization to clangd*
