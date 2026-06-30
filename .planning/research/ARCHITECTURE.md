# Architecture: clangd Proxy Localization Enhancement

**Domain:** clangd LSP Proxy local diagnostics/codeActions/hover localization
**Researched:** 2026-07-01
**Mode:** Project-specific (existing codebase integration)
**Confidence:** HIGH

## Existing Architecture (as-shipped v1.0)

The bug is that `cli.ts` constructs `LspBridge` without passing the `localization` option, even though `cliArgs.ts` correctly parses `--localization-*` flags into `CliOptions`.

### Layer Diagram

```
Config Sources (VS Code settings / CLI flags)
        |
        v
  cliArgs.ts parseArgs()
        |
        v
  CliOptions { localizationEnabled, localizationMode, localizationTargets, ... }
        |
        v  (BUG: these 3 fields are read but never used)
  cli.ts runProxy()
        |
        +---> ProcessBridge (no localization involvement)
        |
        +---> LspBridge(processBridge, {
                  keepaliveMax,
                  keepaliveTtlSec,
                  hooks: { onServerResponse: ... }
                  // NO localization field -- the bug
                })
        |
        v
  LspBridge (bridge.ts)
     - stores this.localization: LocalizationOptions | undefined
     - all localization methods check this.localization?.enabled first
     - never enabled because never passed from CLI layer
```

### Key Observations

1. **`CliOptions` has the parsed data**, but `cli.ts` only extracts `keepaliveMax`, `keepaliveTtlSec`, and `realClangd`/`realClangdArgs` for ProcessBridge. The `localizationEnabled`, `localizationMode`, and `localizationTargets` fields are read by nobody in `cli.ts`.

2. **`LspBridge` already accepts `localization?: LocalizationOptions`** and has full plumbing: `localizeDiagnosticsNotification`, `localizeCodeActionResult`, `localizeHoverResult`, plus `getAdaptedTable()` which maps bridge `mode` ('append'|'override') to rule `mode` ('append'|'replace').

3. **`createDefaultLocalizationTable()` exists** but is never called from `cli.ts`. It's exported from `localization.ts` and available.

### Data Flow: CLI layer to Bridge layer

The mode mapping is already correct in `getAdaptedTable()`:

```
CLI --localization-mode append  -->  bridge opts mode 'append'  -->  rule mode 'append'   (原文+翻译)
CLI --localization-mode override -->  bridge opts mode 'override' -->  rule mode 'replace' (仅翻译)
```

No changes needed in `bridge.ts` -- the plumbing works once the data arrives.

## Integration Point: cli.ts (the fix)

**File:** `src/clangd/proxy/cli.ts` lines 137-149

### What to Change

Replace the current LspBridge construction:

```typescript
// BEFORE (lines 139-149):
const bridge = new LspBridge(processBridge, {
  keepaliveMax: options.keepaliveMax,
  keepaliveTtlSec: options.keepaliveTtlSec,
  hooks: {
    onServerResponse: (msg, method) => {
      if (method === 'initialize' && msg.error === undefined) {
        initializeCompleted = true;
      }
    },
  },
});

// AFTER:
const bridge = new LspBridge(processBridge, {
  keepaliveMax: options.keepaliveMax,
  keepaliveTtlSec: options.keepaliveTtlSec,
  hooks: {
    onServerResponse: (msg, method) => {
      if (method === 'initialize' && msg.error === undefined) {
        initializeCompleted = true;
      }
    },
  },
  localization: options.localizationEnabled
    ? {
        enabled: true,
        mode: options.localizationMode,     // 'append' | 'override'
        targets: options.localizationTargets, // string[]
        table: createDefaultLocalizationTable(),
      }
    : undefined,
});
```

### Required Imports

Add to the existing imports in `cli.ts`:

```typescript
import { createDefaultLocalizationTable } from './localization';
```

### What This Fixes

- `localization.enabled` = `true` so `localizeDiagnosticsNotification` and `applyLocalizationToResponse` pass their guard checks
- `localization.mode` = whatever the CLI flag says (`'append'` or `'override'`)
- `localization.targets` = parsed from `--localization-targets` (default: `['diagnostics', 'codeActions', 'hover']`)
- `localization.table` = the 22-rule default table

## Mode Semantics

The `mode` field carries through two layers with consistent semantics:

| Layer | Field | Values | Meaning |
|-------|-------|--------|---------|
| CLI args | `CliOptions.localizationMode` | `'append'` | 原文+翻译 |
| CLI args | `CliOptions.localizationMode` | `'override'` | 仅翻译 |
| Bridge opts | `LocalizationOptions.mode` | `'append'` | 原文+翻译 |
| Bridge opts | `LocalizationOptions.mode` | `'override'` | 仅翻译 |
| Rule engine | `LocalizationRule.mode` | `'append'` | 原文+翻译 (via `getAdaptedTable()`) |
| Rule engine | `LocalizationRule.mode` | `'replace'` | 仅翻译 (via `getAdaptedTable()`) |

The bridge's `getAdaptedTable()` (line 347-355 in bridge.ts) already maps `'override'` to `'replace'`:

```typescript
private getAdaptedTable(): LocalizationTable {
  const loc = this.localization;
  if (!loc) { return { rules: [] }; }
  const ruleMode: RuleMode = loc.mode === 'override' ? 'replace' : 'append';
  return {
    rules: loc.table.rules.map((r) => ({ ...r, mode: ruleMode })),
  };
}
```

**No changes needed in `getAdaptedTable()`** -- the mode mapping is correct.

## LOC-02: "仅中文" Mode Support

### Current State

The `append` mode keeps the original English and appends the Chinese translation in brackets:
```
no matching function for call to 'Foo' [没有匹配的 function 可调用 'Foo']
```

The `override` mode (via `--localization-mode override`) replaces entirely:
```
[没有匹配的 function 可调用 'Foo']
```

### What LOC-02 Asks For

A "仅中文" mode that shows Chinese-only output. This is **already** what `--localization-mode override` provides.

### Verification That It Works

The `override` mode in `bridge.ts` flows through `getAdaptedTable()` which maps it to `'replace'` in the rule engine. The rule engine's `'replace'` mode (localization.ts line 298-299) does:

```typescript
if (rule.mode === 'replace') {
  result = result.replace(regex, rule.replacement);
}
```

This replaces the matched English text with only the Chinese translation. **LOC-02 is already implemented** -- it just needs the CLI config to be wired through (LOC-01 fix enables it).

### Possible Enhancement: Rename for Clarity

If the `--localization-mode` flag values are confusing, consider renaming the CLI-level enum:

| CLI Value | Bridge Value | Rule Value | Effect |
|-----------|-------------|------------|--------|
| `--localization-mode append` | `'append'` | `'append'` | 中英双语 |
| `--localization-mode zh-only` | `'override'` | `'replace'` | 仅中文 |

This would require changing:
- `cliArgs.ts`: accept `'zh-only'` as valid, map it to `'override'` in the CliOptions
- `cliArgs.ts`: keep `'append'` as default for backward compatibility

Alternatively, keep `'override'` as the CLI value and document it. The question is DX, not architecture.

## LOC-03: Extended Rule Table

### Current State

22 rules across 7 categories. The template for `createDefaultLocalizationTable()` already has the structure. LOC-03 means adding more rules.

### Architecture for Adding Rules

Each rule is an object in the `rules` array:

```typescript
{
  pattern: "regex pattern string",
  replacement: "[translation with $1, $2 captures]",
  mode: 'append',       // or 'replace'
  target: ['diagnostics', 'codeActions', 'hover'],
}
```

### Suggested Additional Rules (common UE clangd messages)

Based on common Unreal Engine clangd diagnostics:

| Category | Pattern | Replacement |
|----------|---------|-------------|
| const qualifier | `"binding '(\\w+)' to (reference|value) of type '([^']+)' drops 'const' qualifier"` | `"[向类型 '$3' 的$2绑定 '$1' 丢失了 const 限定符]"` |
| virtual function | `"'([^']+)' overrides a member function but is not marked 'override'"` | `"['$1' 覆盖了成员函数但未标记 'override']"` |
| hidden virtual | `"'([^']+)' hides overloaded virtual function"` | `"['$1' 隐藏了重载的虚函数]"` |
| narrowing conversion | `"implicit conversion loses integer precision: '([^']+)' to '([^']+)'"` | `"[从 '$1' 到 '$2' 的隐式转换丢失整数精度]"` |
| unused variable | `"unused variable '([^']+)'"` | `"[未使用的变量 '$1']"` |
| unused parameter | `"unused parameter '([^']+)'"` | `"[未使用的参数 '$1']"` |
| deprecated | `"'([^']+)' is deprecated"` | `"['$1' 已弃用]"` |
| return type mismatch | `"return type of '([^']+)' is not identical to nor covariant with return type of '([^']+)'"` | `"[返回类型 '$1' 与 '$2' 的返回类型既不相同也不协变]"` |

These follow the existing pattern format and can be added to the `createDefaultLocalizationTable()` return array.

## LOC-04: End-to-End Verification

### Architecture of Verification

The verification chain is:

```
CLI args (--localization-enabled --localization-mode append --localization-targets diagnostics,codeActions,hover)
  --> cliArgs.ts parseArgs() --> CliOptions
  --> cli.ts LspBridge constructor --> LocalizationOptions
  --> bridge.ts processServerMessage()
      --> localizeDiagnosticsNotification() for textDocument/publishDiagnostics
      --> applyLocalizationToResponse() for codeAction/hover responses
  --> localization.ts applyRules() with regex matching
```

### Verification Strategy

1. **Unit test for cli.ts fix:** Create a test that calls `runProxy` with localization flags and verifies the bridge receives them. Use the `spawnFn` injectable to avoid actually spawning clangd.

2. **Integration test:** Feed a known clangd diagnostic through the bridge and check the output contains Chinese translation.

3. **Rule coverage test:** For each of the 22+ rules, verify that the pattern matches expected clangd output and produces correct Chinese output.

## Component Boundary Diagram

```
                     cli.ts
                   runProxy()
                  /         \
        parseArgs()       ProcessBridge
        (cliArgs.ts)        (processBridge.ts)
             |                    |
             v                    v
       CliOptions          ServerTransport
             |                    |
             v                    |
      +------+------+            |
      | localization |            |
      |  options?    |            |
      +------+------+            |
             |                    |
             v                    v
         LspBridge (bridge.ts)
             |
       +-----+------+
       |            |
   Server→Client   Client→Server
   Path            Path
       |            |
       v            v
   localization    keepalive
   (localization   (keepalive.ts)
    .ts)
       |
   createDefault
   LocalizationTable
       |
   22 rules (+ new)
```

## New vs. Modified Components

| File | Change Type | What |
|------|------------|------|
| `src/clangd/proxy/cli.ts` | **MODIFIED** | Pass `localization` to LspBridge constructor; add import |
| `src/clangd/proxy/cliArgs.ts` | **UNCHANGED** | Already parses all localization flags correctly |
| `src/clangd/proxy/bridge.ts` | **UNCHANGED** | Full localization plumbing exists, mode mapping correct |
| `src/clangd/proxy/localization.ts` | **MODIFIED** | Add 8+ new rules to `createDefaultLocalizationTable()` |
| `src/clangd/proxy/__tests__/cli.test.ts` | **NEW / MODIFIED** | Test that localization config flows through runProxy |

## Build Order

1. **LOC-01 (cli.ts fix):** Single-line change in `cli.ts` to pass localization. This is the highest-value fix and unblocks everything else.

2. **LOC-03 (rule expansion):** Add rules to `createDefaultLocalizationTable()`. Pure data addition, no logic change.

3. **LOC-04 (verification):** Write unit tests for the flow. Tests can use the injectable `spawnFn` and `io` parameters of `runProxy`.

4. **LOC-02 (mode verification):** Confirm `--localization-mode override` produces Chinese-only output. This is already architecturally complete -- just needs to be tested end-to-end after LOC-01.

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `createDefaultLocalizationTable()` creates a new table each call | None | None | Stateless, no memoization needed |
| Regex rules accidentally match partial words | Low | Medium | Pattern strings use word boundaries where needed, test against real clangd output |
| Mode name confusion ("override" vs "replace") | Medium | Low | Document clearly; optionally add `zh-only` alias |
| Hover content with complex markdown gets corrupted | Low | High | `applyLocalizationToHover` already protects code blocks; add more test cases |

## Sources

- `src/clangd/proxy/cli.ts` (lines 137-149) -- the bug location
- `src/clangd/proxy/bridge.ts` (lines 57-66, 326-355) -- LocalizationOptions type and getAdaptedTable()
- `src/clangd/proxy/cliArgs.ts` (lines 13-30, 111-130) -- CliOptions and flag parsing
- `src/clangd/proxy/localization.ts` (lines 75-259) -- createDefaultLocalizationTable() and rule engine
- `src/clangd/proxy/cliRuntime.ts` -- CliIo / CliStdio interfaces for test injection
- `.planning/PROJECT.md` -- milestone LOC-01 through LOC-04 requirements
