# Pitfalls Research — clangd Proxy Localization Bug Fix & Enhancement

**Domain:** VS Code extension + clangd LSP proxy localization
**Researched:** 2026-07-01
**Confidence:** HIGH (based on direct codebase analysis of 6 source files, 4 test files, and config)

## Critical Pitfalls

### Pitfall 1: CLI Layer Never Passes Localization Config to LspBridge (The Root Bug)

**What goes wrong:**
The `runProxy()` function in `cli.ts` parses `--localization-enabled`, `--localization-mode`, and `--localization-targets` from CLI args via `parseArgs()`, but never maps these parsed values into a `LocalizationOptions` object and never passes it to the `LspBridge` constructor. The bridge is created with only `keepaliveMax`, `keepaliveTtlSec`, and `hooks`:

```
// cli.ts lines 139-149 — CURRENT (broken):
const bridge = new LspBridge(processBridge, {
  keepaliveMax: options.keepaliveMax,
  keepaliveTtlSec: options.keepaliveTtlSec,
  hooks: { ... },
});
```

The `localization` property is simply absent. Since `LspBridge` defaults `this.localization` to `undefined` when not provided, ALL localization checks in `processServerMessage()` short-circuit at `if (!this.localization || !this.localization.enabled)` — meaning localization is **silently disabled** even when the user configures it.

**Why it happens:**
The `runProxy()` function was written before the localization feature was fully wired. The `parseArgs()` correctly extracts localization fields into `options`, but the bridge construction code was never updated to consume them. There is no TypeScript error because `localization` is optional on `LspBridgeOptions`.

**How to avoid:**
Map `options.localizationEnabled`, `options.localizationMode`, and `options.localizationTargets` into a `LocalizationOptions` object (including a `table` from `createDefaultLocalizationTable()`) and pass it to `LspBridge`:

```typescript
const bridge = new LspBridge(processBridge, {
  keepaliveMax: options.keepaliveMax,
  keepaliveTtlSec: options.keepaliveTtlSec,
  localization: options.localizationEnabled ? {
    enabled: true,
    mode: options.localizationMode,
    targets: options.localizationTargets,
    table: createDefaultLocalizationTable(),
  } : undefined,
  hooks: { ... },
});
```

**Warning signs:**
- All `--localization-*` CLI args are present in `parseArgs()` but never referenced after parsing in `runProxy()`
- Search for `options.localization` in `cli.ts` — it does not appear
- `runProxy()` returns no evidence that localization was configured (the `DoneClaim` does not mention localization)

**Phase to address:**
LOC-01 (current milestone). This is the primary bug to fix.

---

### Pitfall 2: No `createDefaultLocalizationTable()` Call in the CLI Flow

**What goes wrong:**
Even after fixing Pitfall 1 to pass `localization` to `LspBridge`, the `LocalizationOptions.table` field is required but never populated. The `cli.ts` file does not import or call `createDefaultLocalizationTable()`. The bridge requires `table: LocalizationTable` with at least a `rules` array — if undefined or empty, no rules would match and localization would produce no output.

**Why it happens:**
The `createDefaultLocalizationTable()` function exists in `localization.ts` and is tested in `localization.test.ts`, but the CLI entry point (`cli.ts`) never calls it. The `bridge.ts` `LocalizationOptions` interface makes `table` required (not optional), so TypeScript would enforce it at the call site — but since the call site currently doesn't pass localization at all, this is not caught.

**How to avoid:**
Import `createDefaultLocalizationTable` in `cli.ts` and call it when constructing the `localization` option. Alternatively, make the bridge auto-populate the default table when `enabled=true` but `table.rules` is empty — but explicit is better.

**Warning signs:**
- In `cli.ts`, search for `createDefaultLocalizationTable` — it is not imported
- No test verifies that localization rules exist when the bridge is constructed with localization enabled

**Phase to address:**
LOC-01 (current milestone) — must be fixed together with Pitfall 1.

---

### Pitfall 3: Mode Naming Seam — 'override' vs 'replace' Confusion

**What goes wrong:**
Three different layers use different terminology for the same concept:

| Layer | Type | Values |
|-------|------|--------|
| CLI/Config (`CliOptions`) | `localizationMode` | `'append' \| 'override'` |
| Bridge (`LocalizationOptions`) | `mode` | `'append' \| 'override'` |
| Rule engine (`LocalizationRule`) | `mode` | `'append' \| 'replace'` |

The bridge's `getAdaptedTable()` method (line 347) maps `'override'` to `'replace'`, but this is easy to bypass. If someone adds a new code path that directly passes the bridge's mode to the rule engine without going through `getAdaptedTable()`, the rule engine would receive `'override'` which it does not recognize — causing silent fallthrough (no replacement happens because `rule.mode === 'replace'` check fails).

**Why it happens:**
Historical evolution: the rule engine was built first with `'append' | 'replace'` semantics, then the CLI/bridge layer introduced `'override'` as a more user-friendly name. The mapping was added in `getAdaptedTable()` but the seam is fragile.

**How to avoid:**
- Unify the terminology across all layers. Either rename the CLI/bridge mode to `'replace'` (matching the rule engine), or rename the rule engine to `'override'`.
- Add a TypeScript type guard or branded type to prevent passing bridge-level modes to rule-level functions.
- Document the mapping clearly with a comment on `getAdaptedTable()`.

**Warning signs:**
- Any direct call to `applyRules()` or `applyLocalizationToDiagnostic()` that passes a mode string without going through `getAdaptedTable()`
- Mode comparison `rule.mode === 'override'` that never matches

**Phase to address:**
LOC-02 (current milestone) when adding the 'replace' (override) mode. This is the right time to fix the naming seam.

---

### Pitfall 4: `getAdaptedTable()` Flattens All Rules to the Same Mode

**What goes wrong:**
The `getAdaptedTable()` method (bridge.ts lines 347-355) creates a new table where EVERY rule is assigned the same mode:

```typescript
const ruleMode: RuleMode = loc.mode === 'override' ? 'replace' : 'append';
return {
  rules: loc.table.rules.map((r) => ({ ...r, mode: ruleMode })),
};
```

This means per-rule mode granularity is lost. If a user has customized their rules table with some rules in `'append'` mode and others in `'replace'` mode, the bridge overrides all of them with a single mode.

**Why it happens:**
The bridge-level mode is designed as a global setting (UI dropdown: "Append" vs "Override"), so the bridge maps it onto all rules uniformly. But the rule engine supports per-rule modes, creating a mismatch.

**How to avoid:**
- Document that the bridge-level mode overrides per-rule modes.
- If per-rule mode support is needed, remove the bridge-level mode and let rules specify their own mode.
- For now, ensure the default table has consistent mode across all rules (which it does — all 22 rules default to `'append'`).

**Warning signs:**
- A custom rule with `mode: 'replace'` being ignored because the bridge-level mode is `'append'`
- User confusion when a custom rule's mode doesn't take effect

**Phase to address:**
LOC-02 (current milestone). Consider whether per-rule mode is needed or if global mode is sufficient.

---

### Pitfall 5: Append Mode Cascading — Multiple Rule Matches on Same Text

**What goes wrong:**
In `applyRules()` (localization.ts lines 278-311), rules are applied sequentially in order. With append mode, each matching rule appends its translation to the result. If multiple rules match the same diagnostic text, the text accumulates multiple translations.

Example: A message like `"'Foo' is not a member of 'Bar'; no member named 'Baz' in 'Qux'"` matches both Rule 4 (`no member named`) and Rule 21 (`is not a member of`). The result would correctly translate each phrase, but the output length grows.

In most cases this is correct (each matched phrase gets its translation), but in append mode the result can become very long with repeated translations. In replace mode, the second rule's replacement would overwrite the first rule's replacement (since the first rule removed the original English text).

**Why it happens:**
The rule engine processes rules sequentially with `result = result.replace(regex, ...)`. In append mode, the original text is preserved, so subsequent rules can still match it. In replace mode, the original text is replaced, so subsequent rules may not find a match.

**How to avoid:**
- Design rules with non-overlapping patterns where possible
- Test edge cases where multiple rules could match the same message
- Consider a "first match wins" policy for replace mode
- Document that rule order matters

**Warning signs:**
- Diagnostics with unusually long localized messages (multiple appended translations)
- The same English phrase appearing multiple times in the output

**Phase to address:**
LOC-03 (current milestone) — rule coverage expansion. Add a test case for overlapping rule scenarios.

---

### Pitfall 6: Missing Integration Test for CLI-to-Bridge Localization Flow

**What goes wrong:**
There is no end-to-end test that verifies:
1. CLI args (`--localization-enabled`, `--localization-mode`, etc.) are parsed
2. The parsed values are passed to `LspBridge`
3. `LspBridge` applies localization to server responses
4. Localized messages are sent to the client

Currently:
- `cli.test.ts` tests `parseArgs()` but NOT `runProxy()` with localization args
- `bridge.test.ts` tests `LspBridge` but WITHOUT localization options
- `localization.test.ts` tests rule application in isolation
- `proxyManager.test.ts` tests the VS Code extension side, not the CLI side

This means the full data flow (VS Code config to proxy CLI args to bridge to localized output) has zero automated verification.

**Why it happens:**
The localization feature was added incrementally. Each layer was tested in isolation, but the integration seam (CLI to bridge) was never tested because the bug (Pitfall 1) meant it was never actually wired.

**How to avoid:**
- Add a `runProxy` integration test that uses fake stdio, passes localization args, and verifies that a `textDocument/publishDiagnostics` notification from the fake clangd gets localized before reaching the client output.
- The test infrastructure already exists: `FakeTransport` in bridge.test.ts, `CliIo`/`CliStdio` interfaces in cliRuntime.ts.

**Warning signs:**
- No test file imports both `runProxy` and `LspBridge` together
- grep for `localization` in `cli.test.ts` returns only `parseArgs` tests, not `runProxy` tests

**Phase to address:**
LOC-04 (current milestone) — end-to-end verification. Must write this test.

---

### Pitfall 7: Localization Mode Change Requires Proxy Restart (No Hot-Reload)

**What goes wrong:**
The localization mode (`append` vs `override`) is set at `LspBridge` construction time via CLI args. Changing the mode in VS Code settings (which updates `clangdProxy.localization.mode`) does NOT take effect until the proxy process is restarted. The user might toggle the mode in the control panel and expect immediate results, but nothing changes.

**Why it happens:**
The proxy runs as a separate Node.js process launched by the launcher script. It reads its configuration once at startup via CLI args. There is no mechanism to dynamically update the `LspBridge.localization` property at runtime.

**How to avoid:**
- Add a status indicator in the control panel showing "Restart required" when localization settings change
- Consider adding a `workspace/didChangeConfiguration` forwarding mechanism (LSP extension) to pass config updates to the proxy process
- Document the restart requirement in the UI and i18n strings

**Warning signs:**
- User toggles localization mode but sees no change in diagnostics
- Control panel shows the new mode but diagnostics still use the old mode

**Phase to address:**
Current milestone (LOC-02) — add UI hint. A full hot-reload mechanism would be a future enhancement.

---

### Pitfall 8: ProxyManager.buildProxyArgs Does Not Pass Localization Table to CLI

**What goes wrong:**
`proxyManager.ts` `buildProxyArgs()` (lines 168-192) builds the CLI arguments for the proxy launcher. When localization is enabled, it passes `--localization-enabled`, `--localization-mode`, and `--localization-targets`. But there is no `--localization-table` argument or any mechanism to pass the actual translation rules to the CLI.

The CLI's `cli.ts` then has no way to construct the `LocalizationOptions.table` because it never receives the rules. Even after fixing Pitfall 1 and 2 (adding `createDefaultLocalizationTable()` in cli.ts), the CLI will use the **hardcoded default rules** — there is no way for the VS Code extension to inject custom rules.

**Why it happens:**
The config schema (`Config` class) has no `clangdProxyLocalizationRules` property. The `createDefaultLocalizationTable()` is hardcoded in the proxy source. Custom rules would require either a config mechanism or a CLI arg for a rules file path.

**How to avoid:**
- For the current milestone: document that custom rules are not supported yet. The default 22 rules are hardcoded in the proxy binary.
- For future: add a `--localization-rules-file <path>` CLI arg that loads a JSON rules file. Add a corresponding VS Code config field.
- Validate in tests that the default table is used when no rules file is specified.

**Warning signs:**
- Any attempt to configure custom rules via VS Code settings would be silently ignored
- The `LocalizationTable` interface exists and is extensible, but there's no path for users to provide custom tables

**Phase to address:**
Current milestone — acknowledge the limitation. Future milestone to add custom rules support.

---

### Pitfall 9: No Validation of `--localization-targets` Values

**What goes wrong:**
The `parseArgs()` function accepts any comma-separated string for `--localization-targets`:

```typescript
case '--localization-targets': {
  i++;
  const val = proxyArgs[i];
  if (val !== undefined && val.length > 0) {
    options.localizationTargets = val.split(',').filter((t) => t.length > 0);
  }
  break;
}
```

Invalid values like `'diagnostic'` (missing 's'), `'codeaction'` (wrong case), or `'hover '` (trailing space) are accepted without error. The bridge's `targets.includes('diagnostics')` check would never match, so the feature would silently not work.

**Why it happens:**
The proxy CLI is designed to be resilient (no crashes on bad input), but the tradeoff is silent failures. The parseArgs function doesn't validate enum values for `--localization-targets`.

**How to avoid:**
- Add validation in `parseArgs()`: warn about unknown target values to stderr
- At the bridge level, log a warning when a target is configured but doesn't match any rule
- The VS Code extension side (`proxyManager.ts`) already uses valid enum values from `Config`, so this mainly affects manual CLI usage

**Warning signs:**
- User passes `--localization-targets diagnostic` (singular) and no diagnostics get translated
- No error message is shown — the feature silently under-functions

**Phase to address:**
Current milestone (LOC-03) — add validation in cliArgs.ts.

---

### Pitfall 10: Regex Rules May Match Non-Diagnostic Text in Hover/CodeAction

**What goes wrong:**
The localization rules use regex patterns designed for clangd diagnostic messages. When applied to hover content (which can contain arbitrary C++ code snippets) or code action titles (which may include code symbols), the regex might match text that is not actually a diagnostic message.

For example, a variable named `'no_matching_function'` or a code comment `// incomplete type 'Foo'` in hover content could be matched and incorrectly translated.

**Why it happens:**
The regex patterns are broad enough to match diagnostic-like patterns in non-diagnostic text. The hover function protects fenced code blocks (triple-backtick) and inline code spans (single backtick), but plain text outside these markers is still subject to rule matching.

**How to avoid:**
- Make regex patterns more specific where possible (e.g., anchor to known diagnostic prefixes)
- The existing code block protection in `applyLocalizationToHover()` handles the most common case
- For code actions, the title text is typically short and diagnostic-derived, so false matches are less likely
- Add test cases for hover content that contains diagnostic-like text in non-diagnostic contexts

**Warning signs:**
- C++ identifier names appearing in hover tooltips get translated
- Code action titles that include user-defined names get partially translated

**Phase to address:**
LOC-03 (current milestone) — add regression tests for false match scenarios.

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hardcoded 22 rules in source | No config file parsing needed | Users cannot add custom rules without rebuilding | Current milestone (MVP). Acceptable for v1.1 |
| 'override'/'replace' naming seam | User-friendly 'override' in UI | Future developer confusion, bugs in new code paths | Fix now (LOC-02) before the seam grows |
| No hot-reload for localization mode | Simple implementation | User must restart proxy to change mode | Current milestone with UI hint. Full hot-reload = future |
| All rules flattened to same mode by bridge | Simple bridge-level mode toggle | No per-rule mode granularity | Current milestone. All 22 rules use 'append' by default |
| No integration test for CLI to bridge flow | Faster initial delivery | Bug LOC-01 was undetected for multiple releases | Never acceptable — fix now |
| No target value validation | Simpler parseArgs code | Silent failures for typos | Acceptable for manual CLI use. Add validation in current milestone |

## Integration Gotchas

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| `cli.ts` to `LspBridge` constructor | Not passing `localization` option at all | Always pass `localization` with enabled/mode/targets/table |
| `bridge.ts` `getAdaptedTable()` | Directly passing bridge `mode` to rule engine | Always call `getAdaptedTable()` to map 'override' to 'replace' |
| `proxyManager.ts` `buildProxyArgs()` | Forgetting to pass `--localization-*` args | All 3 args must be present when enabled: `--localization-enabled`, `--localization-mode`, `--localization-targets` |
| VS Code Config to proxy CLI | Config value `'override'` must map to CLI arg `'override'` | The CLI accepts `'override'` — this is correct. Just ensure the mapping is maintained |
| CLI args to bridge mode | Assuming CLI mode string matches rule engine mode | CLI 'override' to bridge 'override' to getAdaptedTable maps to rule 'replace' |
| Hover code block protection | Applying rules before extracting code blocks | Always extract fenced blocks and inline spans FIRST, then apply rules, then restore |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Sequential regex on large hover content | Slow hover response for docs with many code blocks | The existing code block extraction is correct — only plain text is regex-matched | N/A at current scale. 22 regex rules on short diagnostic strings is negligible |
| `result.replace(regex, ...)` in append mode creates new string per rule | Multiple string allocations per diagnostic | 22 rules times ~200 char messages = negligible overhead | Not a concern. Diagnostics are short strings |
| `getAdaptedTable()` clones all rules on every bridge method call | Unnecessary object allocations | Memoize the adapted table, rebuild only when options change | At 100+ rules, clone overhead becomes measurable but still small |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Regex injection via `pattern` field in custom rules | If users can provide arbitrary regex patterns, a ReDoS could freeze the proxy | Sanitize or limit pattern complexity. Use `new RegExp(rule.pattern, 'g')` with a timeout wrapper. For current milestone, patterns are hardcoded — no user input |
| Appending user-controlled diagnostic text to output | XSS if output is rendered in HTML without escaping | Localization output is LSP text content (VS Code renders it safely). Not an XSS vector |
| Log file write failure fallback to stderr | None — stderr is the correct fallback | Already handled correctly in `createProxyLogFn()` |
| Placeholder collision in hover protection | If diagnostic text contains `\x00FENCED_BLOCK_0\x00`, it would be replaced with actual code block content | Extremely unlikely — null bytes don't appear in normal diagnostic output |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Mode change requires proxy restart | User toggles mode in control panel, sees no change | Add "Restart required" badge in UI, or add restart-proxy command |
| 'override' mode removes original English | Chinese-only users love it; bilingual users lose reference text | Keep 'append' as default. Document that 'override' replaces English entirely |
| Silent failure when localization targets misconfigured | User sets `--localization-targets diagnostic` (singular), nothing translates, no error | Validate target names in parseArgs and log warnings to stderr |
| No visual indicator that localization is active | User doesn't know if diagnostics are being translated | Status bar indicator in control panel already exists (`st-localization` element) — ensure it updates correctly |
| 22 rules may not cover all UE diagnostics | Some UE-specific errors remain untranslated | Document known coverage gap. Add community-contributed rules mechanism for future |

## "Looks Done But Isn't" Checklist

- [ ] **LOC-01 (CLI passes localization to bridge):** Verify that `runProxy()` actually passes `localization` to `LspBridge` — not just that `parseArgs()` returns correct values. Read `cli.ts` lines 139-149 and confirm `localization:` appears in the options object.
- [ ] **LOC-01 (Table is populated):** Verify that `createDefaultLocalizationTable()` is called and its result is assigned to `table` in the `LocalizationOptions`. Search for the import and call site in `cli.ts`.
- [ ] **LOC-02 (Override mode actually replaces):** Verify that `getAdaptedTable()` is called in ALL three localization paths (diagnostics, codeActions, hover). It should be — verify bridge.ts lines 378, 419, 461.
- [ ] **LOC-02 (Mode naming consistency):** Check that no new code path bypasses `getAdaptedTable()` and passes 'override' directly to the rule engine.
- [ ] **LOC-03 (New rules don't overlap):** Verify that new rules don't match substrings already matched by existing rules. Run all 22 test cases with combined messages.
- [ ] **LOC-04 (End-to-end test exists):** A test that creates `runProxy` with fake stdio, sends a `publishDiagnostics` notification from fake clangd, and verifies the client output contains localized text.
- [ ] **Hover code protection still works with new rules:** Run hover test cases with code blocks containing diagnostic-like text.
- [ ] **Proxy restart required indicator:** If localization settings change, the control panel should show a warning or the user should be prompted to restart.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Localization silently disabled (Pitfall 1) | HIGH (requires code fix + redeploy) | Add `localization` property to `LspBridge` constructor call in `cli.ts`. Import `createDefaultLocalizationTable()`. |
| No default table in CLI flow (Pitfall 2) | MEDIUM (add import + call) | Add `import { createDefaultLocalizationTable }` and call it when building `localization` option. |
| Wrong mode passed to rule engine (Pitfall 3) | LOW (fix type or mapping) | Add type guard, rename to unify, or ensure `getAdaptedTable()` is always used. |
| Append cascading produces long messages (Pitfall 5) | LOW (add dedup logic) | After all rules are applied, deduplicate repeated translation fragments. Or implement "first match wins" for append mode. |
| No integration test (Pitfall 6) | MEDIUM (write test) | Use existing `FakeTransport` pattern. Create fake stdio. Test full flow from CLI args to client output. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. CLI not passing localization to bridge | LOC-01 | Unit test: `runProxy` with localization args, verify bridge constructed with `localization` option |
| 2. No default table in CLI flow | LOC-01 | Unit test: verify `createDefaultLocalizationTable()` is called in CLI flow |
| 3. Mode naming seam (override vs replace) | LOC-02 | TypeScript compile check + test that 'override' CLI arg results in 'replace' at rule level |
| 4. getAdaptedTable flattens all rules | LOC-02 | Documented limitation. Verify default table rules all have same mode |
| 5. Append cascading on multiple matches | LOC-03 | Add test with overlapping rule patterns, verify output is reasonable |
| 6. No integration test for CLI to bridge flow | LOC-04 | Write integration test with fake stdio + fake clangd |
| 7. Mode change requires proxy restart | LOC-02 (UI hint) | Add "Restart required" status in control panel |
| 8. No custom rules support from VS Code | Current milestone | Document limitation. Future milestone for rules file support |
| 9. No validation of localization targets | LOC-03 | Add validation in `cliArgs.ts` for known target values |
| 10. Regex matches non-diagnostic text | LOC-03 | Add false-match regression tests for hover/code action content |

## Sources

- Direct codebase analysis: `cli.ts`, `cliArgs.ts`, `cliRuntime.ts`, `bridge.ts`, `localization.ts`, `status.ts`, `proxyManager.ts`
- Test file analysis: `cli.test.ts`, `bridge.test.ts`, `localization.test.ts`, `proxyManager.test.ts`
- Config schema: `src/core/config.ts` (localization config fields)
- UI messages: `src/ui/controlPanelMessages.ts` (localization UI mapping)
- PROJECT.md milestone requirements LOC-01 through LOC-04

---
*Pitfalls research for: clangd Proxy Localization Bug Fix & Enhancement*
*Researched: 2026-07-01*
