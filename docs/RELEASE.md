# 发布指南

> VSCodeUEHelper 扩展的发布手册。**不引入 release-please / husky / GitHub Actions**(per D-03 用户拒选 CI/CD),CHANGELOG 手动维护,所有门禁靠开发者本地命令。
> 本指南受 [`.specify/memory/constitution.md`](../.specify/memory/constitution.md) 治理；产品边界（Windows-only）、验证门禁、依赖纪律、修订流程以宪法为准。

## 1. 发布前 Checklist

- [ ] 所有 PR 已 merge 到 `master` 分支
- [ ] `CHANGELOG.md`（手动维护,见 §2）更新 "Unreleased" 段到版本号段
- [ ] `package.json#version` bump（major / minor / patch, 遵循 semver,见 §3）
- [ ] **质量门禁（宪法 IV，按受影响范围）**
  - [ ] `npm run typecheck` 0 errors（宪法 IV 全量必跑）
  - [ ] `npm run lint` 0 errors（宪法 IV 全量必跑）
  - [ ] `npm run test:unit` 全绿（`npm test` 等价；宪法 IV 全量必跑）
  - [ ] `npm run build` 成功（生成 `out/extension.js` + `out/clangdProxy.js` + launcher）—— 涉及 package metadata / 打包 / 编译产物时必跑
  - [ ] `npm run package` 成功（生成 `.vsix` 文件）
  - [ ] 涉及 build / clangd 行为改动：在 Windows + Unreal 项目上跑烟雾场景；缺环境必须显式记录不可用，不得以脚手架 / 窄测试冒充交付
- [ ] `.vsix` 文件大小 < 5MB（Marketplace 限制）
- [ ] `.vsix` 中 0 命中源码（用 `unzip -l <file>.vsix | grep -E "src/|test/|tsconfig"` 验证）

## 2. CHANGELOG 手动维护

`CHANGELOG.md` 由 `RELEASE.md` owner 手动维护。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

仓库根已有 [`CHANGELOG.md`](../CHANGELOG.md)，由本指南 owner 按 Keep a Changelog 6 段（Added / Changed / Fixed / Removed / Deprecated / Security）维护。下例展示一段历史性的格式样本（Phase 1.x – 2.x 已合并，标记为历史以保留审计轨迹）：

```markdown
# Changelog

## [Unreleased]

## [0.7.0] - 2026-07-XX ←（历史样本：实际发布版本号按当前 §3 决定）

### Added

- Phase 2.3: CONTRIBUTING.md / DEBUG.md / RELEASE.md / 3 份 ADR / 4 份 design doc
- Phase 2.1: `src/core/result.ts` + `src/core/errors.ts` 基础设施
- Phase 2.1: 8 模块 AGENTS.md 文件列表同步

### Changed

- Phase 2.1: ESLint `no-explicit-any` 升 error
- Phase 2.1: 5 模块 AGENTS.md 补 13 个缺失条目
- Phase 2.2: 新增 `Result<T, E>` + `E_*` 错误码体系

### Fixed

- Phase 1.x: 修 Windows 路径分隔符 + activateClangd 早退(`ueLinkManager` 完整可用)
- Phase 2.x: 修 i18n 注释示例与 `args: any[]` 不一致

## [0.6.0] - 2026-07-22

### Added

- Phase 1.1: AGENTS.md 仓库陷阱 #1/#2/#7/#10 校准
```

**原则**:

- Added / Changed / Fixed / Removed / Deprecated / Security 6 段（Keep a Changelog 标准）
- 每个 PR 触发时在 "Unreleased" 段补一行（同 Phase 集中,不必每 PR 单独写）
- 发布时把 "Unreleased" 内容剪到新版本号段

## 3. version bump

`package.json#version` 改版本号。规则(遵循 semver 2.0):

| 级别      | 触发                       | 例子                                                  |
| --------- | -------------------------- | ----------------------------------------------------- |
| **major** | 破坏性 API 变更 / 重新设计 | Phase 4 god 文件拆分会动 public exports,需 major bump |
| **minor** | 新功能 / 新命令            | Phase 5 Live Coding AI 集成是 minor                   |
| **patch** | bug 修复 / 文档 / 工具链   | Phase 2 全部文档 + ADR 是 patch                       |

> **历史说明**：仓库当前 `package.json#version = "0.1.0"`。早期规划中"Phase 2 完成后建议 bump 到 `0.2.0`"是 Phase 2 文档整理时的前瞻建议，已被多次 0.1.x 迭代与宪法 IV 验证门禁实践取代；本行保留作历史规划记录。具体版本号由当前 maintainer 按本节 semver 表与宪法 §Governance 决定。

## 4. vsce package

```bash
npm run package
# 输出: vscode-ue-helper-<version>.vsix
```

`.vscodeignore` 已排除 30+ 项(见文件),打包后仅:

- `out/extension.js` (主入口)
- `out/clangdProxy.js` (proxy CLI)
- `out/launcher/proxy-launcher.{bat,sh}` (启动器)
- `resources/icon.png` (扩展图标)
- `package.json` + `[Content_Types].xml` + `extension.vsixmanifest` (VSIX 元数据)

验证 .vsix 内容(本地):

```bash
unzip -l vscode-ue-helper-<version>.vsix | head -30
# 期望: 仅上述文件
```

## 5. Marketplace 提交

```bash
npx vsce login <publisher>
npx vsce publish
# 或: npx vsce publish -p <version> (指定版本)
```

**首次发布**: 在 https://marketplace.visualstudio.com/manage 创建 publisher,获取 Personal Access Token。

**自动 .vsceignore 校验**: `vsce` 工具会自动拒绝 .vsix 中包含源码/敏感文件(若 .vscodeignore 配置不当),不必手验。

## 6. 回滚流程

如果发布后 Marketplace 用户报告严重问题:

1. 立即在 GitHub revert release commit
2. bump patch 版本号(如 `0.7.0` → `0.7.1`)
3. 重跑 `npm run package` + `npx vsce publish` 发布修复版
4. 在 GitHub issue 标记 "已修复 + 版本号" + 引用新版本

> **不要**直接 `unpublish`(Marketplace 政策,unpublish 后 24h 内不能再 publish,且 user 端有缓存)。

**完全回滚(紧急)**: 若需撤回特定版本,只能用 `vsce update --target` + 新发布覆盖,不能删除。

## 7. 发布后验证

- [ ] Marketplace 页面可访问 + 版本号正确(https://marketplace.visualstudio.com/items?itemName=<publisher>.<name>)
- [ ] 在 VS Code 里 "Extensions" 搜扩展名能搜到
- [ ] "更新" 后能升级到新版本(测本机旧版)
- [ ] 5min 内无 Marketplace 审核拒绝邮件
- [ ] CHANGELOG.md 在新版本号段已填充完整
- [ ] GitHub release tag 已创建(`git tag v0.7.0 && git push --tags`)

## 8. 发布后跟进

- 监控 GitHub Issues 1 周，优先响应 P0/P1
- 在 [`CHANGELOG.md`](../CHANGELOG.md) 新版本号段核实"已知问题 / 已修复"与 GitHub Issues 对齐
- 若有 breaking change，在 README + AGENTS.md 显眼处标注
