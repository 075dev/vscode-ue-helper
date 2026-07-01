# Phase 6: UI Update + E2E Verification - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Update control panel to reflect the new `zh-only` localization mode, add restart prompt on mode switch, and verify the full localization pipeline end-to-end with behavioral tests.

Scope: control panel UI (Proxy Tab), i18n labels, restart notification, behavioral test coverage.

</domain>

<decisions>
## Implementation Decisions

### 模式选择器标签
- **D-01:** 选项值为 `append` / `zh-only`，显示标签为:
  - `append` → "中英双语 / Bilingual"
  - `zh-only` → "仅中文 / Chinese Only"
- **D-02:** 更新 `controlPanelMessages.ts` 中 `PROXY_SELECTS.localizationMode` 的 label 和 value
- **D-03:** 更新 `controlPanel.html.ts` 中状态展示（第 449 行）的 `override` → `zh-only` 判断

### 重启提示方式
- **D-04:** 在面板内显示黄色提示条（非 VS Code 弹窗），告知需要重启 Proxy 才能生效
- **D-05:** 提示条包含: 警告图标 + 中文/英文提示文本 + 关闭按钮
- **D-06:** 监听 `configChanges` 响应中的 `localizationMode` 变更触发提示条

### 集成测试方式
- **D-07:** 在 `bridgeLocalization.test.ts` 中补充行为测试（非 e2eHarness），验证 append/zh-only 输出格式
- **D-08:** 覆盖场景：
  - append 模式输出 "原文 + [翻译]" 格式
  - zh-only 模式输出仅翻译文本
  - localization 禁用时无翻译输出（向后兼容）

### Claude's Discretion
- 提示条的具体 CSS 样式（黄色背景、内边距、动画等）
- i18n 键名和中文/英文文案
- 测试的具体 assert 细节

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Source Files
- `src/ui/controlPanelMessages.ts` — `PROXY_SELECTS.localizationMode` 的 label/value 需要更新
- `src/ui/controlPanel.html.ts` — 状态展示（`override` → `zh-only`）+ 重启提示条
- `src/ui/controlPanel.ts` — configChanges 处理（触发提示条）
- `src/i18n/locales/en.json` — 新增 i18n 键
- `src/i18n/locales/zh.json` — 新增 i18n 键

### Test Files
- `test/unit/clangd/proxy/bridgeLocalization.test.ts` — 新增 append/zh-only 行为测试

### Prior Context
- `.planning/phases/05-localization-mode-enhancement/05-CONTEXT.md` — zh-only 替换决策
- `.planning/phases/05-localization-mode-enhancement/05-SUMMARY.md` — Phase 5 实现总结

### Requirements
- `.planning/REQUIREMENTS.md` §LOC-02-06, LOC-02-07, LOC-04-01 ~ LOC-04-04

</canonical_refs>

<code_context>
## Existing Code Insights

### 当前控制面板状态
- `controlPanelMessages.ts:223-226` — `PROXY_SELECTS.localizationMode` 有 `{ value: 'append', label: 'Append' }` 和 `{ value: 'override', label: 'Override' }`
- `controlPanel.html.ts:449` — 状态展示行：`values.proxyLocalizationMode === 'override' ? 'Override' : 'Append'`
- `controlPanel.html.ts:258` — 渲染 localization 字段区域
- `controlPanel.ts:162` — 读取 `config.clangdProxyLocalizationMode`
- `controlPanel.ts:277` — 传递 `proxyLocalizationMode` 给面板
- `controlPanel.ts` — 已有 `configChanges` 消息处理

### i18n
- `en.json:173` — `"panel.field.localizationMode": "Localization Mode"`
- `zh.json:173` — `"panel.field.localizationMode": "汉化模式"`
- 需要新增提示条相关的 i18n 键

### 测试现状
- `bridgeLocalization.test.ts` — 已有测试验证 bridge 层本地化行为
- 需要新增测试验证 append/zh-only 输出格式

</code_context>

<specifics>
## Specific Ideas

- `controlPanelMessages.ts` 更新:
  ```ts
  localizationMode: [
    { value: 'append', label: '中英双语 / Bilingual' },
    { value: 'zh-only', label: '仅中文 / Chinese Only' },
  ],
  ```
- `controlPanel.html.ts` 状态展示更新:
  ```js
  const mode = values.proxyLocalizationMode === 'zh-only' ? '仅中文' : '中英双语';
  ```
- 提示条 HTML 结构:
  ```html
  <div id="proxy-restart-notice" class="warning-notice" style="display:none">
    ⚠ <span data-i18n="panel.notice.restartProxy">...</span>
    <button class="notice-close">✕</button>
  </div>
  ```

</specifics>

<deferred>
## Deferred Ideas

None — this is the final phase of v1.1.

</deferred>

---

*Phase: 6-UI Update + E2E Verification*
*Context gathered: 2026-07-01*
