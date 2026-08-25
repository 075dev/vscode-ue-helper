# Phase 1: P0 必修闭环 — Verification 证据

- **Phase**: 1-P0 必修闭环（见 `.planning/ROADMAP.md` Phase 1）
- **目标**: 完成 REMEDIATION-PLAN Wave 1 P0 必修全部 4 task（T1.1–T1.4）的验证证据，建立 CI / 发布的稳定基线
- **Requirements**: REM-001
- **CONTEXT 决策**: D-01 / D-02 / D-03 / D-04 / D-05 / D-06 / D-07 / D-08 / D-09 / D-10
- **创建日期**: 2026-08-25

## Exit Code 摘要

| 命令 | Exit Code | Warning 数 (lint) | 关键产物 |
|------|-----------|-------------------|----------|
| `npm run typecheck` | 0 | N/A | (无产物) |
| `npm run lint` | 0 | 53 | (无产物) |
| `npm run test:unit` | 0 | N/A | 87 test files / 1081 tests passed |
| `npm run build` | 0 | N/A | `out/extension.js` + `out/clangdProxy.js` |

## T1.1–T1.4 已闭环证据链

- **T1.1: 删除 `test:integration` + `test` alias 到 `test:unit`** —— `package.json:482` 当前为 `"test": "npm run test:unit"`，全文件无 `test:integration` 字面；闭环 commit: `5b27d2e fix(test): 删除坏掉的 test:integration 脚本,改 npm test 仅跑 unit [T1.1]`
- **T1.2: `.bak` git rm + `.gitignore` 加 `*.bak`** —— `.gitignore:31` 含 `*.bak`；`git ls-files | grep -E '\.bak$'` 输出为空；`git check-ignore -v <任意存在的 .bak>` 报告 `.gitignore:31:*.bak`；闭环 commit: `76a1fdf chore(gitignore): 移除被跟踪的 .bak + 添加 *.bak 规则 [T1.2]`
- **T1.3: `resources/icon.png` 替换为 128×128 PNG** —— `file resources/icon.png` 输出 `PNG image data, 128 x 128, 8-bit/color RGBA, non-interlaced`，文件大小 4758 bytes；闭环 commit: `deb7ac7 chore(assets): 替换占位 icon.png 为真实 128×128 PNG (深蓝渐变+UE金字+HELPER) [T1.3]`
- **T1.4: `proxyManager.test.ts:216` lint error** —— T1.4 原始 lint error 在当前 lint 输出中已不存在；`npm run lint` 输出 `0 errors, 53 warnings`，且无 `proxyManager.test.ts` 相关 error 报告。原始 REM task 关于 line 216 lint error 的 statement 在当前 lint 基线（详见章节 §npm run lint）中已隐式闭环；闭环 commit: `045d303 fix(core): 门禁恢复与基础模块修复`

## 4 门禁验证输出

### §npm run typecheck

```
$ npm run typecheck

> vscode-ue-helper@0.1.0 typecheck
> tsc --noEmit

exit code: 0
```

### §npm run lint

```
$ npm run lint

> vscode-ue-helper@0.1.0 lint
> eslint src test --ext .ts


D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\src\clangd\diagnoseProject.ts
   50:12  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  160:4   warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\src\clangd\fingerprint.ts
  213:16  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\src\ui\controlPanel.ts
   37:43  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  473:14  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  474:14  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  517:32  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\build\buildRunner.test.ts
  42:34  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  74:8   warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  76:41  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\compileCommands\task.test.ts
  27:47  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\fileWatcher.test.ts
   93:49  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  105:20  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  126:20  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  207:20  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  226:20  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\incrementalScan.test.ts
  122:20  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  157:20  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\proxy\cliFixtures.ts
  70:63  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  82:27  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\proxy\cliStdio.test.ts
  18:25  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\proxy\e2eHarness.test.ts
  123:56  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  135:27  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  572:25  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  793:29  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\proxy\processBridge.test.ts
   52:56  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
   66:27  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  269:31  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  289:31  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\proxy\status.test.ts
  210:58  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  220:29  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\proxy\ueDiagnosticWatcher.test.ts
  44:47  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  54:8   warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  56:41  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\clangd\uhtGeneration.test.ts
   76:11  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
   91:27  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  187:23  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\commands\uninstall.test.ts
  30:19  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\core\subprocessRegistry.test.ts
  38:47  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  54:8   warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  56:51  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\core\workspace.test.ts
  335:21  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  336:29  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\test\unit\ui\controlPanel.test.ts
   59:31  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
   63:30  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
   75:19  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  159:19  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  247:59  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  248:59  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  252:29  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  869:54  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  893:54  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports
  916:54  warning  `import()` type annotations are forbidden  @typescript-eslint/consistent-type-imports

✖ 53 problems (0 errors, 53 warnings)

exit code: 0
```

### §npm run test:unit

```
$ npm run test:unit

> vscode-ue-helper@0.1.0 test:unit
> vitest run

The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v1.6.1 D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper

stderr | test/unit/clangd/compileCommandsFallback.test.ts > generateFallbackCompileCommands (Intermediate/UHT 注入) > Case A: Intermediate/UHT 路径被加进 cc.json 的 -I
12:25:17.362 [WARN] [VSCodeUEHelper] [fallback] generating FALLBACK compile_commands.json (UBT failed) for C:\Users\075\AppData\Local\Temp\fallback-cc-test-bGPcj1

stdout | test/unit/scripts/extract-ue-docs.test.ts > runExtract — 端到端 > 扫描临时目录中的 fixture 头文件,输出 JSON
UE 引擎根目录: C:\Users\075\AppData\Local\Temp\ue-docs-run-OViqWV
最小文档长度: 10
正在扫描头文件...
找到 1 个头文件
正在提取文档注释...
  Sub/MyHeader.h: 1 条

提取完成：1 条原始，1 条去重唯一
输出文件: C:\Users\075\AppData\Local\Temp\ue-docs-out-fmRNT1\sub\out.json
翻译字段已留空，请填入 translation 后使用。

stdout | test/unit/scripts/extract-ue-docs.test.ts > runExtract — 端到端 > 空目录返回 [] 而不抛
UE 引擎根目录: C:\Users\075\AppData\Local\Temp\ue-docs-empty-5zj0o6
最小文档长度: 10
正在扫描头文件...
找到 0 个头文件
正在提取文档注释...

提取完成：0 条原始，0 条去重唯一
输出文件: C:\Users\075\AppData\Local\Temp\ue-docs-empty-out-UupYoE\out.json
翻译字段已留空，请填入 translation 后使用。

stderr | test/unit/clangd/fileWatcher.test.ts > 文件监听 > chokidar mock 期间不启动真实 watcher
[fileWatcher] start called but chokidar is mocked
[fileWatcher] stop called but chokidar is mocked

stderr | test/unit/clangd/fileWatcher.test.ts > 文件监听 > chokidar mock 期间不启动真实 watcher
[fileWatcher] start called but chokidar is mocked
[fileWatcher] stop called but chokidar is mocked

stderr | test/unit/core/logger.test.ts > [logger] > setLevel 接到 workspace onDidChangeConfiguration 后变更 level
12:25:18.892 [INFO] [VSCodeUEHelper] [logger] level changed: debug -> info
12:25:18.892 [INFO] [VSCodeUEHelper] [logger] level changed: info -> debug

stderr | test/unit/clangd/fileWatcher.test.ts > 文件监听 > chokidar mock 期间不启动真实 watcher
[fileWatcher] start called but chokidar is mocked
[fileWatcher] stop called but chokidar is mocked

stderr | test/unit/core/logger.test.ts > [logger] > setLevel 接到 workspace onDidChangeConfiguration 后变更 level
12:25:18.892 [INFO] [VSCodeUEHelper] [logger] level changed: debug -> info
12:25:18.892 [INFO] [VSCodeUEHelper] [logger] level changed: info -> debug

stderr | test/unit/clangd/fileWatcher.test.ts > 文件监听 > chokidar mock 期间不启动真实 watcher
[fileWatcher] start called but chokidar is mocked
[fileWatcher] stop called but chokidar is mocked

stderr | test/unit/clangd/proxy/e2eCliRestartLoop.test.ts > [e2e][restart loop] > entrypoint 反复重启 proxy 子进程
[e2e][restart] spawn attempt 1
[e2e][restart] spawn attempt 2
[e2e][restart] spawn attempt 3
[e2e][restart] spawn attempt 4

stderr | test/unit/clangd/proxy/e2eCliRestartLoop.test.ts > [e2e][restart loop] > entrypoint 反复重启 proxy 子进程
[e2e][restart] spawn attempt 1
[e2e][restart] spawn attempt 2
[e2e][restart] spawn attempt 3
[e2e][restart] spawn attempt 4

stderr | test/unit/clangd/proxy/processBridge.test.ts > [process bridge] > spawn 失败时 stdout/stderr 错误信息聚合到 onError
[processBridge] spawn failed: spawn failed
[processBridge] spawn failed: spawn failed

stderr | test/unit/clangd/proxy/processBridge.test.ts > [process bridge] > spawn 失败时 stdout/stderr 错误信息聚合到 onError
[processBridge] spawn failed: spawn failed
[processBridge] spawn failed: spawn failed

stderr | test/unit/clangd/proxyLogTailer.test.ts > [proxyLogTailer] > 日志超过 maxBytes 后截断为单行
[proxyLogTailer] tail started
[proxyLogTailer] tail started

stderr | test/unit/clangd/proxyLogTailer.test.ts > [proxyLogTailer] > 日志超过 maxBytes 后截断为单行
[proxyLogTailer] tail started
[proxyLogTailer] tail started

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/fileWatcher.test.ts > 文件监听 > chokidar mock 期间不启动真实 watcher
[fileWatcher] start called but chokidar is mocked
[fileWatcher] stop called but chokidar is mocked

stderr | test/unit/clangd/incrementalScan.test.ts > [incrementalScan] > scan 完成触发 deferred finish
[incrementalScan] scan finished

stderr | test/unit/clangd/incrementalScan.test.ts > [incrementalScan] > scan 完成触发 deferred finish
[incrementalScan] scan finished

stderr | test/unit/clangd/fileWatcher.test.ts > 文件监听 > chokidar mock 期间不启动真实 watcher
[fileWatcher] start called but chokidar is mocked
[fileWatcher] stop called but chokidar is mocked

stderr | test/unit/core/logger.test.ts > [logger] > setLevel 接到 workspace onDidChangeConfiguration 后变更 level
12:25:18.892 [INFO] [VSCodeUEHelper] [logger] level changed: debug -> info
12:25:18.892 [INFO] [VSCodeUEHelper] [logger] level changed: info -> debug

stderr | test/unit/clangd/proxyLogTailer.test.ts > [proxyLogTailer] > 日志超过 maxBytes 后截断为单行
[proxyLogTailer] tail started
[proxyLogTailer] tail started

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/cliEntrypoint.test.ts > [proxy cli entrypoint] > 错误码 11 = USAGE_ERROR
[cliEntrypoint] USAGE_ERROR: missing --workspace

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动Manager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/proxy/proxyManager.test.ts > [proxyManager] > 启动失败 throw 后 dispose 不留 pending child
[proxyManager] start failed: simulated start failure
[proxyManager] start failed: simulated start failure

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all tasks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 {iagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [miagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangtest.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unitClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks passed

stderr | test/unit/clangd/clangd-commands/diagnoseClangdProject.test.ts > [diagnoseClangdProject] > 全部 OK 时返回 { ok: true }
[diagnoseClangdProject] all checks

 Test Files  87 passed (87)
      Tests  1081 passed (1081)
   Start at  20:25:16
   Duration  17.18s (transform 7.01s, setup 2.76s, collect 15.23s, tests 23.32s, environment 21ms, prepare 14.32s)

exit code: 0
```

### §npm run build

```
$ npm run build

> vscode-ue-helper@0.1.0 build
> npm run clean && node esbuild.config.mjs


> vscode-ue-helper@0.1.0 clean
> node scripts/clean-out.mjs

[clean-out] removed out/src
[clean-out] removed out/test

  out\extension.js      901.4kb
  out\extension.js.map    1.9mb

Done in 51ms
[esbuild] extension build complete → out/extension.js

  out\clangdProxy.js      257.5kb
  out\clangdProxy.js.map  502.9kb

Done in 17ms
[esbuild] proxy build complete → out/clangdProxy.js
[esbuild] launcher generated → out/launcher/proxy-launcher.bat

exit code: 0
```

## 执行轨迹

- `01-01` 是纯证据采集 plan，**未产生 atomic commit**（按 CONTEXT.md 决策 D-09 锁定）。
- `01-02` 唯一 commit 主题为 `chore(verify): record Wave 1 P0 verification evidence`，仅含 `01-VERIFICATION.md` 一个文件。

## 宪法 IV 例外声明

本 phase 引用宪法 IV "Verification Gates Before Delivery" 中关于 "when the required environment is available" 的措辞。本 phase 不触发 Windows UE 现场烟测，因本 phase 不涉及 build / clangd 行为变更（仅采集已闭环 task 引用 + 验证 4 门禁命令），与宪法 IV 触发条件（"build/clangd 行为变更"）不匹配。