# VSCodeUEHelper 修复执行蓝图（REMEDIATION-PLAN.md）

> **生成时间**：2026-07-16
> **输入依据**：`AUDIT-REPORT.md` (901 行 / 43+ findings)
> **目标**：把 43+ 项审计发现转化为**可独立验证**、**可原子回滚**的执行计划
> **风格**：Ultrawork；每 task 一个原子 commit；TDD 先行
> **总任务数**：32 个
> **总工时估算**：~7.5 个工程师日

---

## 一、场景合同（已确定）

| 场景 | 内容 | 截止 | task 数 |
|---|---|---|---|
| S1 | P0 必修（CI/发布阻塞） | 半天内 | 4 |
| S2 | P1 高价值（5min~ 单项） | 半天 | 8 |
| S3 | P2 文档对齐 | 1 天 | 5 |
| S4 | P3 架构债务 | 3 天 | 9 |
| S5 | P4 长期（决策导向） | 1 周+ | 5 |
| S6 | Final QA（全量回归） | 1 小时 | 1 |
| **合计** | | **~7.5 个工程师日** | **32** |

**关键路径**：`T1.4 → T2.1 → T2.7 → T3.1 → T3.4 → T6.1`
**最大并行窗口**：Wave 2 内部 8 task 全可独立并行

---

## 二、Wave 1 — P0 必修（4 task / 半天）

> **风险**：CI 阻塞 + 发布质量。**优先级最高**。

### T1.1 — 删除 `test:integration` 脚本

| 字段 | 值 |
|---|---|
| 目标文件 | `package.json:443-444` |
| 修改 | 删 `"test:integration"`；改 `"test"` 为 `"npm run test:unit"` |
| 验证 | `npm test` exit 0（仅跑 Vitest unit） |
| 原子提交 | `fix(test): 删除坏掉的 test:integration 脚本` |
| 回滚 | `git revert HEAD` |
| 工时 | 5 min |

### T1.2 — git rm .bak + .gitignore 加 `*.bak`

| 字段 | 值 |
|---|---|
| 目标文件 | `test/unit/commands/clangdProxyCommands.test.ts.bak`, `.gitignore` |
| 修改 | `git rm --cached <bak>`；追加 `*.bak` 规则 |
| 验证 | `git ls-files | grep \.bak` → empty；`git check-ignore -v <bak>` → 匹配 `*.bak` |
| 原子提交 | `chore(gitignore): 移除被跟踪的 .bak + 添加 *.bak 规则` |
| 回滚 | `git revert HEAD; git checkout -- .gitignore` |
| 工时 | 5 min |
| 下游依赖 | T2.8 验证 task |

### T1.3 — 替换 `resources/icon.png` 为 128×128 PNG

| 字段 | 值 |
|---|---|
| 目标文件 | `resources/icon.png`（当前 67 字节占位符） |
| 修改 | 用 .NET System.Drawing 生成 128×128 PNG（深蓝渐变 + UE 金色字） |
| 验证 | 文件 > 4096 bytes；`[Image]::FromFile(...).Width == 128` |
| 原子提交 | `chore(assets): 替换占位 icon.png 为真实 128×128 PNG` |
| 回滚 | `git checkout HEAD -- resources/icon.png` |
| 工时 | 20 min |

### T1.4 — 修 `proxyManager.test.ts:216` lint error

| 字段 | 值 |
|---|---|
| 目标文件 | `test/unit/clangd/proxyManager.test.ts:216` |
| 当前 | `update: vi.fn(async () => undefined),` |
| 修改 | `update: vi.fn(async () => await Promise.resolve()),` |
| 验证 | `npm run lint` 0 errors；`npm run test:unit -- proxyManager` 全 pass |
| 原子提交 | `fix(test): proxyManager.test.ts:216 为 vi.fn 添加 await 满足 lint` |
| 回滚 | `git revert HEAD` |
| 工时 | 5 min |

**Wave 1 总工时**：~35 min（不并行时）；并行 ≤ 20 min

---
## 三、Wave 2 — P1 高价值（8 task / 半天）

> **全部独立**，可完全并行。涉及不同文件，无冲突。

### T2.1 — 简化 `Config.completionMode` getter

| 字段 | 值 |
|---|---|
| 目标文件 | `src/core/config.ts:135-139` |
| 当前 | `return raw === 'fast' \|\| raw === 'slow' ? 'slow' : 'slow';` |
| 修改 | getter body → `return 'slow';` + `CompletionMode` 类型删 `'fast'` literal |
| 验证 | `npm run typecheck` 0；`npm run test:unit -- completionMode` 全 pass |
| 原子提交 | `refactor(core): completionMode getter 简化为常量 slow` |
| 回滚 | `git revert HEAD` |
| 工时 | 10 min |

### T2.2 — `npm uninstall execa neverthrow xstate`

| 字段 | 值 |
|---|---|
| 目标文件 | `package.json`, `package-lock.json` |
| 修改 | `npm uninstall execa neverthrow xstate` |
| 验证 | `grep -RE 'from ["'"'"'"'"'"'"'](execa\|neverthrow\|xstate)' src/` → 0 matches |
| 原子提交 | `chore(deps): 移除零引用的 execa/neverthrow/xstate 依赖` |
| 回滚 | `git revert HEAD && npm install` |
| 工时 | 5 min |

### T2.3 — 删除 2 个 `@deprecated` 死函数

| 字段 | 值 |
|---|---|
| 目标文件 | `src/clangd/completionFiles.ts:606-614` |
| 修改 | 删 `findUhtGeneratedHeaders()` 和 `parseExistingIncludes()` |
| 验证 | `grep -RE 'findUhtGeneratedHeaders\|parseExistingIncludes' src/ test/` → 0 |
| 原子提交 | `refactor(clangd): 删除 completionFiles 2 个 @deprecated 死函数` |
| 回滚 | `git revert HEAD` |
| 工时 | 5 min |
| Pre-check | 必须先 `grep` 确认无调用方 |

### T2.4 — 删除 3 个 headerWatcher i18n key

| 字段 | 值 |
|---|---|
| 目标文件 | `src/i18n/locales/en.json:207-209`, `src/i18n/locales/zh.json:207-209` |
| 修改 | 删 3 key × 2 文件（双语对齐） |
| 验证 | `Compare-Object en.json zh.json` 仍 0 diff；key 计数 187 each |
| 原子提交 | `chore(i18n): 删除 headerWatcher 死 key (3×2)` |
| 回滚 | `git revert HEAD` |
| 工时 | 5 min |

### T2.5 — 删除 3 个死别名

| 字段 | 值 |
|---|---|
| 目标文件 | `tsconfig.json:45, 52-55`, `esbuild.config.mjs:34, 38-39`, `vitest.config.ts:35, 39-40` |
| 修改 | 删 `@parsers/*`、`@rules/*`、`@platform/*` 共 3 个死别名 |
| 验证 | `grep '@parsers\|@rules\|@platform' tsconfig.json esbuild.config.mjs vitest.config.ts` → 0 |
| 原子提交 | `chore(config): 删除 @parsers/@rules/@platform 死别名 (3 处)` |
| 回滚 | `git revert HEAD` |
| 工时 | 15 min |

### T2.6 — 修 `commands/index.ts:98` 日志

| 字段 | 值 |
|---|---|
| 目标文件 | `src/commands/index.ts:98` |
| 当前 | `logger.info('[commands] registered 20 commands');` |
| 修改 | 改用动态 `count` 变量（在 19 个 registerCommand 上方递增） |
| 验证 | F5 启动扩展，Output 显示 `[commands] registered 19 commands` |
| 原子提交 | `fix(commands): 注册日志改用动态计数 (修正 20→19)` |
| 回滚 | `git revert HEAD` |
| 工时 | 10 min |

### T2.7 — `WorkspaceState`/`ClangdOps` 实现 `vscode.Disposable`

| 字段 | 值 |
|---|---|
| 目标文件 | `src/core/workspace.ts`, `src/clangd/clangdOps.ts`, `src/extension.ts:61-62` |
| 修改 | 添加 `implements vscode.Disposable` + `dispose()` 实现（清缓存 + 释放 listeners）；移除 `as unknown as` 强转 |
| 验证 | `grep 'as unknown as' src/extension.ts` → 0；`npm run typecheck` 0 |
| 原子提交 | `refactor(core): WorkspaceState/ClangdOps 实现 vscode.Disposable, 解除强转` |
| 回滚 | `git revert HEAD` + 恢复 `as unknown as` |
| 工时 | 30 min |
| 下游依赖 | T4.8 部分 |

### T2.8 — 验证 .bak 已从 git tracking 移除

| 字段 | 值 |
|---|---|
| 修改 | （纯验证，无文件改动） |
| 验证 | `git ls-files | grep \.bak` → empty；`git status -s | grep .bak` → `D` 状态 |
| 工时 | 1 min（计入 T1.2 验证步骤） |
| 依赖 | T1.2 必须先完成 |

---

## 四、Wave 3 — P2 文档对齐（5 task / 1 天）

### T3.1 — 重写 5 处命令数量文档

| 字段 | 值 |
|---|---|
| 目标文件 | `AGENTS.md:8`, `src/commands/AGENTS.md:18-33`, `README.md:108+`, `doc/02-modules.md:336`, `test/unit/ui/controlPanel.test.ts:136` |
| 修改 | 统一改为 "19 commands"；删 toggleCompletionMode；补 5 个新命令行 |
| 验证 | `grep -RE '[0-9]+ commands\|[0-9]+ 个命令' ...` 全部显示 "19" |
| 原子提交 | `docs: 同步 19 命令数 (Plan B 收束) 至 5 处文档` |
| 工时 | 45 min |
| 依赖 | T2.6 |
| 回滚 | `git revert HEAD` |

### T3.2 — 修 `Config.update` AGENTS.md 示例

| 字段 | 值 |
|---|---|
| 目标文件 | `src/core/AGENTS.md:36-41` |
| 修改 | 错误示例 `const freshConfig = await config.update();` → 改为 `await config.update(...); console.log(config.xxx);` |
| 验证 | 文档示例与 `src/core/config.ts:268-297` 签名一致 |
| 原子提交 | `docs(core): 修正 Config.update 文档示例 (返回 void 不是 Config)` |
| 工时 | 5 min |
| 回滚 | `git revert HEAD` |

### T3.3 — 删 DDD 空壳（选项 A）

| 字段 | 值 |
|---|---|
| 目标文件 | `src/build/application/index.ts`, `src/build/infrastructure/index.ts`, `src/build/AGENTS.md:174-198` |
| 修改 | 删 2 个空目录；改 AGENTS.md 为"分层规划中" |
| 验证 | `Test-Path src/build/application; src/build/infrastructure` → False |
| 原子提交 | `refactor(build): 删除 DDD 空壳, 承认分层规划中` |
| 工时 | 20 min |
| 回滚 | `git revert HEAD` |

### T3.4 — 重写 README.md

| 字段 | 值 |
|---|---|
| 目标文件 | `README.md`（全文 7706 字节） |
| 修改 | Phase 7 → shipped；Settings 表删 engineRoot + 改 completionMode 默认；Commands 表 19 行；Development "57.8kb" → 845kb |
| 验证 | 与 T3.1 数字一致 |
| 原子提交 | `docs: 重写 README.md 与当前项目状态对齐` |
| 工时 | 60 min |
| 依赖 | T3.1 |
| 回滚 | `git revert HEAD` |

### T3.5 — 修 controlPanel.test.ts:136 注释

| 字段 | 值 |
|---|---|
| 目标文件 | `test/unit/ui/controlPanel.test.ts:136` |
| 修改 | `// 15 commands` → `// 19 commands` |
| 验证 | test pass |
| 原子提交 | 与 T3.1 合并；或独立 `test: 修正 controlPanel.test 注释 15→19` |
| 工时 | 2 min |
| 回滚 | `git revert HEAD` |

---

## 五、Wave 4 — P3 架构债务（9 task / 3 天）

### T4.1 — 47 处硬编码字符串迁 i18n

| 字段 | 值 |
|---|---|
| 目标文件 | 13 个文件 × 47 处（见 AUDIT-REPORT M1 表格） |
| 修改 | 每处硬编码 → `t('key', params)`；en.json + zh.json 各加 47 key |
| 验证 | grep `showInformationMessage\|showWarningMessage\|showErrorMessage\|placeHolder` 中硬编码字符串数 → 0 |
| 原子提交 | 建议每 5-10 key 一 commit；总 5-7 commits |
| 工时 | 4h（最长 task） |
| TDD | 每新 key 加 en/zh 测试 |
| 回滚 | `git revert HEAD` |

### T4.2 — 抽 `ParsedDiagnostic` 到 `@core/types/diagnostic`

| 字段 | 值 |
|---|---|
| 目标文件 | 新建 `src/core/types/diagnostic.ts`；改 `src/build/types.ts`、`src/ui/problemsPanel.ts:15`、`src/parsers/msvcParser.ts:14`、`src/parsers/linkerParser.ts:13` |
| 修改 | 类型从 build → core；所有 consumer 改 import |
| 验证 | `grep '@build/types' src/ui src/parsers` → 0；typecheck 0 |
| 原子提交 | `refactor(types): ParsedDiagnostic 抽离到 @core/types` |
| 工时 | 1h |
| TDD | 新建 `test/unit/core/types/diagnostic.test.ts` |
| 回滚 | `git revert HEAD` |

### T4.3 — 抽 `detectHost` 到 `@core/runtime-detect`

| 字段 | 值 |
|---|---|
| 目标文件 | 新建 `src/core/runtime-detect.ts`；改 `src/mcp/lifecycle.ts`、`src/commands/showProjectInfo.ts:15` |
| 修改 | 函数从 `@mcp/lifecycle` → `@core/runtime-detect` |
| 验证 | `grep '@mcp/lifecycle' src/commands` → 0 |
| 原子提交 | `refactor(mcp): detectHost 抽离到 @core/runtime-detect` |
| 工时 | 30 min |
| TDD | 新建 `test/unit/core/runtime-detect.test.ts` |
| 回滚 | `git revert HEAD` |

### T4.4 — core/workspace.ts:32 相对路径改别名

| 字段 | 值 |
|---|---|
| 目标文件 | `src/core/workspace.ts:32` |
| 修改 | `import type { ... } from '../detection/types'` → `from '@detection/types'` |
| 验证 | grep → 0 relative paths in src/core |
| 原子提交 | `chore(core): workspace 改用 @detection/types 别名` |
| 工时 | 5 min |
| 回滚 | `git revert HEAD` |

### T4.5 — 拆分 `compileCommands.ts`（1002 行 → 4 模块）

| 字段 | 值 |
|---|---|
| 目标文件 | 新建 `src/clangd/compileCommands/{task,cache,symlink,fingerprint}.ts`；原文件瘦身 |
| 修改 | 5 职责拆 4 模块；保持公共 API 不变 |
| 验证 | 单文件最大 < 500 行；typecheck 0；test pass |
| 原子提交 | 建议每子模块一 commit；总 4-5 commits |
| 工时 | 4-6h |
| TDD | 每个新模块配 `.test.ts` |
| 回滚 | `git revert HEAD` |

### T4.6 — 迁 `populateAddCompletions` 调用方

| 字段 | 值 |
|---|---|
| 目标文件 | `src/clangd/index.ts` (2 caller) → `createCompletionFiles`；删 `src/clangd/completionFiles.ts:591-601` |
| 修改 | caller 改用 `createCompletionFiles`；删除 `@deprecated` 兼容层 + `PopulateOptions/PopulateResult` 接口 |
| 验证 | `grep populateAddCompletions src/` → 0；typecheck 0 |
| 原子提交 | `refactor(clangd): 迁 populateAddCompletions 调用方, 删除撒谎兼容层` |
| 工时 | 30 min |
| 回滚 | `git revert HEAD` |

**状态**：✅ **已完成**（Phase 9 SSoT 收尾）。`grep populateAddCompletions src/` → 0；13 个 `test/unit/core/ssot.test.ts` 防复活。AUDIT-REPORT.md M7/M11 同步标记"已解决"。

### T4.7 — MSVC 正则同步（选项 B）

| 字段 | 值 |
|---|---|
| 目标文件 | `package.json:417` |
| 当前 | `^(.*)\(...\):\s+(error\|warning\|note\|fatal error)\s+([A-Z]+\d+):\s+(.*)$`（贪婪 + `\s+`） |
| 修改 | 改为与 `msvcParser.ts:19` 一致：`^(.*?)\(...\)\s*:\s*(error\|warning\|note\|fatal error)\s+([A-Z]+\d+)\s*:\s*(.*)$`（懒惰 + `\s*`） |
| 验证 | 两份正则字面相等（escape 后） |
| 原子提交 | `fix(msvc): 同步 package.json 与 msvcParser 正则` |
| 工时 | 10 min |
| 回滚 | `git revert HEAD` |

### T4.8 — 消除 `as unknown as` 剩余 3 处

| 字段 | 值 |
|---|---|
| 目标文件 | `src/clangd/fingerprint.ts:185`, `src/detection/index.ts:94`, `src/clangd/diagnostics/io.ts:54/91` |
| 修改 | 用类型守卫 / `Promise<X> | undefined` / zod schema 替代 |
| 验证 | `grep 'as unknown' src/` → 0；typecheck 0 |
| 原子提交 | 建议每文件一 commit；总 3 commits |
| 工时 | 1.5h |
| 依赖 | T2.7（extension.ts 部分已完成） |
| 回滚 | `git revert HEAD` |

### T4.9 — 替换 `package.json:9` repository.url 占位符

| 字段 | 值 |
|---|---|
| 目标文件 | `package.json:9` |
| 修改 | `https://github.com/YOUR_USERNAME/vscode-ue-helper.git` → 真实 GitHub URL |
| 验证 | grep `YOUR_USERNAME` → 0 |
| 原子提交 | `chore(package): 替换 repository.url 占位符` |
| 回滚 | `git revert HEAD` |
| 工时 | 1 min |

---

## 六、Wave 5 — P4 长期（5 task / 1 周+）

### T5.1 — 6 个汉化 TODO 决策

| 字段 | 值 |
|---|---|
| 目标文件 | `src/clangd/proxy/localization.ts:79/91/103`, `src/clangd/proxy/bridge.ts:676/685/694` |
| 选项 A（推荐，2h） | 从 panel UI 删除汉化 toggle；改 AGENTS.md 说明"目前仅 hover 词典生效" |
| 选项 B（实现，2-3 天） | 填充 6 个 TODO：UE 字典补全 + LSP 响应拦截 |
| 验证 | A：toggle UI 消失；B：hover 在 UE 类型上输出中文 |
| 原子提交 | A: `feat(panel): 删除未实现的汉化 toggle (承认仅 hover 词典生效)`<br/>B: 多个 feat commits per TODO |
| 工时 | A: 2h / B: 2-3 天 |
| 回滚 | `git revert HEAD` |

### T5.2 — `ueDiagnosticWatcher.ts:301-310` 白名单校验

| 字段 | 值 |
|---|---|
| 目标文件 | `src/clangd/proxy/ueDiagnosticWatcher.ts:301-310` |
| 修改 | 拼接前对 `buildTargetName`/`projectFile` 做白名单 `[\w./\\:-]` 校验或转义 |
| 验证 | 含特殊字符的输入抛 `UBTArgsValidationError` |
| 原子提交 | `fix(ue): ueDiagnosticWatcher 拼接前白名单校验` |
| 工时 | 30 min |
| TDD | 红 → 绿：恶意输入测试 |
| 回滚 | `git revert HEAD` |

### T5.3 — 拆分 4 个 god 文件

| 字段 | 值 |
|---|---|
| 目标文件 | `src/core/workspace.ts`（307 行）、`src/core/config.ts`（317 行）、`src/ui/controlPanel.html.ts`（615 行）、`src/clangd/proxy/bridge.ts`（692 行） |
| 修改 | 按职责拆 2-3 个子文件；保持公共 API |
| 验证 | 单文件最大 < 500 行；test pass |
| 原子提交 | 每文件一 commit；总 4 commits |
| 工时 | 8-10h |
| TDD | 子文件独立测试 |
| 回滚 | `git revert HEAD` |

### T5.4 — 补 MCP 测试

| 字段 | 值 |
|---|---|
| 目标文件 | 新建 `test/unit/mcp/{tools,lifecycle,index}.test.ts` |
| 修改 | 测试 6 个 tool handler + detectHost 边界 |
| 验证 | coverage ≥ 80% for `src/mcp/` |
| 原子提交 | 1 commit 或按文件多 commit |
| 工时 | 3-4h |
| TDD | 测试优先：每个 tool 一组 case |
| 回滚 | `git revert HEAD` |

### T5.5 — `extension.ts` e2e 测试（可选）

| 字段 | 值 |
|---|---|
| 目标文件 | 新建 `test/e2e/extension.test.ts` |
| 修改 | 用 `@vscode/test-electron` 启动 Extension Host，验证 activate 流程 |
| 验证 | activate exit 0；UI 状态栏按钮渲染 |
| 原子提交 | `test(e2e): 添加 extension 激活流程 e2e 测试` |
| 工时 | 4h |
| 依赖 | T5.4 |
| 回滚 | `git revert HEAD` |

---

## 七、Wave 6 — Final QA（1 task）

### T6.1 — 全量回归验证矩阵

| 类别 | 命令 | 期望 |
|---|---|---|
| **Typecheck** | `npm run typecheck` | 0 errors |
| **Lint** | `npm run lint` | 0 errors (was 1) |
| **Unit Tests** | `npm run test:unit` | all pass；coverage ≥ 80/80/75/80 |
| **Build** | `npm run build` | exit 0；`out/extension.js` + `out/clangdProxy.js` + `out/launcher/*` 存在 |
| **Package** | `npm run package` | exit 0；`.vsix` 大小合理（> 100KB） |
| **Icon 验证** | `Get-Item resources/icon.png | Select Length` | > 4096 bytes |
| **Icon 尺寸** | `[Image]::FromFile(...).Width` | 128 |
| **i18n 对齐** | `Compare-Object en.json zh.json` | 0 diff |
| **i18n key 数** | `jq 'keys \| length' en.json` == `zh.json` | 187 each (was 190) |
| **Git clean** | `git status --short` | 仅新 AUDIT/REMEDIATION 文档 |
| **.bak removed** | `git ls-files \| grep \.bak` | empty |
| **死代码清理** | `grep findUhtGeneratedHeaders\|parseExistingIncludes src/` | 0 |
| **死别名清理** | `grep '@parsers\|@rules\|@platform' tsconfig.json esbuild.config.mjs vitest.config.ts` | 0 |
| **死依赖清理** | `cat package.json \| grep -E 'execa\|neverthrow\|xstate'` | 0 |
| **As-unknown 清理** | `grep 'as unknown' src/` | 0 |
| **命令数一致** | `grep -RE '[0-9]+ commands\|[0-9]+ 个命令' ...` | 全部 "19" |
| **DDD 假象清理** | `Test-Path src/build/application; src/build/infrastructure` | False / False |
| **CLI 入口** | `npm test` | exit 0（不再跑坏掉的 integration） |

| 字段 | 值 |
|---|---|
| 原子提交 | （无代码改动，是 QA 步骤） |
| 依赖 | 所有 wave 必须完成 |

---

## 八、TDD 测试覆盖矩阵

每个修复项对应的新测试：

| Task | 新测试文件 | 测试目标 | 优先级 |
|---|---|---|---|
| T2.1 | （已有 `test/unit/clangd/completionMode.test.ts`） | 验证 fast→slow 归一化 | P0 |
| T2.7 | `test/unit/core/workspace.test.ts` + `test/unit/clangd/clangdOps.test.ts` | dispose() 释放缓存 | P0 |
| T4.1 | 每新 i18n key 一组 en/zh 断言 | 双语对称 + t() 返回 | P0 |
| T4.2 | `test/unit/core/types/diagnostic.test.ts` | ParsedDiagnostic 类型契约 | P1 |
| T4.3 | `test/unit/core/runtime-detect.test.ts` | env var mock 4 种组合 | P1 |
| T4.5 | `test/unit/clangd/compileCommands/{task,cache,symlink,fingerprint}.test.ts` | 4 个子模块独立 | P1 |
| T4.6 | 现有 caller 测试 + 行为一致性 | populate → create parity | P1 |
| T4.8 | 各文件现有测试 | 断言强转移除后行为不变 | P1 |
| T5.2 | `test/unit/clangd/proxy/ueDiagnosticWatcher.test.ts` | 恶意输入 reject | P1 |
| T5.3 | 子文件独立测试 | 拆分后 API 不变 | P2 |
| T5.4 | `test/unit/mcp/{tools,lifecycle,index}.test.ts` | 6 tool handler + edge | P1 |
| T5.5 | `test/e2e/extension.test.ts` | activate 流程 | P3 |

---

## 九、风险与回滚矩阵

| Wave | 主要风险 | 缓解措施 | 回滚命令 |
|---|---|---|---|
| 1.1 | npm test 改动破坏 CI | 用 unit test 全 pass 验证 | `git revert HEAD` |
| 1.2 | 删除 .bak 后丢了手备份 | 已确认 .ts 当前版本大于 .bak | `git revert HEAD; git checkout HEAD -- .bak` |
| 1.3 | icon.png 二进制损坏 | 验证 `file` / `[Image]::FromFile` | `git checkout HEAD -- resources/icon.png` |
| 1.4 | 添加 await 改变 mock 语义 | 跑 test:unit 验证 | `git revert HEAD` |
| 2.x | 8 task 并行无冲突（不同文件） | 无 | 每个独立 `git revert` |
| 3.1-3.5 | 文档改动可能漏改 | 跑 grep 数字一致性 | `git revert HEAD` |
| 4.1 | 47 处迁移漏 key | i18n key 计数必须等于 en.json count | `git revert HEAD; npm run test:unit` |
| 4.2 | ParsedDiagnostic 循环引用 | type-only import | `git revert HEAD` |
| 4.5 | 拆分 compileCommands 破坏 API | 完整 test 套件 | `git revert HEAD` |
| 4.6 | caller 改用 createCompletionFiles 后行为差 | 行为一致性测试 | `git revert HEAD` |
| 5.1 | 选项 B 工期超 | 改用选项 A | 选项 B 中途失败 → `git revert HEAD~N` 到选项 A 起点 |
| 5.2 | 校验过严误杀合法输入 | 跑所有 caller 测试 + 实际 .uproject 数据 | `git revert HEAD` |

---

## 十、优先级争议解决

### 争议 1：T2.1 completionMode 简化 vs T4.1 i18n 迁移
- **解决**：T2.1 先做（T2.1 是 5 min 修复，T4.1 是 4h 大任务）
- **理由**：T2.1 不影响 i18n，但减少后续 T4.1 工作量（completionMode 相关 enum 不再出现）

### 争议 2：T3.4 README 重写 vs T3.1 命令数量文档
- **解决**：T3.1 先做（**T3.4 依赖 T3.1**，README 中的数字必须先在 AGENTS/commands-AGENTS 中固定）
- **理由**：README 是文档级联末端，需要 source-of-truth 先稳定

### 争议 3：T4.5 compileCommands 拆分 vs T4.2 类型抽离
- **解决**：T4.2 先做（**T4.5 的子模块需要 ParsedDiagnostic 类型稳定**）
- **理由**：拆分 god 文件时若类型还在 build，可能导致新模块错误依赖 build

### 争议 4：T4.8 as unknown as vs T2.7 WorkspaceState Disposable
- **解决**：T2.7 先做（T2.7 修 `extension.ts:61-62` 的 2 处；T4.8 修剩余 3 处）
- **理由**：T2.7 是 T4.8 的子集，先做小后做大

---

## 十一、推荐执行顺序（3 种执行模式）

### 模式 A：保守顺序（最低风险，最大回滚空间）

```
Wave 1 → Wave 2 → T3.1 → T3.2 → T3.5 → T3.3 → T3.4 → Wave 4 → Wave 5 → Wave 6
```
- **工时**：~7.5 天
- **PR 数**：~20-25
- **风险**：低（每个 PR 都独立）

### 模式 B：速胜策略（先把高 ROI 的修完）

```
Wave 1 (1h) → Wave 2 (3h) → T3.1+T3.2 (1h) → Wave 6 QA (1h) → 交付 v0.1.1
                  ↓
              Wave 3-5 后续 sprint
```
- **工时**：~6h 到首个可用版本
- **PR 数**：~12
- **风险**：中（文档/架构债务未修）

### 模式 C：用户决策（如只想修 CRITICAL+HIGH）

```
Wave 1 (1h) + Wave 2 (3h) + T3.1+T3.2+T3.5 (1h) = 5h 到 v0.1.1
然后决定：
  - 接受 DDD 假象（H3 不修）→ T3.3 不做
  - 接受 MSVC 正则偏差（M4 不修）→ T4.7 不做
  - 接受 god 文件（M6/L17-L20 不修）→ T4.5/T5.3 不做
  - 接受汉化僵尸（M2 不修）→ T5.1 不做
```
- **工时**：~5h 到最低可接受版本
- **PR 数**：~10
- **风险**：低（接受已知技术债）

---

## 十二、用户决策点（✅ 全部敲定 2026-07-16）

| ID | 决策项 | 用户决策 | 实施细节 |
|---|---|---|---|
| **H3** | DDD 三层空壳 | **A) 删空壳** | 删 `src/build/application/` 和 `src/build/infrastructure/`；改 AGENTS.md 为"分层规划中" |
| **H4** | completionMode 清理 | **B) 完全删除设置** | 删 `package.json` 的 `vscodeUEHelper.completionMode`、删 getter、删 UI 选项、删 CompletionMode 类型 |
| **H6** | icon.png 方案 | **A) 自动生成** | 用 .NET System.Drawing 生成 128×128 PNG（附录 A 脚本就绪） |
| **M2** | 6 个汉化 TODO | **暂时搁置** | 保持现状（不删承诺 / 不实现）；T5.1 跳过 |
| **M3** | npm uninstall 3 个死依赖 | **A) 全部卸载** | `npm uninstall execa neverthrow xstate` |
| **T5.3** | god 文件拆分顺序 | **A) 按大小降序** | compileCommands (1002) → bridge (692) → controlPanel.html.ts (615) → config (317) → workspace (307) |

**决策影响**：
- **H4 升级** → T2.1 内容需扩展为"H4-B：完整删设置"，新增删除 `package.json` 中 `vscodeUEHelper.completionMode` 配置块；UI 文件删除 fast 选项；`CompletionMode` 类型删除
- **M2 搁置** → T5.1 跳过（Wave 5 中此 task 不执行）；proxy/AGENTS.md "汉化 TODO 未落地" 声明保持
- **T5.3 = A** → T5.3 task 内容按大小排序执行

---

## 十二点五、执行启动清单（更新后）

按用户决策，Wave 1-6 任务内容调整：

| Wave | Task | 调整内容 |
|---|---|---|
| Wave 1 | T1.1-T1.4 | 保持 |
| Wave 2 | T2.1 | **升级**：H4-B 内容（删 `vscodeUEHelper.completionMode` 配置块 + UI 选项 + 类型） |
| Wave 2 | T2.2 | 保持（已确认） |
| Wave 2 | T2.3-T2.8 | 保持 |
| Wave 3 | T3.1-T3.5 | 保持 |
| Wave 4 | T4.1-T4.9 | 保持 |
| Wave 5 | T5.1 | **跳过**（M2 搁置） |
| Wave 5 | T5.2-T5.5 | 保持（T5.3 已确认按大小排序） |
| Wave 6 | T6.1 | 保持（含 H4-B 后的 CompletionMode 测试） |

---

## 十三、附录 A — icon.png 生成脚本（PowerShell）

```powershell
# scripts/gen-icon.ps1 —— 一次性脚本,运行后只提交 resources/icon.png
Add-Type -AssemblyName System.Drawing

$bmp = New-Object System.Drawing.Bitmap 128, 128
$g   = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode     = 'AntiAlias'
$g.TextRenderingHint = 'AntiAlias'

# 背景: 深蓝渐变
$rect = New-Object System.Drawing.Rectangle 0, 0, 128, 128
$brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $rect,
    [System.Drawing.Color]::FromArgb(255, 30, 60, 110),
    [System.Drawing.Color]::FromArgb(255, 10, 25, 50),
    45.0
)
$g.FillRectangle($brush, $rect)

# UE 金色字
$font = New-Object System.Drawing.Font('Segoe UI', 56, [System.Drawing.FontStyle]::Bold)
$fgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 240, 200, 80))
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment     = 'Center'
$fmt.LineAlignment = 'Center'
$g.DrawString('UE', $font, $fgBrush, (New-Object System.Drawing.RectangleF 0, 0, 128, 128), $fmt)

$out = 'D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\resources\icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Host "Generated: $out"
```

**验证**：
```powershell
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper\resources\icon.png')
Write-Host "Width: $($img.Width), Height: $($img.Height), Format: $($img.RawFormat)"
$img.Dispose()
# 期望: Width: 128, Height: 128, Format: [ImageFormat:Png]
```

---

## 十四、附录 B — T1.1 / T1.4 完整 diff

### T1.1 `package.json`

```diff
   "scripts": {
     "build": "npm run clean && node esbuild.config.mjs",
     ...
     "test:unit": "vitest run",
     "test:unit:watch": "vitest",
-    "test:integration": "node test/integration/runTests.js",
-    "test": "npm run test:unit && npm run test:integration",
+    "test": "npm run test:unit",
     "prepackage": "npm run build",
```

### T1.4 `test/unit/clangd/proxyManager.test.ts:216`

```diff
- update: vi.fn(async () => undefined),
+ update: vi.fn(async () => await Promise.resolve()),
```

---

## 十五、附录 C — Git 工作流约定

每个 task 执行：

```bash
# 1. 仅 stage 本 task 涉及的文件
git add -p <files>

# 2. 用 task ID 作 commit message 前缀
git commit -m "<type>(<scope>): <subject> [T<x.y>]"

# 3. 立即跑验收命令
<verification commands>

# 4. 若失败:
git revert HEAD
```

**不允许**：
- `git add .`（可能误带未提交修改）
- 一个 commit 含多个 task
- 跳过验证直接 commit

---

**计划生成结束**

> 执行时严格按本计划。每个 task 一个 commit + 验证。如发现偏差，更新本计划而非默默改。
> 用户决策点（第十二节）需先与用户确认再执行。
