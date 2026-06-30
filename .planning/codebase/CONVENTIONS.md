# Coding Conventions

**Analysis Date:** 2026-06-30

## Naming Patterns

**Files:**
- camelCase for source files: `clangdConfig.ts`, `completionFiles.ts`, `workspaceContext.ts`
- Domain subdirectories mirror `src/` layout: `src/clangd/`, `src/commands/`, `src/core/`, `src/detection/`, `src/i18n/`, `src/mcp/`, `src/parsers/`, `src/ui/`, `src/build/`, `src/rules/`, `src/platform/`
- Test files mirror source with `.test.ts` suffix: `clangdConfig.test.ts`, `ubtParser.test.ts`, `workspaceEngines.test.ts`
- Locale files: lowercase JSON in `src/i18n/locales/en.json` and `zh.json`

**Functions:**
- camelCase verbs for action functions: `executeBuild()`, `executeGenerateCompileCommands()`, `renderClangdConfig()`, `replaceSystemIncludeBlock()`, `linkToWorkspaceRoot()`
- Pure helpers use camelCase nouns/verbs: `defaultClangdConfig()`, `addCompletionHelperToCompileCommands()`, `resolvePreparseHeaders()`
- Factory/instantiation: PascalCase class names with camelCase methods

**Variables:**
- camelCase for locals and parameters: `addFlags`, `engineRoot`, `macroHelperPath`, `compilationMode`, `pathMatch`
- SCREAMING_SNAKE for module-level constants: `UBT_PROGRESS_RE`, `VALID_LOCALIZATION_TARGETS`, `DEFAULT_KEEPALIVE_MAX`, `DEFAULT_KEEPALIVE_TTL_SEC`, `SYSTEM_INCLUDE_FILTER_PREFIXES`
- Optional values use explicit `undefined` over `null` (see `Config.clangdPath` getters)
- Private class fields use `private` keyword with `readonly` for immutable references: `private readonly root: vscode.WorkspaceConfiguration`

**Types:**
- PascalCase for type/interface names: `ClangdConfig`, `ClangdConfigOptions`, `BuildConfiguration`, `CompletionMode`, `MCPMode`, `UBTProgress`, `DetectionHandles`
- Type unions match `package.json` enums exactly: `BuildConfiguration = 'Debug' | 'DebugGame' | 'Development' | 'Shipping' | 'Test'`
- Interfaces use `I`-prefix rarely; prefer bare names. Types live in `src/clangd/types.ts`, `src/build/types.ts`, `src/detection/types.ts`

**Commands (VS Code):**
- All command IDs use the prefix `vscodeUEHelper.*` (kebab of `vscodeUEHelper` + camelCase verb): `vscodeUEHelper.build`, `vscodeUEHelper.liveCoding`, `vscodeUEHelper.toggleCompletionMode`, `vscodeUEHelper.enableClangdProxy`
- Executors use the prefix `execute*` matching the command name: `executeBuild`, `executeGenerateCompileCommands`, `executeDiagnoseProject`
- Settings keys follow dotted namespace `vscodeUEHelper.*`: `vscodeUEHelper.ueVersion`, `vscodeUEHelper.clangdProxy.enabled`, `vscodeUEHelper.clangdProxy.localization.targets`

## Code Style

**Formatting (Prettier):**
- Tool: `prettier@^3.2.5`, config in `.prettierrc`
- Semicolons: required (`"semi": true`)
- Quotes: single quotes (`"singleQuote": true`)
- Trailing commas: always (`"trailingComma": "all"`)
- Print width: 100 (`"printWidth": 100`)
- Tab width: 2 spaces, no tabs (`"tabWidth": 2`, `"useTabs": false`)
- Arrow parens: always (`"arrowParens": "always"`)
- End of line: LF (`"endOfLine": "lf"`)
- Markdown: `printWidth: 120`, proseWrap preserve
- Format command: `npm run format` / `npm run format:check`

**Linting (ESLint):**
- Config: `.eslintrc.json` (legacy config; not flat config)
- Parser: `@typescript-eslint/parser` with `project: ["./tsconfig.json"]` (type-aware)
- Extends: `eslint:recommended`, `plugin:@typescript-eslint/recommended`, `plugin:@typescript-eslint/recommended-requiring-type-checking`
- Key rules:
  - `@typescript-eslint/no-unused-vars: error` with `argsIgnorePattern: "^_"` and `varsIgnorePattern: "^_"`
  - `@typescript-eslint/no-explicit-any: warn`
  - `@typescript-eslint/explicit-function-return-type: warn` with `allowExpressions: true`
  - `@typescript-eslint/no-floating-promises: error`
  - `@typescript-eslint/no-misused-promises: error`
  - `@typescript-eslint/await-thenable: error`
  - `@typescript-eslint/no-non-null-assertion: warn`
  - `@typescript-eslint/prefer-nullish-coalescing: warn`
  - `prefer-const: error`
  - `eqeqeq: ["error", "always"]`
  - `curly: ["error", "all"]` (always use braces, even single-statement blocks)
  - `no-console: off` (console allowed for dev diagnostics)
- Lint scripts: `npm run lint` / `npm run lint:fix`
- Lint scope: `src test --ext .ts`

## Import Organization

**Order (typical pattern in source files):**
1. `import * as vscode from 'vscode';` (always first when used)
2. Node built-ins: `import * as fs from 'node:fs/promises';`, `import * as path from 'node:path';`, `import { tmpdir } from 'node:os';`
3. Third-party packages: `import * as yaml from 'yaml';`
4. Path-aliased internal imports: `@core/logger`, `@clangd/clangdConfig`, `@ui/quickPicks`, `@detection`, `@commands/...`, `@parsers/...`
5. Type-only imports: `import type { Logger } from '@core/logger';`, `import type { DetectionHandles } from '@detection';`
6. Relative imports for sub-modules: `import { ClangdConfig, IfBlock } from './types';`

**Path Aliases (in both `tsconfig.json` and `vitest.config.ts`):**
- `@/*` -> `src/*` (root)
- `@core` -> `src/core/index`; `@core/*` -> `src/core/*`
- `@detection` -> `src/detection/index`; `@detection/*` -> `src/detection/*`
- `@build` -> `src/build/index`; `@build/*` -> `src/build/*`
- `@clangd` -> `src/clangd/index`; `@clangd/*` -> `src/clangd/*`
- `@i18n` -> `src/i18n/index`; `@i18n/*` -> `src/i18n/*`
- `@parsers/*` -> `src/parsers/*`
- `@commands` -> `src/commands/index`; `@commands/*` -> `src/commands/*`
- `@ui` -> `src/ui/index`; `@ui/*` -> `src/ui/*`
- `@mcp` -> `src/mcp/index`; `@mcp/*` -> `src/mcp/*`
- `@rules` -> `src/rules/index`; `@rules/*` -> `src/rules/*`
- `@platform` -> `src/platform/index`; `@platform/*` -> `src/platform/*`
- Barrel files (e.g., `src/clangd/index.ts`) re-export the module's public API; tests and other modules import through the alias, never via deep relative paths.

**Style notes:**
- Tests import the system under test (SUT) AFTER `vi.mock(...)` declarations so mocks are registered before module evaluation. See `test/unit/commands/generateCompileCommands.test.ts:74` for the canonical pattern.
- `import type` is preferred over `import { Type }` when only the type is used.

## Error Handling

**Strategy:** Hybrid — Result types for async boundaries, exceptions for unrecoverable/early-fail flows, structured logger error reporting for runtime diagnostics. `neverthrow` is in dependencies but usage is selective.

**Patterns observed:**

1. **Result types (`{ ok: true, value } | { ok: false, error }`)** — used by build runner boundary. See `src/commands/build.ts:96-100`:
   ```ts
   if (!r.ok) {
     channel.appendLine(`[UE Helper] build failed: ${r.error.message}`);
     void vscode.window.showErrorMessage(`Build failed: ${r.error.message}`);
     return null;
   }
   pushDiagnostics(r.value.diagnostics);
   ```

2. **try/catch around withProgress** — outer command flow. See `src/commands/generateCompileCommands.ts:120-124`:
   ```ts
   } catch (err) {
     void vscode.window.showErrorMessage(
       `Failed to generate compile_commands.json: ${err instanceof Error ? err.message : String(err)}`,
     );
   }
   ```

3. **Internal throws for control flow inside try blocks** — used to abort the withProgress sequence:
   ```ts
   if (!helperAdded) {
     throw new Error(`Unable to add completion helper entry to ${linkPath}`);
   }
   ```
   The outer `catch` then surfaces a user-friendly error message.

4. **Silent catch for optional operations** — e.g., `replaceSystemIncludeBlock` returns input unchanged if YAML parse fails (`src/clangd/clangdConfig.ts:259-261`):
   ```ts
   } catch {
     return yamlText;
   }
   ```

5. **Error guards with `instanceof Error`** — always coerce unknown to string for user-facing messages:
   ```ts
   `${err instanceof Error ? err.message : String(err)}`
   ```

6. **Fire-and-forget async** — Use `void` prefix to satisfy `no-floating-promises` rule for one-shot UI notifications:
   ```ts
   void vscode.window.showInformationMessage(`compile_commands.json updated at ${linkPath}`);
   void vscode.window.showErrorMessage(...);
   ```

7. **Detached background work with `.catch` logging** — long-running tail work:
   ```ts
   startModifyResponseFiles(project.path, logger).catch((err) =>
     logger.warn('[generateCompileCommands] modifyRspFiles failed:', err),
   );
   ```

**Negative paths return undefined rather than throwing** — `findClangdConfig` returns `string | null` (uses `fs.access` to test existence).

## Logging

**Framework:** Custom `Logger` class in `src/core/logger.ts`. Not a third-party library.

**Key APIs:**
- `new Logger(prefix: string)` — creates a dedicated `vscode.OutputChannel` with the given title. One Logger per module is the convention (e.g., `'detection'`, `'clangd'`).
- `.info(...args)`, `.warn(...args)`, `.error(...args)`, `.debug(...args)` — accept variadic args; non-string args are `JSON.stringify`'d.
- `.setLevel(level: 'error' | 'warn' | 'info' | 'debug')` — defaults to `'info'`.
- `.show(preserveFocus?: boolean)` — reveals the output panel.
- `.dispose()` — call when extension deactivates.

**Output format:** `HH:MM:SS.mmm [LEVEL] [prefix] message` — writes to BOTH the OutputChannel AND `console.*` (so DevTools also sees it).

**Conventions:**
- All loggers use a single-word module prefix: `'VSCodeUEHelper'`, `'detection'`, `'clangd'`, `'MyModule'`.
- Tag with the calling context in brackets: `logger.info('[generateCompileCommands] done → ${linkPath}')`.
- Errors always pass the error object as a trailing argument: `logger.error('oops', err)`.
- Module-level channels are created once and shared. The shared instance lives in `extension.ts` and is passed via dependency injection (see `executeBuild(logger, detection)` parameter style).

## Comments

**When to Comment:**
- Every source file starts with a JSDoc block describing module purpose, design rationale, and usage examples. Example: `src/core/logger.ts:1-38`, `src/commands/generateCompileCommands.ts:1-17`.
- Section dividers use `// ===== Section Name =====` style banners to split long files (e.g., `src/clangd/clangdConfig.ts:43, 196, 204, 231`).
- Inline comments explain non-obvious decisions, especially around UE/UBT quirks. Avoid restating what code does.

**JSDoc/TSDoc:**
- All public functions and exported types have JSDoc with `@param`, `@returns` where behavior is non-obvious.
- Inline `// @ts-expect-error` or `as unknown as Type` casts are documented with the reason.
- Public module exports include "Why this design?" sections in the file header.

**Bilingual comments:**
- Comments are predominantly Chinese (Simplified) with English for code identifiers and command titles. This matches the i18n strategy (`src/i18n/locales/zh.json` / `en.json`).

## Function Design

**Size:** Functions stay focused. Command executors (`executeBuild`, `executeGenerateCompileCommands`) are 100-150 lines but proceed linearly through phases; pure helpers are 5-30 lines.

**Parameters:**
- Command executors take a `(logger, detection)` pair plus optional config — explicit dependency injection instead of globals.
- Options objects use the `*Options` suffix and have all-optional fields with sensible defaults: `interface ClangdConfigOptions { completionMode?: ..., macroHelperPath?: ..., ... }`.
- Pure data functions take 1-2 arguments and return a value.

**Return Values:**
- Pure functions return the result value (`string`, `ClangdConfig`, `{ ok: true, value } | { ok: false, error }`).
- Void-returning command executors handle user messaging internally via `vscode.window.show*Message`.
- Optional returns use `T | undefined` or `T | null` deliberately (file ops: `null` for "not found"; missing config: `undefined`).

## Module Design

**Exports:**
- Barrel files (`src/<domain>/index.ts`) re-export the public API: `src/clangd/index.ts`, `src/commands/index.ts`, `src/ui/index.ts`.
- Internal helpers stay un-exported. Cross-module imports go through the barrel.
- Type exports use `export type { ... }` (separate from value exports) where supported.

**Module structure:**
- Each `src/<domain>/` has an `index.ts` (barrel), an `AGENTS.md` (subsystem notes), and one file per concept. Examples: `src/clangd/clangdConfig.ts`, `src/clangd/compileCommands.ts`, `src/clangd/proxyManager.ts`, `src/clangd/preparseIncludes.ts`.
- Subsystems with their own state machines or controllers use a single `<Name>Controller.ts` file: `CompletionModeController` in `src/clangd/completionMode.ts`, `ClangdProxyManager` in `src/clangd/proxyManager.ts`.

**i18n:**
- `t(key: TranslationKey, params?)` is the canonical helper (`src/i18n/index.ts:40`). Placeholder format is `{name}`.
- All user-facing strings flow through `t(...)`. Logger output strings may remain in English (intended for log debugging).
- `initI18n()` must be called before Logger creation so error logs can also be localized.

**State machines:**
- `xstate@^5.9.0` is in dependencies but adoption is selective — the proxy uses it for connection lifecycle; most subsystems use plain class-based state holders.

---

*Convention analysis: 2026-06-30*