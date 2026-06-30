# Phase 4: CLI Fix + Rule Expansion - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Two independent but sequential tasks:

1. **CLI Fix**: `cli.ts` parses `--localization-*` CLI args via `parseArgs()` but never passes the parsed `LocalizationOptions` to `LspBridge`. The bridge already has full support — it's just never wired up. Fix scope: ~10 lines in `cli.ts:runProxy()`.

2. **Rule Expansion**: Extend the default localization rule table from 22 rules to 30+ rules, adding UE-specific C++ diagnostic patterns.

</domain>

<decisions>
## Implementation Decisions

### CLI 修复方式
- **D-01:** 在 `cli.ts` 的 `runProxy()` 中构造 `LocalizationOptions` 对象，调用 `createDefaultLocalizationTable()` 获取规则表，传入 `LspBridge` 构造函数。
- **D-02:** 改动范围最小化 — 仅修改 `cli.ts`，不修改 `bridge.ts` 或 `localization.ts` 的接口逻辑。

### 规则扩展方向
- **D-03:** 混合覆盖策略 — 以 UE 常见编译错误为主（~6 条），clangd 特有消息为辅（~2 条），达到 30+ 规则目标。
- **D-04:** 以下 7 条规则全部纳入（优先级从高到低）:
  1. `override` 遗漏 — "overriding 'X' must have 'override' specifier"
  2. 隐式转换丢失精度 — "cast from 'T' to 'U' loses precision"
  3. 调用保护构造函数 — "calling a protected constructor of class 'X'"
  4. 返回类型不匹配 — "return type of selected overload is 'T' but expected 'U'"
  5. 模板实例化不匹配 — "explicit instantiation of 'T' does not refer to a function template"
  6. 取临时对象地址 — "taking address of a temporary"
  7. 已弃用 API — "'X' is deprecated"

### 测试策略
- **D-05:** 新增规则测试追加到现有 `test/unit/clangd/proxy/localization.test.ts`，不创建独立测试文件。
- **D-06:** 每条新规则至少包含一个匹配/替换的单元测试用例。

### Claude's Discretion
- 规则的具体正则表达式和中文翻译文本 — 按现有格式风格处理
- CLI 修复中 `localizationEnabled=false` 时的处理 — 传递 `undefined` 保持向后兼容

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Source Files (read for context)
- `src/clangd/proxy/cli.ts` — CLI 入口，`runProxy()` 需要修改来传递 LocalizationOptions
- `src/clangd/proxy/bridge.ts` — `LspBridge` 构造函数和 `LocalizationOptions` 接口定义
- `src/clangd/proxy/localization.ts` — 规则表引擎，`createDefaultLocalizationTable()` 需要添加新规则
- `src/clangd/proxy/cliArgs.ts` — `CliOptions` 定义包含 `localizationEnabled/mode/targets`

### Test Files
- `test/unit/clangd/proxy/localization.test.ts` — 现有规则测试（追加新规则测试）
- `test/unit/clangd/proxy/bridgeLocalization.test.ts` — bridge 层本地化测试
- `test/unit/clangd/proxy/cli.test.ts` — CLI 测试（需要验证 localization 传入）

### Requirements & Planning
- `.planning/REQUIREMENTS.md` — LOC-01 (CLI 传递), LOC-03 (规则扩展)
- `.planning/ROADMAP.md` §Phase 4 — 成功标准和要求映射
- `.planning/STATE.md` — 当前里程碑状态

</canonical_refs>

<code_context>
## Existing Code Insights

### Key Bug Location
- `cli.ts:139-149` — `LspBridge` 构造函数调用处，缺少 `localization` 选项
- `cli.ts:82` — `parseArgs(argv)` 已返回包含 `localizationEnabled/mode/targets` 的 `options`

### Reusable Assets
- `localization.ts:createDefaultLocalizationTable()` — 返回 22 条默认规则，可直接传入 `LspBridge`
- `bridge.ts:LocalizationOptions` — 接口已定义 `enabled/mode/targets/table` 字段
- `bridge.ts:getAdaptedTable()` — 已将 `override` 映射为 rule 层 `replace` 模式（无需修改）

### Established Patterns
- 规则采用 `pattern`（正则）+ `replacement`（支持捕获组）+ `mode`（append/replace）+ `target` 结构
- 所有规则默认 `append` 模式，同时应用于 `diagnostics/codeActions/hover`
- 测试使用纯字符串匹配验证（无 mock 依赖）

### Integration Points
- `cli.ts → bridge.ts`: 需将 `LocalizationOptions` 传入 `LspBridge` 构造函数的第二个参数
- `cli.ts → localization.ts`: 直接调用 `createDefaultLocalizationTable()` 获取规则表

</code_context>

<specifics>
## Specific Ideas

- CLI 修复的测试场景：传递 `--localization-enabled` 时构造 `LocalizationOptions`；不传时 `undefined`（向后兼容）
- 新规则遵循现有格式：使用非捕获组、支持 `'...'` 包裹的标识符引用
- 规则中文翻译风格：保持 `[翻译文本]` 方括号格式，与现有 22 条一致

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 4-CLI Fix + Rule Expansion*
*Context gathered: 2026-07-01*
