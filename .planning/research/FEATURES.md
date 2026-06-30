# Feature Research: Clangd Proxy Localization Enhancement

**Domain:** VS Code extension / clangd LSP proxy -- diagnostic message localization for Chinese UE developers
**Researched:** 2026-07-01
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Diagnostic messages translated to Chinese | Rider and Visual Studio both provide localized C++ diagnostics; UE Chinese developers expect this | MEDIUM | 22 rules exist (7 original + 15 added); needs expansion to 30+ for adequate coverage |
| On/off toggle without side effects | Users expect configuration changes to not break clangd | LOW | Toggle updates VS Code settings; requires proxy restart to take effect -- must communicate this to user |
| Two output modes: bilingual and Chinese-only | Users at different Chinese literacy levels want different output styles | LOW | Both modes exist in code (`append` = bilingual, `override` = Chinese-only); just need CLI wiring fix (LOC-01) |
| Per-target control (diagnostics vs codeActions vs hover) | Users may want localization only on diagnostics, not on hover tooltips | LOW | Already wired through `localizationTargets` field in both CLI and UI |
| Localization status visible in control panel | Users need to confirm localization is active and see current mode/targets | LOW | Already built in Status tab showing mode + targets (lines 448-452 of controlPanel.html.ts) |
| Mode labels in Chinese for Chinese-speaking users | The control panel is used by Chinese developers; mode select should show "仅中文" not "override" | LOW | Current `PROXY_SELECTS` in `controlPanelMessages.ts` (line 223) uses raw `'append'`/`'override'` labels -- needs i18n key binding |
| Config changes persisted across VS Code restarts | Users expect settings to survive | LOW | Already handled -- all localization settings go through `Config.update()` to VS Code `settings.json` |

### Differentiators (Competitive Advantage)

Features that set the product apart. Not required, but valuable.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Hover content localization with code block protection | Preserves code fences and inline spans during translation -- prevents corrupted markdown | MEDIUM | Already implemented in `localization.ts` with placeholder-based isolation (lines 356-402) |
| Code action title localization without corrupting edits | Localizes quick-fix suggestion text without breaking the actual edit payload | MEDIUM | Already implemented in `bridge.ts` `localizeCodeActionResult()` (lines 413-447); only touches title/disabled.reason |
| RelatedInformation also localized | Related diagnostic notes (e.g., "see declaration of X") are also translated for full context | LOW | Already implemented in `bridge.ts` `localizeDiagnosticsNotification()` (lines 387-398) |
| No IDE restart required | Rider/VS require full IDE restart; proxy restart takes <1 second | HIGH | Proxy is a child process; `enable`/`disable` in the control panel restarts clangd in seconds |
| Zero-overhead when disabled | No performance cost when localization is off; bridge skips all processing | LOW | Already the case -- `localization` option omitted from `LspBridge` = no localization code path |
| Works with any clangd version | Rule-based pattern matching works regardless of clangd version | MEDIUM | Patterns may need updating across clangd versions, but the architecture is version-agnostic |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Full translation of all 400+ clangd diagnostic IDs | "Why isn't everything in Chinese?" | clangd diagnostic messages are not stable across versions; maintaining full coverage is unsustainable; messages are implicitly versioned by text, not IDs | Focus on the ~50 most common messages in UE development; support user extensibility for edge cases |
| Localization of code action edit/command payloads | "The fix should be in Chinese too" | Editing `CodeAction.edit` or `CodeAction.command` fields corrupts the LSP protocol contract and breaks the actual fix | Only localize user-visible strings (`title`, `disabled.reason`) as already done |
| Hot-swap localization mode without proxy restart | "I want to switch modes without interrupting my work" | LspBridge stores `LocalizationOptions` as `readonly`; adding mutation requires synchronization with in-flight LSP messages | Show clear UI note: "Settings take effect after proxy restart" |
| AI/LLM-based dynamic translation | "AI could translate more naturally and handle unknown messages" | Non-deterministic output, latency (hundreds of ms per diagnostic), privacy concerns (code sent to API), inconsistent between sessions | Keep rule-based: deterministic, sub-ms per message, private, auditable |
| Translation of ALL LSP diagnostics (not just clangd) | "Why limit to clangd?" | Other LSP servers (ESLint, Pyright, Rust Analyzer) have different message patterns, different protocol contracts | Stay scoped to clangd; other servers can add localization independently |
| User-customizable rules via CLI flags | "Let me add my own translations on the command line" | CLI flag parsing becomes complex, multi-line rules are unreadable in argv | Future: JSON config file or VS Code settings array (v1.2+) |

## Mode Semantics -- Detailed UX Specification

This section defines the exact behavior users should see, with examples.

### Mode 1: 中英双语 (Bilingual) -- maps to `append`

**Behavior:** Original English message is preserved, Chinese translation is appended in square brackets `[...]`.

**Technical path:** CLI `--localization-mode append` -> bridge `LocalizationOptions.mode = 'append'` -> rule engine `mode = 'append'`

**Examples:**

| Original clangd message | Displayed output |
|------------------------|------------------|
| `incomplete type 'T' named 'FMyStruct'` | `incomplete type 'T' named 'FMyStruct' [不完整的类型 'FMyStruct']` |
| `use of undeclared identifier 'SomeFunc'` | `use of undeclared identifier 'SomeFunc' [使用了未声明的标识符 'SomeFunc']` |
| `'FString' file not found` | `'FString' file not found [找不到文件 'FString']` |
| `no matching function for call to 'DoSomething'` | `no matching function for call to 'DoSomething' [没有匹配的 function 可调用 'DoSomething']` |
| `call to 'ProcessItem' is ambiguous` | `call to 'ProcessItem' is ambiguous [对 'ProcessItem' 的调用有歧义]` |

**Best for:** Developers learning UE terminology in English, or who want to cross-reference the original message for search engines/Stack Overflow.

### Mode 2: 仅中文 (Chinese Only) -- maps to `override` / `replace`

**Behavior:** Original English is entirely replaced by Chinese translation in square brackets.

**Technical path:** CLI `--localization-mode override` -> bridge `LocalizationOptions.mode = 'override'` -> rule engine `mode = 'replace'`

**Examples:**

| Original clangd message | Displayed output |
|------------------------|------------------|
| `incomplete type 'T' named 'FMyStruct'` | `[不完整的类型 'FMyStruct']` |
| `use of undeclared identifier 'SomeFunc'` | `[使用了未声明的标识符 'SomeFunc']` |
| `'FString' file not found` | `[找不到文件 'FString']` |
| `no matching function for call to 'DoSomething'` | `[没有匹配的 function 可调用 'DoSomething']` |
| `call to 'ProcessItem' is ambiguous` | `[对 'ProcessItem' 的调用有歧义]` |

**Best for:** Developers comfortable with UE Chinese terminology who want clean, uncluttered output.

### What Happens When No Rule Matches

If a diagnostic message does not match any rule in the table, it passes through entirely unmodified in both modes. This is correct behavior -- no false translations, no corruption.

### What Happens for Partial Matches

If a rule pattern matches only part of a message, only that portion is localized. The rest of the message passes through. Example with a hypothetical partial match:

```
Original: "use of undeclared identifier 'Foo'; did you mean 'Bar'?"
If only "undeclared identifier" rule matches:
  Append: "use of undeclared identifier 'Foo'; did you mean 'Bar'? [使用了未声明的标识符]"
  Replace: "[使用了未声明的标识符] 'Foo'; did you mean 'Bar'?"
```

Note: Replace mode with partial matches can produce grammatically odd output. This is a known tradeoff. Mitigation: write rules that match the full diagnostic phrase where possible.

## Toggle Behavior (Without Restarting clangd)

### Current Architecture Constraint

The `LspBridge` receives `LocalizationOptions` at construction time and stores them as `readonly`:
```typescript
// bridge.ts line 105
private readonly localization: LocalizationOptions | undefined;
```

There is no `updateLocalization()` method. The proxy CLI process reads `--localization-*` flags at startup and never re-reads them.

### User-Facing Behavior

| User Action | What Happens Immediately | What Happens on Next Proxy Start |
|-------------|-------------------------|----------------------------------|
| Enable localization | VS Code setting saved to `settings.json` | Proxy starts with `--localization-enabled` flag -> LspBridge gets `LocalizationOptions.enabled = true` |
| Disable localization | VS Code setting saved | Proxy starts without `--localization-enabled` flag -> LspBridge gets `localization: undefined` (no processing) |
| Switch mode (append -> override) | VS Code setting saved | Proxy starts with `--localization-mode override` -> `getAdaptedTable()` maps to `replace` |
| Change targets | VS Code setting saved | Proxy starts with `--localization-targets diagnostics,codeActions` |

### Required UI Communication

The control panel **must** surface that changes require a proxy restart. Options:

1. **Toast notification** after save: "Localization settings saved. Disable and re-enable clangd proxy for changes to take effect."
2. **Inline banner** in the Localization section: "Changes take effect after proxy restart."
3. **Auto-restart prompt** after save: "Proxy restart required. Restart now? [Yes] [No]"

Recommendation: Option 1 (toast) for v1.1 -- minimal disruption, clear messaging. Option 3 for v1.2+ if user feedback indicates desire for convenience.

### Edge Case: Toggle During Active Diagnostics

If the user changes localization settings while clangd is actively publishing diagnostics:

- Currently queued diagnostics in the proxy pipeline will be localized (or not) based on the OLD settings
- New diagnostics will use the OLD settings until proxy restart
- This is acceptable because the window is short (diagnostics are stateless)

### Edge Case: Toggle While Proxy is Not Running

If the user changes localization settings when proxy is disabled:

- Settings are saved correctly (no different from any other VS Code setting change)
- When proxy is next enabled, it reads the latest saved settings
- This is the common case and works correctly today

## UE-Specific Diagnostic Patterns

UE C++ code triggers diagnostic patterns that differ from standard C++ development. These patterns should be prioritized for rule coverage.

### High Frequency Patterns (UE Specific)

| Pattern | Typical UE Context | Example Message |
|---------|--------------------|-----------------|
| Missing UCLASS/USTRUCT/UENUM specifier | Forgetting UE reflection macros on new classes | `explicit class is not marked with UCLASS() specifier` |
| Missing GENERATED_BODY() | UE class declaration without generated code | `'GENERATED_BODY()' macro must appear in the class body` |
| TSubclassOf constraint violations | Using TSubclassOf without proper type | `cannot convert from 'UClass*' to 'TSubclassOf<AActor>'` |
| UPROPERTY specifier issues | Incorrect property specifiers for UE reflection | `UPROPERTY cannot be applied to this type` |
| TArray/TMap/TSet template issues | UE container template errors | `no matching constructor for initialization of 'TArray<FString>'` |
| FText/FString/FName conversion | UE string type mismatches | `no viable conversion from 'FString' to 'FText'` |
| AActor/UActorComponent patterns | Common actor/component misuse | `'RootComponent' is not a member of 'UMyComponent'` |
| Include of UE headers | Missing UE header includes | `'EngineMinimal.h' file not found` |

### High Frequency Patterns (General C++ That Hits UE Code Often)

| Pattern | Typical UE Context | Priority |
|---------|--------------------|----------|
| `no matching function for call to` | Template instantiation errors in UE containers | Already covered (rule 5) |
| `use of undeclared identifier` | Missing includes or typos in UE code | Already covered (rule 3) |
| `incomplete type` | Forward declaration missing full include | Already covered (rule 1) |
| `cannot convert` | Type mismatches in UE reflection-heavy code | Already covered (rule 10) |
| `overrides a member function but is not marked 'override'` | UE virtual function pattern | **Not covered** -- should be added (LOC-03) |
| `implicit conversion loses integer precision` | UE int32/int64 size mismatch on different platforms | **Not covered** -- should be added (LOC-03) |
| `unused variable` | Common in UE boilerplate code | **Not covered** -- should be added (LOC-03) |
| `'X' is deprecated` | UE API deprecation across engine versions | **Not covered** -- should be added (LOC-03) |

### Rule Expansion Priorities (LOC-03)

Priority for new rules to add to `createDefaultLocalizationTable()`:

1. `'overrides' but is not marked 'override'` -- very common UE C++20 pattern
2. `hides overloaded virtual function` -- common in UE class hierarchies
3. `implicit conversion loses integer precision` -- platform-specific warnings
4. `unused variable` / `unused parameter` -- cleanup warnings
5. `'X' is deprecated` -- engine version migration
6. `return type of 'X' is not identical to nor covariant with` -- inheritance errors
7. `binding drops 'const' qualifier` -- const-correctness in UE code
8. `expected class name` -- template/reflection parsing errors

## Feature Dependencies

```
LOC-01 (CLI passes localization config to LspBridge)
    └──REQUIRED_BY──> LOC-02 (mode verification)
    └──REQUIRED_BY──> LOC-04 (E2E verification)

LOC-03 (Rule coverage expansion)
    └──INDEPENDENT──> LOC-01 (can be done in parallel)
    └──ENHANCES──> LOC-02 (more rules = more to verify)
    └──ENHANCES──> LOC-04 (more rules = more test cases)

LOC-02 (Mode verification)
    └──REQUIRES──> LOC-01 (must pass mode to bridge first)
    └──ENHANCES──> User-facing mode semantics

LOC-04 (E2E verification)
    └──REQUIRES──> LOC-01 (must have working pipeline)
    └──REQUIRES──> LOC-03 (rule table must have rules to match)

UI: Mode labels in Chinese ("中英双语" / "仅中文")
    └──REQUIRES──> PROXY_SELECTS in controlPanelMessages.ts updated with i18n keys
    └──INDEPENDENT──> All LOC items (pure UI change)

UI: Proxy restart notification after save
    └──REQUIRES──> saveProxyConfig handler in controlPanel.ts extended
    └──INDEPENDENT──> LOC-01, LOC-02, LOC-03
```

### Dependency Notes

- **LOC-01 is the single critical blocker.** It is a ~10-line change in `cli.ts`. Until it's fixed, no localization feature works regardless of UI correctness.
- **LOC-03 can be done entirely in parallel** with LOC-01. It only adds entries to `createDefaultLocalizationTable()` in `localization.ts`. No other file changes.
- **UI improvements (Chinese labels, restart notification) are independent** of the proxy code and can be done alongside the other work.
- **LOC-02 requires LOC-01** because without the CLI wiring, there's nothing to verify. But the code for both modes already exists and is correct.

## MVP Definition

### Launch With (v1.1 milestone -- this cycle)

- [x] **LOC-01: CLI passes localization config to LspBridge** -- Fix `cli.ts` to construct `LocalizationOptions` from parsed args and pass to `LspBridge`. This is the core bugfix. ~10 lines added.
- [x] **LOC-02: Both modes produce correct output** -- Verify `append` mode (中英双语) and `override` mode (仅中文) both work. Code exists and is correct; this is verification that LOC-01 unblocks.
- [x] **LOC-03: Rule coverage expansion** -- Add 8+ new rules for common C++ and UE-specific patterns. Pure data addition to `createDefaultLocalizationTable()`.
- [x] **LOC-04: E2E verification** -- Integration test that sends known diagnostics through the proxy pipeline and asserts localized output. Uses injectable `spawnFn`/`io` params.
- [x] **UI: Chinese labels for mode select** -- Update `PROXY_SELECTS.localizationMode` in `controlPanelMessages.ts` to use `labelKey` (i18n) instead of raw labels. Add i18n keys for "中英双语" and "仅中文".
- [x] **UI: Proxy restart notification** -- After saving localization settings in control panel, show toast: "汉化设置已保存。请重新启用 clangd proxy 以使更改生效。"

### Add After Validation (v1.2)

- [ ] Auto-enable localization when VS Code locale is Chinese -- reduces friction for Chinese users
- [ ] Per-rule mode override -- e.g., append for diagnostics but replace for hover (needs schema change)
- [ ] Proxy restart prompt after localization settings change -- option 3 from toggle behavior section

### Future Consideration (v2+)

- [ ] User-customizable rule table via VS Code settings -- high complexity, needs config schema and validation
- [ ] Rule priority/ordering in control panel -- power feature, niche demand
- [ ] Localization rule testing tool -- allows users to test rules against sample messages
- [ ] Export/import of custom rule sets -- for team sharing

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| LOC-01: CLI passes localization config to LspBridge | CRITICAL (nothing works without it) | LOW (~10 lines, one file) | P0 |
| LOC-03: Rule coverage expansion | HIGH (more messages = more useful) | LOW-MEDIUM (add ~8 entries, test) | P1 |
| LOC-02: Mode verification | HIGH (core UX choice) | LOW (code exists, just verify) | P1 |
| LOC-04: E2E verification | HIGH (confidence in release) | MEDIUM (write integration test) | P1 |
| UI: Chinese labels for mode select | MEDIUM (better UX for Chinese users) | LOW (i18n key + zh.json entry) | P1 |
| UI: Proxy restart notification | MEDIUM (prevents confusion) | LOW (toast in controlPanel.ts) | P1 |
| Auto-enable for zh locale | MEDIUM (reduces friction) | LOW (check vscode.env.language) | P2 |
| Per-rule mode override | LOW-MEDIUM (niche) | MEDIUM (schema change, merge logic) | P3 |
| User-customizable rules | MEDIUM (power user) | HIGH (schema, validation, UI, migration) | P3 |

**Priority key:**
- P0: Blocking bugfix -- must ship
- P1: Core functionality for the milestone
- P2: Nice to have, add when possible
- P3: Future consideration

## User Flow Specification

### Flow 1: First-Time User Enables Localization

1. User opens Control Panel > Proxy tab
2. User sees Localization section with Enable checkbox, Mode select (中英双语 / 仅中文), Targets checkboxes
3. User checks "Enable Localization"
4. User selects "中英双语" (default)
5. User leaves all three targets checked (default)
6. User clicks Save
7. Toast appears: "Settings saved. Changes take effect after proxy restart."
8. User clicks Disable Proxy button, then Enable Proxy button
9. Proxy restarts with `--localization-enabled --localization-mode append --localization-targets diagnostics,codeActions,hover`
10. clangd starts publishing diagnostics with Chinese translations appended

### Flow 2: Switching from Bilingual to Chinese-Only

1. User has localization enabled in append mode
2. User opens Control Panel > Proxy tab
3. User changes Mode from "中英双语" to "仅中文"
4. User clicks Save
5. Toast appears: "Settings saved. Changes take effect after proxy restart."
6. User restarts proxy (disable + enable)
7. Proxy starts with `--localization-mode override`
8. Diagnostics now show Chinese-only output

### Flow 3: Disabling Localization

1. User unchecks "Enable Localization"
2. User clicks Save
3. Toast appears: "Settings saved. Changes take effect after proxy restart."
4. User restarts proxy
5. Proxy starts without `--localization-enabled` flag
6. Diagnostics return to original English

### Flow 4: Proxy Restart Via Control Panel (Disable + Enable)

1. User clicks "Disable Proxy" button
2. SettingsManager restores original clangd settings (clangd starts without proxy)
3. User clicks "Enable Proxy" button
4. SettingsManager reads latest config (including localization settings)
5. `buildProxyArgs()` constructs args including `--localization-enabled`, `--localization-mode`, `--localization-targets`
6. SettingsManager writes launcher path + new args to clangd settings
7. clangd restarts via the proxy launcher with the new args
8. LspBridge receives `LocalizationOptions` with latest settings

## Edge Cases and Error States

| Edge Case | Expected Behavior | Current Status |
|-----------|------------------|----------------|
| All targets unchecked but enabled=true | No messages localized; no crash | Works (bridge checks `targets.includes()` before applying) |
| Invalid `--localization-mode` value (not append/override) | Silently defaults to `append` | Works (cliArgs.ts line 118: if-else guard) |
| Empty localization targets list in CLI | Falls back to all three targets | Works (cliArgs.ts defaults) |
| Multiple rules match same message | Last matching rule wins (sequential application) | Works by design; put specific rules after general ones |
| Diagnostic contains null byte in message | Hover placeholder `\x00` could collide | Extremely unlikely in valid UTF-8 clangd output |
| Proxy CLI launched without --real-clangd | Error before any localization processing | Works (parseArgs returns error, runProxy exits early) |
| Localization table is empty | No localization applied; messages pass through | Works (applyRules loops over empty array) |
| Mode changed while diagnostics are in-flight | Old diagnostics use old mode; new diagnostics use old mode until restart | Acceptable; diagnostics are stateless and transient |

## Competitor Feature Analysis

| Feature | Rider (JetBrains) | Visual Studio | Our Approach |
|---------|-------------------|---------------|--------------|
| Chinese diagnostic messages | Built-in via IDE localization pack | Built-in via VS language pack | LSP proxy layer -- works with any clangd version |
| Mode control (bilingual / Chinese-only) | N/A (full IDE localization only) | N/A (full IDE localization only) | Dual mode for flexibility |
| Per-target control | N/A (all-or-nothing) | N/A (all-or-nothing) | diagnostics/codeActions/hover independently |
| Hover content code protection | N/A | N/A | Code block placeholder isolation (differentiator) |
| User-customizable rules | N/A | N/A | Planned for v1.2+ |
| Restart required for locale change | Full IDE restart | Full VS restart | Proxy restart only (<1 second) |
| Rule update frequency | Tied to IDE release cycle | Tied to VS release cycle | Can update independently via extension updates |

## Sources

- Codebase analysis: `localization.ts` (lines 75-259 for rule table, lines 278-311 for rule engine), `bridge.ts` (lines 57-66 for LocalizationOptions, lines 347-355 for getAdaptedTable, lines 363-405 for localizeDiagnosticsNotification), `cli.ts` (lines 137-149 for the bug), `cliArgs.ts` (lines 111-130 for flag parsing), `proxyManager.ts` (lines 168-191 for buildProxyArgs), `controlPanel.ts`, `controlPanel.html.ts`, `controlPanelMessages.ts` (lines 222-232 for PROXY_SELECTS), `config.ts` (lines 176-201 for localization config getters), `status.ts`
- i18n files: `en.json` (lines 117-118, 158, 172-174, 197), `zh.json` (same keys with Chinese translations)
- clangd documentation: diagnostic message format, LSP protocol `textDocument/publishDiagnostics` notification structure
- LSP specification 3.17: `CodeAction` title/disabled, `Hover` contents MarkupContent, `Diagnostic.relatedInformation`

---
*Feature research for: Clangd Proxy Localization Enhancement (v1.1)*
*Researched: 2026-07-01*
