# Requirements: VSCode UE Helper — 插件工程化与打包规范化

**Defined:** 2026-07-05 (v1.3 new milestone)
**Core Value:** UE 开发者可以在 VS Code 中完成所有日常开发操作，无需切换到 Rider 或 Visual Studio。

## v1.3 Requirements

### PKG — 打包元数据修复

- [ ] **PKG-01**: 仓库根目录存在 `LICENSE` 文件，内容为 MIT 全文（保留版权声明）
- [ ] **PKG-02**: `package.json` 包含 `repository` 字段（URL 占位，用户后续替换为真实仓库地址）
- [ ] **PKG-03**: `npm run package` 自动清理 `out/src/` 和 `out/test/` 残留目录（esbuild 旧配置产物）；可通过在 package script 中加 `prebuild`/`prepackage` 步骤实现
- [ ] **PKG-04**: 生成的 `.vsix` 不包含 `*.map` 文件（通过 `.vscodeignore` 加 `*.map` 实现）

### STR — 目录结构规范化

- [ ] **STR-01**: 仓库根目录不再存在 `temp_writer.js`、`temp_writer.mjs`、`ANALYSIS_detection_build.md` 三个临时/空文件
- [ ] **STR-02**: `.vscodeignore` 中仅保留项目实际使用的工具目录（`.omo/.codewiki/.hermes`）；不存在的目录规则需移除（需调查确认）

### 验收标准

- [ ] **VAL-01**: `npm run package` 输出 0 个 WARNING
- [ ] **VAL-02**: `.vsix` 文件大小 < 2MB
- [ ] **VAL-03**: `.vsix` 在 VS Code Extension Development Host 安装并激活成功（`F5` 启动后状态栏出现）
- [ ] **VAL-04**: `npm run typecheck`、`npm run lint`、`npm run test:unit` 全部通过（无回归）

## v1.2 Requirements (Parked — v1.3 ship 后继续)

> Phase 7 已完成 context 收集（`.planning/phases/07-clangd-performance-optimization/07-CONTEXT.md` 已恢复）。
> Phase 8-10 待 v1.3 完成后继续。

- [ ] **CLANGD-01**: clangd 性能优化 — compile_commands.json 生成加速、preparse-includes 缓存、增量扫描
- [ ] **CLANGD-02**: 代码理解与导航增强 — UE 类型补全、include 路径补全、跳转定义穿透 UPROPERTY/UFUNCTION
- [ ] **CLANGD-03**: 与 UE 编辑器/UBT 工具链集成 — 双向通信、Hot Reload 自动同步、调试 attach、断点映射
- [ ] **CLANGD-04**: 自定义诊断与快速修复 — UE 编译错误智能诊断、UPROPERTY 错误 code action、Module 依赖建议

## v1.1 Requirements (已交付 ✅)

> 完整交付清单见 git history。摘要：LOC-01 (CLI 传递 localization) / LOC-02 (双模式 zh-only/append) / LOC-03 (规则扩展 22→30+) / LOC-04 (E2E 验证)

## v2 Requirements (future)

### 面板增强

- **CTRL-F1**: 面板支持快捷键绑定
- **CTRL-F2**: 面板支持自定义按钮排序
- **CTRL-F3**: 面板支持构建历史查看

### 工程化（v1.3 显式不做，候选 v2）

- **CICD-01**: 引入 husky + lint-staged + commitlint
- **CICD-02**: 引入 release-it 或 standard-version 自动 bump version + update CHANGELOG
- **CICD-03**: GitHub Actions CI（typecheck + lint + test + package）

## Out of Scope

| Feature | Reason |
|---------|--------|
| 替换现有的状态栏 UI | 状态栏和控制面板共存互补 |
| 实时构建日志输出到面板 | 构建日志在 Output 通道更合适 |
| 合并 `doc/` 和 `docs/` | 用户决定保留两个目录 |
| 修改 `package.json` 版本号（v1.3） | 用户决定暂不动 |
| 加 release 脚本 / pre-commit 钩子（v1.3） | 推迟到 v2 |
| **v1.2 已废弃**: Diagnostics 规则表 58→150+、Hover 内容汉化 | 回归 v1.1 已覆盖范围 |

## Traceability

| REQ-ID | Phase | Notes |
|--------|-------|-------|
| PKG-01 | Phase 11 | LICENSE 文件新增 |
| PKG-02 | Phase 11 | package.json 字段 |
| PKG-03 | Phase 11 | esbuild / npm script 改造 |
| PKG-04 | Phase 11 | .vscodeignore 修改 |
| STR-01 | Phase 12 | 根目录清理 |
| STR-02 | Phase 12 | .vscodeignore 调查 |
| VAL-01~04 | Phase 12 | 最终验证 |

---

*Last updated: 2026-07-05 — v1.3 milestone defined*