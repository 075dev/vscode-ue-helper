# Testing Patterns

**Analysis Date:** 2026-06-30

## Test Framework

**Runner:**
- **Vitest 1.3+** (`vitest@^1.3.0`)
- Config: `vitest.config.ts`
- Globals: `false` — `describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach` MUST be imported explicitly from `'vitest'` in every test file
- Environment: `node` (no jsdom — pure Node unit tests)
- Test file pattern: `test/unit/**/*.test.ts`
- Excluded: `test/integration/**`, `node_modules/**`

**Assertion Library:**
- Built-in `vitest` expect — no separate assertion library

**Run Commands:**
```bash
npm run test:unit              # vitest run (CI mode, single pass)
npm run test:unit:watch        # vitest (watch mode for development)
npm run test:integration       # node test/integration/runTests.js (Electron-based via @vscode/test-electron)
npm test                       # npm run test:unit && npm run test:integration
```

## Test File Organization

**Location:**
- All unit tests live in `test/unit/` mirroring `src/` layout one-to-one:
  - `test/unit/clangd/` mirrors `src/clangd/`
  - `test/unit/commands/` mirrors `src/commands/`
  - `test/unit/core/` mirrors `src/core/`
  - `test/unit/detection/` mirrors `src/detection/`
  - `test/unit/parsers/` mirrors `src/parsers/`
- Nested deeper when a subsystem has its own folder: `test/unit/clangd/proxy/bridge.test.ts`, `test/unit/clangd/proxy/cli.test.ts`, etc.
- Integration tests live separately in `test/integration/` (Electron-driven, not run by Vitest)

**Naming:**
- `<source-file-without-extension>.test.ts`
- Examples: `src/clangd/clangdConfig.ts` → `test/unit/clangd/clangdConfig.test.ts`
- `src/parsers/ubtParser.ts` → `test/unit/parsers/ubtParser.test.ts`
- `src/commands/generateCompileCommands.ts` → `test/unit/commands/generateCompileCommands.test.ts`

**Structure:**
```
test/
├── unit/
│   ├── setup.ts                          # Global mocks (vscode module)
│   ├── clangd/
│   │   ├── clangdConfig.test.ts
│   │   ├── compileCommands.test.ts
│   │   ├── completionFiles.test.ts
│   │   ├── completionMode.test.ts
│   │   ├── diagnoseProject.test.ts
│   │   ├── preparseIncludes.test.ts
│   │   ├── proxyManager.test.ts
│   │   ├── ueClangdCompat.test.ts
│   │   ├── ueMacroCompletionProvider.test.ts
│   │   ├── ueMacroCompletions.test.ts
│   │   └── proxy/                         # Proxy subsystem (16 files)
│   │       ├── bridge.test.ts
│   │       ├── cli.test.ts
│   │       └── ...
│   ├── commands/
│   │   ├── clangdProxyCommands.test.ts
│   │   ├── createProject.test.ts
│   │   ├── diagnoseProjectCommand.test.ts
│   │   └── generateCompileCommands.test.ts
│   ├── core/
│   │   ├── clangdProxyConfig.test.ts
│   │   └── config.test.ts
│   ├── detection/
│   │   └── workspaceEngines.test.ts
│   └── parsers/
│       ├── msvcParser.test.ts
│       └── ubtParser.test.ts
└── integration/                           # Electron-driven (not Vitest)
    └── runTests.js
```

## Test Structure

**Suite Organization (canonical pattern):**
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Foo } from '@module/foo';

describe('Foo (capability)', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    fixture = await createFixture();
  });

  afterEach(async () => {
    await cleanup(fixture);
  });

  it('does X under Y conditions', async () => {
    // Arrange / Act / Assert
  });
});
```

**Patterns:**
- One `describe` per function or capability (multiple describes per file when source has multiple functions)
- `describe('FuncName (sub-capability)')` uses Chinese parentheses for sub-section names: `describe('defaultClangdConfig (模板风格)')`, `describe('defaultClangdConfig (compatHeaderPath)')`
- `it` names are sentence-style Chinese with intentional Given/When/Then structure:
  ```ts
  it('Given 未设置 projectPath When toggle Then 返回 skipped/warning 且不写 .clangd', async () => { ... });
  it('RED: 当前实现不会为插件 header 补条目（测试应失败直到实现）', async () => { ... });
  it('插件 header 被添加到 compile_commands.json', async () => { ... });
  ```
- File headers include TDD notes (RED/GREEN phase markers, bug backgrounds). Example: `test/unit/commands/generateCompileCommands.test.ts:1-12`, `test/unit/clangd/compileCommands.test.ts:1-12`.

**Setup file (`test/unit/setup.ts`):**
- Globally mocks the entire `vscode` module via `vi.mock('vscode', () => ({ ... }))`. Imported by Vitest via `setupFiles: ['test/unit/setup.ts']`.
- Provides minimal `vscode` surface: `workspace.getConfiguration`, `window.show*Message`, `window.createOutputChannel`, `window.withProgress`, `commands.registerCommand`, `languages.createDiagnosticCollection`, `tasks.*`, `Diagnostic`, `DiagnosticSeverity`, `Uri.file`, `EventEmitter`, `RelativePattern`, etc.
- Critical pattern: never read `.env` or credentials; mocking isolates tests from VS Code runtime and machine-specific state.

## Mocking

**Framework:** `vi.mock()` / `vi.fn()` (vitest built-ins, jest-compatible API).

**Patterns:**

1. **Auto-mock entire modules via barrel import:**
   ```ts
   vi.mock('@clangd', () => ({
     generateCompileCommands: () => mockGenerateCompileCommands(),
     linkToWorkspaceRoot: () => mockLinkToWorkspaceRoot(),
     addCompletionHelperToCompileCommands: (projectPath: string, ccJsonPath?: string) =>
       mockAddCompletionHelper(projectPath, ccJsonPath),
   }));
   ```
   See `test/unit/commands/generateCompileCommands.test.ts:45-60`. Place `vi.mock(...)` calls BEFORE importing the SUT.

2. **Typed mock functions:**
   ```ts
   const mockAddCompletionHelper = vi.fn<
     [projectPath: string, ccJsonPath: string | undefined],
     Promise<boolean>
   >();
   ```
   Generic args tuple syntax is preferred for strongly-typed mock signatures.

3. **Override `vscode.workspace.getConfiguration` per-test:**
   ```ts
   vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
     get: vi.fn((key: string, def?: unknown) => key === 'completionMode' ? mode : def),
     has: vi.fn(() => true),
     inspect: vi.fn(),
     update: vi.fn(),
   });
   ```
   See `test/unit/clangd/completionMode.test.ts:45-57`.

4. **Real implementation passthrough for one-off hybrid tests** (mock some functions, delegate to real ones for others):
   ```ts
   import { addCompletionHelperToCompileCommands as realAddCompletionHelperToCompileCommands, ... } from '@clangd/completionFiles';
   ...
   mockAddCompletionHelper.mockImplementation(realAddCompletionHelperToCompileCommands);
   ```
   See `test/unit/commands/generateCompileCommands.test.ts:218-220`.

5. **FakeLogger / fakeDetection pattern** — explicit mock objects for DI dependencies:
   ```ts
   logger = {
     info: vi.fn(),
     warn: vi.fn(),
     error: vi.fn(),
     debug: vi.fn(),
   } as unknown as Logger;

   detection = {
     scanner: { scan: vi.fn().mockResolvedValue([...]), findSingle: vi.fn() },
     discovery: { discover: vi.fn().mockResolvedValue([...]) },
     workspaceContext: { getSelectedProject: vi.fn().mockReturnValue(...), ... },
   } as unknown as DetectionHandles;
   ```
   See `test/unit/commands/generateCompileCommands.test.ts:94-124`.

6. **`vi.clearAllMocks()` in `beforeEach`** — keeps mock call history clean per test.

**What to Mock:**
- VS Code API surface (already done globally in `setup.ts`)
- Heavy I/O: `fs`, `child_process` (execa), file watchers
- Cross-module dependencies: barrel-imported modules like `@clangd`, `@ui/quickPicks`
- Anything that would require a running Unreal Engine or UBT

**What NOT to Mock:**
- Pure data-parsing functions: `UbtParser.parse`, regex matchers, formatters
- String manipulation and YAML serialization — exercise the real code
- Path normalization helpers
- i18n `t()` function (uses JSON imports)

## Fixtures and Factories

**Test Data — inline factory pattern:**
```ts
async function createFixture(): Promise<{ tmpDir: string; projectPath: string; jsonPath: string }> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'compile-commands-test-'));
  // build minimal UE project tree
  await fs.writeFile(path.join(tmpDir, 'MassTest.uproject'), '{}', 'utf-8');
  // ...
  return { tmpDir, projectPath, jsonPath };
}
```
See `test/unit/clangd/compileCommands.test.ts:31-74` for the canonical fixture builder.

**Temp directory pattern:**
- Prefix with test name for greppability: `'compile-commands-test-'`, `'completion-mode-test-'`, `'classify-test-'`, `'ws-folders-test-'`.
- Always clean up in `afterEach`: `await fs.rm(tmpDir, { recursive: true, force: true });`
- Use `try/finally` for inline temp dirs:
  ```ts
  const tempDir = await fs.mkdtemp(...);
  try {
    // test body
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
  ```
  See `test/unit/clangd/compileCommands.test.ts:184-267`.

**No dedicated `test/fixtures/` directory** — fixtures are constructed inline per test file. There is an empty `test/fixtures/` directory reserved for future static fixtures but it is currently unused.

## Coverage

**Provider:** v8 (`coverage.provider: 'v8'`)

**Reporters:** `text`, `html`, `lcov`

**Scope:**
- Include: `src/**/*.ts`
- Exclude: `src/extension.ts` (activation entry, not unit-testable), `src/**/*.d.ts` (declarations only)

**Thresholds:**
- Lines: 80%
- Functions: 80%
- Branches: 75%
- Statements: 80%

**View Coverage:**
```bash
npx vitest run --coverage        # writes coverage/ HTML report
```

**Configuration:** `vitest.config.ts:13-24`. Coverage thresholds will fail the run if breached.

## Test Types

**Unit Tests (primary):**
- Scope: single function or class, fully isolated from VS Code and external processes
- Files: `test/unit/**/*.test.ts`
- All run synchronously or with Node fs/os; no Electron, no VS Code runtime

**Integration Tests:**
- Scope: end-to-end activation inside a real VS Code instance via `@vscode/test-electron`
- Files: `test/integration/runTests.js` (currently a single bootstrap file)
- Run command: `npm run test:integration`
- Currently sparse — directory has no `.test.ts` files, only the runner script. Heavy lift of integration testing happens at the unit level via mock injection.

**E2E Tests:**
- Not used. Proxy subsystem uses extended unit tests with real CLI invocations (e.g., `test/unit/clangd/proxy/cli.test.ts`, `e2eCliRestartLoop.test.ts`, `e2eHarness.test.ts`) as the practical substitute for true E2E.

## Common Patterns

**Async Testing:**
```ts
it('async result', async () => {
  const result = await someAsyncFunc(input);
  expect(result).toEqual({ ok: true, value: '...' });
});
```
- Always `await` async calls. The `@typescript-eslint/no-floating-promises` rule will catch forgotten awaits.
- For `.rejects` assertions: `await expect(promise).rejects.toMatchObject({ code: 'ENOENT' });`
- For `.resolves` assertions: `await expect(promise).resolves.toEqual(...)`.

**Error Testing:**
```ts
it('shows error when helper write fails', async () => {
  mockAddCompletionHelper.mockResolvedValue(false);
  await executeGenerateCompileCommands(logger, detection);
  expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
    `Failed to generate compile_commands.json: Unable to add completion helper entry to ${LINK_PATH}`,
  );
  expect(vscode.window.showInformationMessage).not.toHaveBeenCalledWith(
    `compile_commands.json updated at ${LINK_PATH}`,
  );
});
```
See `test/unit/commands/generateCompileCommands.test.ts:269-280`.

**YAML / snapshot-style content matching:**
```ts
expect(content).toContain('macroCompletionHelper.h');
expect(content).not.toContain('$(EngineRoot)');
expect(content).toContain(`${normalizedEngineRoot}/Source/Runtime/Core/Public/CoreSharedPCH.h`);
```
Avoid full-string `toBe()` matches for large generated content — test structural invariants via `.toContain` / `.not.toContain`.

**Parameter-assertion pattern for command executors:**
```ts
expect(mockAddCompletionHelper).toHaveBeenCalledTimes(1);
expect(mockAddCompletionHelper).toHaveBeenCalledWith(PROJECT_PATH, LINK_PATH);
expect(mockAddCompletionHelper.mock.calls[0]).toStrictEqual([PROJECT_PATH, LINK_PATH]);
```

**TDD red/green markers in test names:**
```ts
it('RED: 当前实现不会为插件 header 补条目（测试应失败直到实现）', async () => { ... });
it('插件 header 被添加到 compile_commands.json', async () => { ... });  // green test
```

**Mock isolation per test:**
```ts
beforeEach(() => {
  vi.clearAllMocks();
  // reset config
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ ... });
});
```

## Sample Well-Structured Tests

**Best exemplar — `test/unit/commands/generateCompileCommands.test.ts` (293 lines):**
- Clean Given/When/Then BDD-style test names
- TDD phase markers (RED/GREEN) preserved in `it` titles
- Strongly-typed `vi.fn<[Args], Return>()` for compile-time mock signature safety
- Hybrid mock strategy: mocks for cross-module deps, real impl passthrough for the SUT itself
- Inline temp dir with `try/finally` cleanup
- Verifies both parameter passing AND observable side effects (OutputChannel, showInformationMessage, showErrorMessage)
- Documents the bug being fixed in the file header (`Bug 背景:...`) so future maintainers understand the test's purpose

**Second-best exemplar — `test/unit/clangd/clangdConfig.test.ts` (346 lines):**
- Multi-`describe` structure splitting one function into behavior groups (template style, compat header path, preparse headers, YAML quoting, adversarial)
- Adversarial test cases named explicitly: `'misleading_success:...'`, `'hung_commands:...'`, `'dirty_worktree:...'`
- Time-bound assertions for async-safety: `expect(elapsed).toBeLessThan(100);`
- Roundtrip property tests: render with `yaml.stringify`, parse back with `yaml.parse`, verify preserved invariants

**Third exemplar — `test/unit/clangd/compileCommands.test.ts` (265 lines):**
- Clean fixture-builder pattern returning a typed object
- Comprehensive coverage of edge cases: Windows case-insensitivity, invalid JSON, missing source dirs, template selection
- `afterEach` cleanup with `fs.rm(tmpDir, { recursive: true, force: true })`
- Structured-result assertions: `const r = result as { added: string[] }; expect(r.added.some(f => f.endsWith('...'))).toBe(true);`

---

*Testing analysis: 2026-06-30*