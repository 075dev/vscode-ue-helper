# Phase 5: Localization Mode Enhancement - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Add `zh-only` (仅中文) localization mode alongside existing `append` (中英双语) mode. The new mode replaces English diagnostic text with Chinese translations only, while `append` retains the original English with Chinese appended.

Scope: CLI args, config types, bridge mode mapping. **No UI changes** — control panel updates are Phase 6 (LOC-02-06, LOC-02-07).

</domain>

<decisions>
## Implementation Decisions

### zh-only 策略
- **D-01:** `zh-only` 替换 `override` — CLI 参数、配置类型、UI 统一使用 `zh-only` 作为 replace 模式的用户可见名称。
- **D-02:** 向后兼容处理：旧配置中 `override` 值在读取时自动映射为 `zh-only`，不破坏现有工作区配置。

### 面板范围
- **D-03:** Phase 5 不涉及控制面板修改。纯 CLI + 配置类型 + bridge 层改动。面板标签更新（LOC-02-06）和重启提示（LOC-02-07）留给 Phase 6。

### Claude's Discretion
- 具体的 CLI 参数解析逻辑实现方式
- 配置迁移/向后兼容的具体实现
- 测试策略（单元测试覆盖新 mode 值）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Source Files
- `src/clangd/proxy/cliArgs.ts` — `CliOptions.localizationMode` 类型需要从 `'append' | 'override'` 改为 `'append' | 'zh-only'`
- `src/clangd/proxy/cliArgs.ts` — `parseArgs()` 中 `--localization-mode` 的接受值需要更新
- `src/clangd/proxy/bridge.ts` — `LocalizationOptions.mode` 类型需要更新；`getAdaptedTable()` 的映射逻辑（`override → replace` 改为 `zh-only → replace`）
- `src/clangd/proxy/localization.ts` — `RuleMode` 类型（`'append' | 'replace'`）无需修改
- `src/core/config.ts` — `ClangdProxyLocalizationMode` 类型需要更新
- `src/clangd/proxyManager.ts` — 读取配置并传递给 CLI 的地方需要更新
- `package.json` — `vscodeUEHelper.clangdProxy.localization.mode` 配置枚举值需要更新

### Requirements
- `.planning/REQUIREMENTS.md` §LOC-02-01 ~ LOC-02-05

### Prior Context
- `.planning/phases/04-cli-fix-rule-expansion/04-CONTEXT.md` — Phase 4 的决策（D-01~D-06）
- `.planning/phases/04-cli-fix-rule-expansion/04-SUMMARY.md` — Phase 4 实现总结

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Type Constraints
- `cliArgs.ts:25` — `localizationMode: 'append' | 'override'`
- `cliArgs.ts:118` — `parseArgs` 只接受 `'append' | 'override'`
- `bridge.ts:61` — `LocalizationOptions.mode: 'append' | 'override'`
- `bridge.ts:348-353` — `getAdaptedTable()` 将 `override` 映射为 `replace`，`append` 映射为 `append`
- `config.ts:60` — `ClangdProxyLocalizationMode = "append" | "override"`
- `package.json` — `enum: ["append", "override"]`

### Phase 4 Changes Already Applied
- `cli.ts` 现在已通过 Phase 4 将 `LocalizationOptions` 传入 `LspBridge`
- `localization.ts` 有 30 条规则

### Integration Points
- `proxyManager.ts:89` — 读取 `config.clangdProxyLocalizationMode` 传给 CLI
- `controlPanel.ts:162,277` — 读取/显示 localizationMode（Phase 6 处理 UI）

</code_context>

<specifics>
## Specific Ideas

- `zh-only` 替换 `override` 后，CLI 参数 `--localization-mode` 接受 `append` | `zh-only`
- bridge.ts `getAdaptedTable()` 中 `zh-only → replace` 映射与之前的 `override → replace` 逻辑相同
- 配置向后兼容：读取到旧的 `override` 值时，自动转换为 `zh-only`
- 所有现有测试应继续通过（`override` 相关测试更新为 `zh-only`）

</specifics>

<deferred>
## Deferred Ideas

- 控制面板标签更新（LOC-02-06）— Phase 6
- 模式切换重启提示（LOC-02-07）— Phase 6

</deferred>

---

*Phase: 5-Localization Mode Enhancement*
*Context gathered: 2026-07-01*
