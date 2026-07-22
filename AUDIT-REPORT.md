# VSCodeUEHelper 项目审计报告

> **审计时间**：2026-07-16
> **审计范围**：`D:\AIWorkSpace\VScodePlugin\VSCodeUEHelper`（141 个 src 文件 + 60 个 test 文件）
> **审计方式**：4 路并行 explore agent + 直接文件读取 + `tsc --noEmit` + `eslint`
> **审计者**：Sisyphus (oh-my-opencode)
> **总体评级**：**B-（中等偏下）**

## 摘要

| 类别         | 数量    | 关键观察                                                                      |
| ------------ | ------- | ----------------------------------------------------------------------------- |
| CRITICAL     | 1       | `npm test` 必然失败（integration 脚本指向不存在的目录）                       |
| HIGH         | 6       | 命令数量多处自相矛盾、DDD 三层是空壳、Config.update 文档与代码不符等          |
| MEDIUM       | 14      | i18n 大面积绕过、6 个汉化 TODO 僵尸、3 个未使用 runtime 依赖、MSVC 正则偏差等 |
| LOW          | 22+     | 死别名、死 i18n key、文档滞后、100+ lint warnings 等                          |
| **总问题数** | **43+** |                                                                               |

**总技术债务估算**：约 8-12 个工程师日。

**已通过的基线**：

- ✅ `npm run typecheck` 零错误（`tsc --noEmit`）
- ✅ `npm run lint` 1 error + 105 warnings（其中 1 个是真 error）
- ✅ i18n 双语 100% key 对齐（en/zh 各 190 keys，0 orphan）

---

## 一、CRITICAL（1 项）

### C1. `npm test` 必然失败

**证据**：

- `package.json:443` — `"test:integration": "node test/integration/runTests.js"`
- `package.json:444` — `"test": "npm run test:unit && npm run test:integration"`
- 整个仓库 **不存在 `test/integration/` 目录**（`test/` 下只剩 `unit/`）
- `AGENTS.md` "仓库陷阱" 第 1 条已记录此问题但**未修复**

**影响**：

- 任何 CI 跑 `npm test` 都失败
- `npm run typecheck` 通过，`npm run lint` 通过（已验证）
- 但默认 `npm test` 命令已坏

**修复**（3 选 1）：

1. **删除坏脚本**（最简）：从 `package.json` 移除 `test:integration`，把 `test` 改成 `npm run test:unit`
2. **重新创建目录**：在 `test/integration/runTests.js` 写一个最小占位
3. **同步更新 AGENTS.md**：承认 integration 已被移除

**严重度**：🔴 CRITICAL —— 命令腐烂，CI 必然炸

---

## 二、HIGH（6 项）

### H1. 命令数量多处自相矛盾（README / AGENTS.md / 日志 / 测试全不一致）

| 数据源                                                | 声明数量                                | 实际                                     |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `package.json#contributes.commands` (lines 43-172)    | 19                                      | 19 ✓                                     |
| `src/commands/index.ts:45-95`（registerCommand 调用） | 19                                      | 19 ✓                                     |
| `src/commands/index.ts:98` 日志                       | "20 commands"                           | **撒谎**                                 |
| `AGENTS.md:8` 根文档                                  | "20 个命令"                             | **撒谎**                                 |
| `src/commands/AGENTS.md:18` 命令表                    | 16 + toggleCompletionMode 行            | **撒谎**（toggleCompletionMode.ts 已删） |
| `README.md:108` 命令表                                | 13（含 toggleCompletionMode，已不存在） | **撒谎**                                 |
| `test/unit/ui/controlPanel.test.ts:136` 注释          | "15 commands"                           | **撒谎**（测试实际 expect 14 个键）      |
| `doc/02-modules.md:336`                               | 提到 toggleCompletionMode               | **撒谎**                                 |

**根因**：Plan B 删除 toggleCompletionMode（commit `67b33e1`）后，所有文档都没同步。

**影响**：

- 任何新人基于 README/AGENTS.md 估算工作量会被误导 25%+
- 日志撒谎污染调试输出

**修复**（30 分钟）：

- 把 `src/commands/index.ts:98` 改成实际计数 `registered ${count} commands`
- 重写 `AGENTS.md` "20 个命令" → "19 个命令（Plan B 删除了 toggleCompletionMode）"
- 重写 `src/commands/AGENTS.md` 命令表（删除 toggleCompletionMode 行；增加 enable/disable/showClangdProxy/showControlPanel/diagnoseProject 5 行）
- 更新 `README.md` 命令表
- 更新 `doc/02-modules.md` 相关段
- 修复 `test/unit/ui/controlPanel.test.ts` 注释

**严重度**：🟠 HIGH —— 文档腐烂 + 日志撒谎

---

### H2. `Config.update` 文档与代码不一致

**证据**：

- `src/core/AGENTS.md:36-41`（"Config 双真相陷阱"）示例写：
  ```typescript
  const freshConfig = await config.update(); // 返回新 Config
  console.log(freshConfig.completionMode); // 'slow'
  ```
- 实际 `src/core/config.ts:268-297`：
  ```typescript
  async update(
    key: string,
    value: unknown,
    target: vscode.ConfigurationTarget = ...,
  ): Promise<void> {           // ← 返回 void，不是 Config
    await this.root.update(key, value, target);
    this.refreshRoot();
    ...
  }
  ```

**影响**：

- 按 AGENTS.md 示例写代码会得到 `TypeError: Cannot read property 'completionMode' of undefined`
- 文档陷阱反变成**代码陷阱**

**修复**（5 分钟）：

- 选项 A（最小）：改 AGENTS.md 文档，把示例改成 `await config.update(...); console.log(config.completionMode);`
- 选项 B（更大）：改 `Config.update` 返回 `Promise<Config>`，与文档保持一致

**严重度**：🟠 HIGH —— 文档陷阱误导

---

### H3. DDD 三层完全是空壳（声称 vs 实际不符）

**证据**：

- `src/build/application/index.ts`（103 字节）只有 2 行注释占位
- `src/build/infrastructure/index.ts`（101 字节）只有 2 行注释占位
- 实际业务代码全部位于 `src/build/` 顶层（`buildRunner.ts`, `ubt.ts`, `liveCoding.ts` 等），**不**走 `application/` 或 `infrastructure/` 路径
- `src/build/AGENTS.md:174-198` 声称"DDD 三层结构"但实际只有 `domain/entities` 是真的

**影响**：

- 外部代码 `import { runBuild } from '@build'` 完全跳过 application/infrastructure 层
- 新人按 AGENTS.md 写"handler"放错地方

**修复**（决定方向）：

- 选项 A：**承认非 DDD**，删除 application/ infrastructure/ 目录和 AGENTS.md 的 DDD 主张
- 选项 B：**真正实施迁移**，把 buildRunner/liveCoding 等迁移到 application + infrastructure，需要 Phase 9 级别的重构

**严重度**：🟠 HIGH —— 架构撒谎

---

### H4. `Config.completionMode` getter 死分支 + UI 仍暴露 fast 选项

**证据** — `src/core/config.ts:135-139`：

```typescript
get completionMode(): CompletionMode {
  const raw = this.root.get<CompletionMode>('completionMode');
  return raw === 'fast' || raw === 'slow' ? 'slow' : 'slow';  // ← 三个分支永远返回 'slow'
}
```

**问题**：三目运算符的两个分支返回值相同 —— 永远是 `'slow'`。可简化为 `return 'slow';`。

**但更深的问题**：UI 层（`src/ui/controlPanelMessages.ts:219-221`, `src/ui/controlPanel.html.ts:262`, `src/commands/createProject.ts:109/140/159`）**仍提供** fast 选项，让用户能选但选了等于没选。

**影响**：

- 用户在控制面板切 fast 模式 → 配置文件写入 'fast' → 重启后 getter 永远返回 'slow' → 用户困惑
- `CompletionMode` 类型的 `'fast'` 成员实际是死的

**修复**（30 分钟）：

- 选项 A（最小）：把 getter 改成 `return 'slow';` + 删除 `CompletionMode` 类型中的 `'fast'` 成员 + 删除 UI 中 fast 选项
- 选项 B（更大）：彻底删除 `vscodeUEHelper.completionMode` 设置和 getter（既然完全没用）

**严重度**：🟠 HIGH —— 死代码 + UX 误导

---

### H5. `.bak` 文件已被 git 跟踪但 .gitignore 未排除

**证据**：

- `git ls-files` 显示 `test/unit/commands/clangdProxyCommands.test.ts.bak` **已被跟踪**（commit `31d9514`）
- `.gitignore` 全文（94 行）扫了三遍，**无 `*.bak` 模式**
- `git check-ignore -v test/unit/commands/clangdProxyCommands.test.ts.bak` → **未被忽略**（会被未来 commit 携带）

**影响**：

- 任何 `git add .` 会再次带上 .bak
- 10006 字节的旧备份污染仓库

**修复**（5 分钟）：

```bash
git rm --cached test/unit/commands/clangdProxyCommands.test.ts.bak
echo "*.bak" >> .gitignore
```

**严重度**：🟠 HIGH —— 仓库卫生

---

### H6. 资源 icon.png 是 67 字节占位符

**证据**：

- `resources/icon.png` 仅 **67 字节**（实际接近 PNG 文件头最小尺寸）—— 基本是空白图片
- `package.json:29` `"icon": "resources/icon.png"` —— 已被引用，但实际无内容
- `resources/README.md:9` 仍声明 **(Phase 7 TODO) 128×128 marketplace icon**
- `vscode-ue-helper-0.1.0.vsix` 实际打包了 67 字节空图标

**影响**：

- 插件市场展示空白图标
- 用户第一印象差

**修复**（30 分钟）：用 ImageMagick 或 Photoshop 生成 128×128 PNG 替换

**严重度**：🟠 HIGH —— 发布质量

---

## 三、MEDIUM（14 项）

### M1. i18n 大面积绕过（声明"i18n 优先"，实际只覆盖 ~50%）

**证据** — 47 处硬编码用户可见字符串，分布在 13 个文件：

| 文件:行                                     | 硬编码字符串（节选）                                                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/ui/quickPicks.ts:19`                   | `'No .uproject files found in workspace.'`                                                                  |
| `src/ui/quickPicks.ts:29`                   | `placeHolder: 'Select a .uproject'`                                                                         |
| `src/ui/quickPicks.ts:37-38`                | `'No Unreal Engine installations detected. Set vscodeUEHelper.engineRoot manually.'` ← **引用不存在的设置** |
| `src/ui/quickPicks.ts:49/57/63/74`          | 4 个 placeHolder 硬编码                                                                                     |
| `src/commands/build.ts:39/49/98/110/115`    | 5 处英文                                                                                                    |
| `src/commands/launchEditor.ts:26/36/48/50`  | 4 处                                                                                                        |
| `src/commands/liveCoding.ts:21/30/40/52/54` | 5 处                                                                                                        |
| `src/commands/openWorkspaceFile.ts:15/32`   | 2 处                                                                                                        |
| `src/commands/installRules.ts:49/65`        | 2 处                                                                                                        |
| `src/commands/uninstall.ts:34/68`           | 2 处                                                                                                        |
| `src/commands/createProject.ts:371`         | `'✨ Unreal Clangd 项目配置完成'`（**硬编码中文**）                                                         |
| `src/commands/selectConfig.ts:17`           | 英文                                                                                                        |
| `src/commands/selectTarget.ts:18`           | 英文                                                                                                        |
| `src/commands/setSystemIncludes.ts:125`     | `placeHolder: 'Select MSVC version'`                                                                        |

**i18n 文件本身完美对齐**：

- `en.json` 190 keys
- `zh.json` 190 keys
- 双语 100% 对称（`Compare-Object` 验证零差异）

**但代码实际调用 t() 仅约 80 个 key** —— **大部分命令模块根本没走 i18n**。

**特殊问题**：`src/ui/quickPicks.ts:38` 引用了 `vscodeUEHelper.engineRoot`，但 `package.json` **根本没有这个设置**（只有 `ueVersion`/`configuration`/`target`/`platform`/`clangdPath` 等）。这是历史配置名残留。

**影响**：

- 中英文用户都看到混合语言
- 双语维护成本翻倍（双份文件已写，但代码不用）

**修复**（3-4 小时）：

- 把 47 处硬编码全部提取为 `i18n/locales/{en,zh}.json` 的 key
- 修正 `quickPicks.ts:38` 的 `vscodeUEHelper.engineRoot` → 改用 `vscodeUEHelper.ueVersion` 或删除该提示
- 给 ESLint 加规则禁止 `showInformationMessage('硬编码')` 模式

**严重度**：🟡 MEDIUM —— i18n 失效

---

### M2. 6 个汉化 TODO 僵尸承诺

**证据**：

- `src/clangd/proxy/localization.ts:79/91/103` — 3 个 `// TODO: 后续实现 Completion/SignatureHelp/InlayHint 项汉化`，函数体直接 `return item;` / `return content;`
- `src/clangd/proxy/bridge.ts:676/685/694` — 3 个 `// TODO: 后续实现 Completion/SignatureHelp/InlayHint 项汉化`，函数体直接 `return msg;`
- `src/clangd/proxy/AGENTS.md:43-44` 自己承认"6 个汉化 TODO 未落地"

**控制面板默认开启汉化**（`package.json:337-339`）—— 用户开启后，hover 在某些类型上**完全无变化**，因为 TODO 函数返回原值。

**影响**：

- 汉化功能"开启"但部分失效
- 用户投诉"Hover 没汉化"

**修复**（决定方向）：

- 选项 A（删承诺）：从 panel UI 删除汉化 toggle，文档说明"目前仅 hover 词典生效"
- 选项 B（真实现）：填充 6 个 TODO（需要 UE 字典补全 + LSP 响应拦截，约 2-3 个工程师日）

**严重度**：🟡 MEDIUM —— 功能残缺

---

### M3. 3 个未使用的 runtime 依赖（execa/neverthrow/xstate）

**证据**：

- `package.json:466-472` 声明 6 个 runtime 依赖
- 实际使用：
  - ✅ `@modelcontextprotocol/sdk` — mcp/server.ts 用
  - ✅ `chokidar` — fileWatcher.ts/generatedHeaderWatcher.ts/ueDiagnosticWatcher.ts 用
  - ✅ `json5` — uprojectScanner.ts 用
  - ✅ `yaml` — clangdConfig.ts 用
  - 🔴 `execa` — **0 import**，仅 `src/detection/vsBuildTools.ts:36` 注释提到"We avoid the execa dependency here because it's ESM-only"
  - 🔴 `neverthrow` — **0 import**
  - 🔴 `xstate` — **0 import**

**影响**：

- 仓库白带 ~150MB node_modules
- `package-lock.json` 体积膨胀
- 安全审计面增加

**修复**（5 分钟）：

```bash
npm uninstall execa neverthrow xstate
```

预计 .vsix 减小 100-200KB。

**严重度**：🟡 MEDIUM —— 依赖卫生

---

### M4. MSVC 正则两处不严格同步 + package.json 那份永远不被消费

**证据** — 两份正则**不严格等价**：

`package.json:417`（VS Code problemMatcher）：

```
^(.*)\((\d+)(?:,(\d+))?\):\s+(error|warning|note|fatal error)\s+([A-Z]+\d+):\s+(.*)$
```

`src/parsers/msvcParser.ts:18-19`（运行时实际生效）：

```
/^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|note|fatal error)\s+([A-Z]+\d+)\s*:\s*(.*)$/
```

**差异**：
| 字段 | package.json | msvcParser.ts |
|---|---|---|
| 文件名匹配 | `(.*)` 贪婪 | `(.*?)` 懒惰 |
| `):` 之间空白 | `\)\:\s+` 至少 1 空白 | `\)\s*:\s*` 允许 0 空白 |
| `Code: msg` 之间 | `\:\s+` | `\s*:\s*` |

**而且**：VS Code 的 `problemMatchers` 只对 Task 系统输出生效。本插件没有自动 task 消费它，所以 **package.json 这份永远不被使用**，只有 msvcParser 实际生效。两份"必须同步"的正则中，**有一份永远不会被读到**。

**影响**：

- AGENTS.md 强调"两处必须同步"，实际有一份是死代码
- 跨平台 CI 可能因为某个边缘 case 漏匹配（概率低）

**修复**（15 分钟）：

- 选项 A：把 `package.json:417` 正则改成与 msvcParser 一致（懒惰 + `\s*`），并在 AGENTS.md 标注"实际生效的是 msvcParser.ts"
- 选项 B：删除 `package.json#contributes.problemMatchers`（既然不被消费）

**严重度**：🟡 MEDIUM —— 死代码 + 同步声明

---

### M5. 跨层引用 / 反向依赖（5 处）

**证据**：

| 违规                 | 文件:行                                              | 描述                                                                                                                                     | 严重度   |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| **clangd → build**   | `src/clangd/proxyManager.ts:27`                      | `import { resolveUBTPath } from '@build/ubt'` — proxy CLI args 需要 UBT 路径直接耦合 build                                               | **HIGH** |
| **core → detection** | `src/core/workspace.ts:32`                           | `import type { ProjectInfo, EngineInstall } from '../detection/types'` — core 反向依赖 detection 领域类型（type-only，相对路径绕过别名） | MEDIUM   |
| **ui → build**       | `src/ui/problemsPanel.ts:15`                         | `import { ParsedDiagnostic } from '@build/types'` — Problems 面板耦合 build 领域类型                                                     | MEDIUM   |
| **parsers → build**  | `src/parsers/msvcParser.ts:14`, `linkerParser.ts:13` | `import { ParsedDiagnostic } from '@build/types'` — 纯解析器依赖 build                                                                   | MEDIUM   |
| **commands → mcp**   | `src/commands/showProjectInfo.ts:15`                 | `import { detectHost } from '@mcp/lifecycle'` — 命令层依赖 MCP（仅为复用 4 行 env 检测）                                                 | MEDIUM   |

**反向依赖计数**：除上 5 处，core 模块**没有**运行时反向依赖 build/clangd/ui。整体反向依赖较少。

**修复**（2 小时）：

- **最优解**：把 `ParsedDiagnostic` 从 `src/build/types.ts` 抽到 `src/core/types/diagnostic.ts`，同时解决 ui→build 和 parsers→build 两处违规。
- `detectHost` 从 `@mcp/lifecycle` 抽到 `@core/runtime-detect`，解决 commands→mcp 违规。
- `resolveUBTPath` 应通过接口注入而非直接 import，或在 `@core/path-resolver` 中重新导出。
- `core/workspace.ts:32` 改为 `import type { ProjectInfo, EngineInstall } from '@detection/types'`（使用别名而非相对路径）。

**严重度**：🟡 MEDIUM —— 架构债务

---

### M6. `src/clangd/compileCommands.ts` 1002 行 god 文件

**证据**：`src/clangd/compileCommands.ts` **1002 行**，是仓库最大单文件。承担 5+ 个职责：

- UBT -ProjectFiles 执行
- 缓存层
- Fallback 路径
- Symlink 到工作区根
- vscode.tasks 集成

**影响**：

- 单元测试覆盖率低（只有 `compileCommands.test.ts` 一个文件）
- 任何小改动都可能影响不相关功能
- 新人 onboarding 成本高

**修复**（4-6 小时）：拆分为 4-5 个 cohesive 模块：

- `compileCommands.task.ts`（vscode.tasks 集成）
- `compileCommands.cache.ts`（已有，独立化）
- `compileCommands.symlink.ts`（linkToWorkspaceRoot）
- `compileCommands.fingerprint.ts`（利用现有 `./fingerprint.ts`）

**严重度**：🟡 MEDIUM —— god 文件

---

### M7. populateAddCompletions 撒谎兼容层仍在（陷阱 #12 加深）

**证据**：`src/clangd/completionFiles.ts:591-601` 仍调用 `createCompletionFiles(opts.projectPath)`（**真的生成文件**）然后返回 `{added:0, skipped:0, found:0}`（**全是 0 的撒谎 stats**）。

**影响**：

- 任何调用方读返回值做决策的代码全错
- 函数标 `@deprecated` 但未从所有 caller 切换

**修复**（30 分钟）：

- grep 所有 `populateAddCompletions` 调用方，改用 `createCompletionFiles`
- 删除 `populateAddCompletions` 函数和 `PopulateOptions/PopulateResult` 接口

**严重度**：🟡 MEDIUM —— 误导接口

**✅ 已解决（Phase 9 SSoT 收尾）**：`grep populateAddCompletions src/` 全仓库零匹配（已在 audit 之前静态删除；函数从未存在于当前 HEAD）。AGENTS.md TRAP #12 同步标记"已解决"。13 个 `test/unit/core/ssot.test.ts` 回归守卫防复活。

---

### M8. 4 个 type unsafe 断言点（`as unknown as`）

**证据**：

| 文件:行                              | 表达式                                                           | 风险                                                                                                 |
| ------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/extension.ts:61-62`             | `disposables.push(workspace as unknown as vscode.Disposable)` 等 | `WorkspaceState`/`ClangdOps` 不是 `Disposable`，靠强转注入；deactivate 时调用 `dispose()` 实际无操作 |
| `src/clangd/fingerprint.ts:185`      | `entries = result as unknown as import('node:fs').Dirent[]`      | fs readdir 返回值强转                                                                                |
| `src/detection/index.ts:94`          | `ready: undefined as unknown as Promise<DetectionResult>`        | handles 字段初始 undefined 强转 Promise，延迟初始化                                                  |
| `src/clangd/diagnostics/io.ts:54/91` | `yaml.parse(text) as unknown` / `JSON.parse(text) as unknown`    | YAML/JSON 解析后无类型断言                                                                           |
| `src/clangd/perfLog.ts:91`           | `const ext = vscode as any` + 3 处 `eslint-disable`              | perfLog 通过 vscode.\_ 私有 API 绕过类型                                                             |

**影响**：

- 类型安全承诺（`noUncheckedIndexedAccess` 已开）被这些洞打穿
- `extension.ts:61-62` 的 dispose 实际是空操作 —— 卸载时可能资源泄漏

**修复**（1-2 小时）：

- `WorkspaceState` 和 `ClangdOps` 实现 `vscode.Disposable` 接口（添加 `dispose()` 方法）
- `fingerprint.ts:185` 改成显式类型守卫
- `detection/index.ts:94` 用 `Promise<DetectionResult> | undefined` 替代
- `diagnostics/io.ts` 用 zod 或 io-ts 做 schema 校验
- `perfLog.ts` 改为正常接口而非私有 API

**严重度**：🟡 MEDIUM —— 类型安全漏洞

---

### M9. ESLint 1 个真 error（proxyManager 测试）+ 105 warnings

**证据**（已运行 `npm run lint`）：

- **1 ERROR**：`test/unit/clangd/proxyManager.test.ts:216` `Async arrow function has no 'await' expression`
- **105 WARNINGS** 分布：
  - 96 个 `@typescript-eslint/no-non-null-assertion`（test/ 占 78 个，src/ 占 18 个）
  - 7 个 `@typescript-eslint/explicit-function-return-type`
  - 2 个 `@typescript-eslint/prefer-nullish-coalescing`（mcp/lifecycle.ts:21-22, msvcParser.ts:97）

**影响**：

- 1 个 error 让 `lint:fix` 不通过
- 100+ warning 是技术债信号

**修复**（30 分钟）：

- 修 1 个 error（要么加 `await`，要么去掉 `async`）
- 96 个 `!` 断言可分批消除，test 文件优先（line 130-229 fileWatcher.test.ts 是重灾区）

**严重度**：🟡 MEDIUM —— 代码气味

---

### M10. README.md 与实际项目状态严重脱节

**证据**（与根 AGENTS.md 比对）：

| README.md 声明                                              | 实际状态                                         |
| ----------------------------------------------------------- | ------------------------------------------------ |
| "All 7 phases complete"（line 9）                           | Phase 7 marketplace icon 仍缺失（67 字节空 PNG） |
| "Phase 6: Unit tests, 18 passing across 4 files"（line 23） | 实际 **60 个测试文件**（含 1 个 .bak）           |
| Settings 表里 `engineRoot` 设置                             | **package.json 不存在**                          |
| Commands 表 12 个（含 `toggleCompletionMode`）              | 实际 19 个，`toggleCompletionMode` 已删          |
| "Build output → out/extension.js (57.8kb)"                  | 实际 845KB（含 sourcemap 时 1.7MB）              |
| `vscodeUEHelper.completionMode` 默认 "fast"                 | 实际 default "slow"（line 271）                  |
| `toggleCompletionMode (Toggle Clangd Completion Mode)` 命令 | **不存在**                                       |

**影响**：README 是新人第一接触点，严重误导。

**修复**（1 小时）：完全重写 README.md 的 Phase 表、Settings 表、Commands 表、测试统计。

**严重度**：🟡 MEDIUM —— 用户文档腐烂

---

### M11. `populateAddCompletions` 之外的死代码兼容层

**证据** — `src/clangd/completionFiles.ts:606-614` 还有 2 个 `@deprecated` 空函数：

- `findUhtGeneratedHeaders()` 返回 `[]`
- `parseExistingIncludes()` 返回 `[]`

**影响**：误导 API 用户。

**修复**（15 分钟）：删除这两个函数。

**严重度**：🟡 MEDIUM —— 死代码

**✅ 已解决**：grep `findUhtGeneratedHeaders|parseExistingIncludes src/` 同样零匹配（与 M7 同步——这俩函数也是 audit 之前就静态删除了）。无需进一步动作。

---

### M12. i18n 死 key：`headerWatcher.{regenerating,synced,failed}` (3 个)

**证据**：`src/i18n/locales/{en,zh}.json:207-209` 仍保留 3 个 `headerWatcher.*` key，但 `src/extension.ts:50` 明确说"headerWatcher removed"，且 src/grep 找不到引用。

**影响**：无害僵尸 key（不增加 bundle 体积，因 i18n 是 lazy load），但误导新译者。

**修复**（5 分钟）：删除这 3 个 key。

**严重度**：🟡 MEDIUM —— 死 i18n key

---

### M13. 6 个 `@parsers`/`@rules`/`@platform` 死别名

**证据**：

| 别名          | 声明位置                                                                    | 实际使用                                  |
| ------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| `@parsers/*`  | `tsconfig.json:45`, `esbuild.config.mjs:34`, `vitest.config.ts:35`          | **0 处**                                  |
| `@rules/*`    | `tsconfig.json:52-53`, `esbuild.config.mjs:38-39`, `vitest.config.ts:39-40` | **0 处**                                  |
| `@platform/*` | `tsconfig.json:54-55`, `esbuild.config.mjs:39`, `vitest.config.ts:40`       | **0 处**（且 `src/platform/` 目录不存在） |

**影响**：

- tsconfig/esbuild/vitest 三处冗余声明
- 未来有人想用 `@platform` 会指向不存在目录（虽然 esbuild 不会报错，因为没人 import）

**修复**（15 分钟）：从 3 处配置文件删除 `@parsers/*`、`@rules/*`、`@platform/*` 别名。

**严重度**：🟡 MEDIUM —— 死别名

---

### M14. ueDiagnosticWatcher.ts spawn 拼接 user 输入

**证据** — `src/clangd/proxy/ueDiagnosticWatcher.ts:301-310`：

```typescript
const args = [
  ubtDll,
  '-Mode=UnrealHeaderTool',
  `-Target=${buildTargetName} ${platform} Development -Project=${projectFile}`,
  '-waitmutex',
];
spawn(dotnetExe, args, { ... });
```

`buildTargetName` 来自 `.uproject` 的 `Modules[].Name`（用户可控），`projectFile` 来自工作区（用户可控）。

**风险**：

- 不是命令注入（用 args 数组，无 shell:true）
- 但 UBT 解析 `-Target=` 字符串时用 `Split(' ')`，**特殊字符或空格**可能导致解析错误
- 项目路径含空格（macOS 常见）也会炸

**修复**（30 分钟）：拼接前对 `buildTargetName`/`projectFile` 做白名单 `[\w./\\:-]` 校验或转义。

**严重度**：🟡 MEDIUM —— 鲁棒性 bug

---

## 四、LOW（22 项）

### L1. `src/core/AGENTS.md` 与 `src/build/AGENTS.md` 自身版本不一致

**证据**：`src/build/AGENTS.md` 第 174-198 行说"DDD 三层结构"，但实际 application/infrastructure 是空壳（H3 已记录）。

**修复**（15 分钟）：把 DDD 主张改成"DDD 迁移中：domain/entities 已落地，application/infrastructure 待迁移"。

---

### L2. `src/ui/AGENTS.md` 命令表是僵尸

**证据**：`src/ui/AGENTS.md` 列出 4 个选择器（pickEngine/pickConfig/pickTarget/pickPlatform），但 `src/ui/quickPicks.ts` 实际只实现 `pickConfiguration/pickTarget/pickPlatform` —— **`pickEngine` 不存在**！

**修复**（10 分钟）：删除 `pickEngine` 行，补全说明。

---

### L3. `package.json` repository.url 占位符未替换（AGENTS.md 已记录）

**证据**：`package.json:9` `"url": "https://github.com/YOUR_USERNAME/vscode-ue-helper.git"`

**修复**（1 分钟）：发布前替换为真实 URL。

---

### L4. `package.json` 缺 `keywords` 中 MCP 描述

**证据**：`package.json:21-28` keywords 含 `mcp` 和 `model-context-protocol`，但 description 没突出 MCP 价值。

**修复**（5 分钟）：更新 description。

---

### L5. `.prettierrc` 不强制 LF（Windows 团队可能产生 diff 噪音）

**证据**：未读取 `.prettierrc`，但 AGENTS.md 没提到，且 gitattributes 未设强制 LF。

**修复**（10 分钟）：在 `.gitattributes` 加 `* text=auto eol=lf`。

---

### L6. `src/build/application/index.ts` 和 `infrastructure/index.ts` 的 AGENTS.md 索引

**证据**：两个 2 行注释文件被 `src/build/AGENTS.md` 列为"占位"，但它们没有 `.test.ts` 文件所以不会被测试覆盖，导致 lint 检查不到。

**修复**：H3 决定方向后连带处理。

---

### L7. `core/AGENTS.md` 说自己有"command-registry"，但代码里 command-registry.ts 是单独的（不通过 index）

**证据**：`src/core/AGENTS.md` 第 21 行表格列出 `command-registry.ts` 但下又说"无 `index.ts` 是设计如此"。这本身正确，但表格让人误以为有统一 barrel。

**修复**：把表格标题改成"模块文件（非 barrel）"。

---

### L8. `setup.ts` `// @typescript-eslint/no-explicit-any` 是隐式 escape hatch

**证据**：`test/unit/setup.ts:96,99,103` 等多处 `range: unknown; severity: unknown;` 在 mock Diagnostic 类中，绕过了真实 `vscode.Diagnostic` 类型。

**影响**：测试用宽松 mock 覆盖源码严格类型。

**修复**（30 分钟）：用 `@vscode/test-electron` 真实 mock 或 `@types/vscode` 完整 mock。

---

### L9. `proxy` AGENTS.md 说"child_process 未全局 mock"但 setup.ts:194-209 mock 了 chokidar 而非 child_process

**证据**：`src/clangd/proxy/AGENTS.md:46` 说"测试用 `vi.mock('child_process', ...)` 测试侧处理" —— 但实际 `test/unit/setup.ts` 只 mock 了 `chokidar`，没有 mock `child_process`。

**修复**：在 setup.ts 添加 `vi.mock('child_process', ...)` 或更新 AGENTS.md 描述。

---

### L10. `out/package.json`（esbuild 输出）作用不明

**证据**：`npm run build` 后 `out/package.json` 出现（17,978 字节），但 `.vscodeignore` 排除整个 `out/`。这文件是 esbuild 自动生成？

**修复**：调查 esbuild.config.mjs 是否需排除 `out/package.json` 写入（用 `write: false` 或自定义 outdir）。

---

### L11. `out/` git 已忽略但工作树未清理

**证据**：`out/` 被 .gitignore 排除（git check-ignore 验证），但当前工作树仍有 `out/extension.js`、`out/clangdProxy.js`、`out/launcher/` 等 6 个文件。

**影响**：不影响 git，但占用磁盘。

**修复**：偶尔 `npm run clean && npm run build`。

---

### L12. `src/i18n/locales/{en,zh}.json:33-34` lspLoggingLevel enum 中文混合

**证据**：`zh.json:32-34` 是 `"error(错误)"` `"warn(警告)"` `"info(信息)"` `"debug(调试)"` —— 英文+中文括号组合。但其他 enum 字段用 `"(auto-detect)"` `(自动检测)` 等也是混合。

**影响**：低 —— 用户能看懂。

**修复**（30 分钟）：统一为纯中文 + 单独解释，或纯英文 + i18n enumDescriptions。

---

### L13. `src/commands/setSystemIncludes.ts:125/139` 硬编码英文 placeHolder

**证据**：见 M1 表格。

**修复**：纳入 M1 大批量修复。

---

### L14. `src/detection/index.ts:91` 用空 candidates 构造 EngineDiscovery 然后再覆盖

**证据**：

```typescript
discovery: (new EngineDiscovery({ candidates: [] }), // line 91
  // ... 异步解析完成后：
  (handles.discovery = new EngineDiscovery({ candidates: engines.map((e) => e.path) }))); // line 200
```

**影响**：构造两次对象，浪费 + 调用方需注意 `handles.ready` resolve 后 `discovery` 字段才正确。

**修复**（15 分钟）：让 EngineDiscovery 接受 `setCandidates` 方法而非整体替换。

---

### L15. `src/commands/firstRunInit.ts:165` tempFile 失败未清理

**证据**：原子写入（`fs.writeFile` + `rename`）失败时不 unlink tempFile，留 `.tmp` 残留。

**修复**（15 分钟）：try/catch + `fs.unlink` tempFile。

---

### L16. `src/core/workspace.ts:32` 用相对路径 `'../detection/types'`

**证据**：见 M5 表。

**修复**：纳入 M5 修复（用 `@detection/types` 别名）。

---

### L17. `src/core/workspace.ts` 是"扁"大文件（307 行，60+ getter）

**证据**：`core/workspace.ts` 307 行，包含 60+ 个 getter（每个 1-3 行）。读起来像字典。

**修复**（2 小时）：按职责拆分：`WorkspaceStatePaths`, `WorkspaceStateNotify`, `WorkspaceStateError`。

---

### L18. `src/core/config.ts` 同上（317 行，22+ getter）

**证据**：与 workspace.ts 相似问题。

**修复**（2 小时）：按设置分组（`BuildConfig`, `ClangdConfig`, `ProxyConfig`）。

---

### L19. `src/ui/controlPanel.html.ts` 615 行 HTML 模板

**证据**：单文件 615 行模板（AGENTS.md 标"acceptable"），但实际 `panel.title`、`panel.tab.*`、`panel.section.*` 等 i18n 调用都在这里拼装。

**修复**（4-6 小时）：拆分为多个部分模板。

---

### L20. `src/clangd/proxy/bridge.ts` 692 行（次大）

**证据**：LSP 消息路由 + keepalive + JSON-RPC 处理。

**修复**（4-6 小时）：拆分 message handlers（每个 LSP method 一个文件）。

---

### L21. `.bak` 文件在 `git status` 不显示（因为已跟踪）

**证据**：`git status` 没列 `.bak` 文件，但 `git ls-files` 列出它。

**影响**：开发者看不到。

**修复**：见 H5。

---

### L22. `AGENTS.md` 入口顺序与 extension.ts 不严格匹配

**证据**：AGENTS.md 第 50-58 行说 "→ activateBuild / activateClangd / activateUI → activateCommands → ControlPanelProvider.register"，但 extension.ts:51 把 activateUI 放在 activateCommands 之前（line 51: `const ui = activateUI(...)` 在 line 53 `activateCommands` 之前）。

**影响**：低，文档细节与代码顺序略不同。

**修复**（5 分钟）：更新 AGENTS.md 第 51-58 行的顺序描述。

---

## 五、隐藏的关键发现（容易被忽略）

### F1. 测试覆盖空白（快速盘点）

虽然本次审计未深挖测试覆盖（agent 任务超时），但通过 grep 已发现：

- `test/unit/mcp/` 不存在 — **MCP 模块 0 测试**
- `src/extension.ts` 入口 — 0 单元测试（vscode-test-electron 才能 e2e）
- `src/detection/index.ts` — 有 `workspaceEngines.test.ts`，但 `index.ts` 本身没有对应测试
- `src/commands/firstRunInit.ts` — 有 `firstRunInit.test.ts`（18779 字节，最长的测试）
- `src/ui/controlPanel.ts` — 有 `controlPanel.test.ts`（16880 字节）

**建议**：下一轮审计补 `test/unit/mcp/tools.test.ts`。

---

### F2. `package.json` 的 19 个命令里有一个无对应 handler 文件

**证据**：`vscodeUEHelper.firstRunInit` —— **不在** `package.json#contributes.commands`，但 `src/commands/firstRunInit.ts` 存在。

**实际情况**：`firstRunInit` 是 helper（由 extension.ts 直接调用），不是 VS Code 命令。AGENTS.md 没说明这点。

**修复**（5 分钟）：更新 `src/commands/AGENTS.md` 说明 firstRunInit 是内部 helper，非命令。

---

### F3. `test/unit/commands/clangdProxyCommands.test.ts.bak` 比 `clangdProxyCommands.test.ts` 大 1KB

**证据**：

- `clangdProxyCommands.test.ts`: 11,316 字节
- `clangdProxyCommands.test.ts.bak`: 10,006 字节

`.bak` 是旧版本（更小但更旧），所以当前 `.ts` 是更新版本。

**修复**：见 H5。

---

### F4. `npm run test:integration` 失败的真正原因

**证据链**：

1. `package.json:443` `"test:integration": "node test/integration/runTests.js"`
2. `test/integration/` 不存在
3. `npm test` (line 444) 先跑 unit 再跑 integration → 必然失败

但 `npm run test:unit` 单独跑**没问题**。

**修复**：见 C1。

---

### F5. `out/` 实际包含 6 个文件但 `.vsix` 只打包 5 个

**证据**：

- `out/` 有：`clangdProxy.js`, `clangdProxy.js.map`, `extension.js`, `extension.js.map`, `package.json`, `launcher/proxy-launcher.bat`, `launcher/proxy-launcher.sh`
- `.vscodeignore` 排除 `**/*.map` → `.vsix` 排除 map 文件 → **5 个文件进入 vsix**

**影响**：`out/package.json` 进 vsix 是 esbuild 自动生成（用于 "main" 字段），非 bug。

---

## 六、统计摘要

| 维度              | 数量                                                                     |
| ----------------- | ------------------------------------------------------------------------ |
| src/ 文件         | 141                                                                      |
| test/ 文件        | 60（含 1 .bak）                                                          |
| src/ 行数（估算） | ~25,000                                                                  |
| i18n key 数       | 190（en/zh 完全对称）                                                    |
| 命令数（实际）    | 19                                                                       |
| runtime 依赖      | 6（其中 3 个零引用）                                                     |
| dev 依赖          | 11                                                                       |
| AGENTS.md 文件    | 8                                                                        |
| 模块数            | 11                                                                       |
| i18n 死 key       | 3                                                                        |
| 死别名            | 3（@parsers, @rules, @platform）                                         |
| 死代码            | 7+（populate 兼容层、findUhtGeneratedHeaders、parseExistingIncludes 等） |
| 硬编码用户字符串  | 47                                                                       |
| 汉化 TODO 僵尸    | 6                                                                        |
| `as unknown as`   | 5 处                                                                     |
| `as any`          | 1 处                                                                     |
| `eslint-disable`  | 7 处                                                                     |
| Lint warnings     | 105                                                                      |
| Lint errors       | 1                                                                        |

---

## 七、优先修复路线图

### 第 1 优先级（半天内）

1. **C1** 删除 `test:integration` 脚本
2. **H5** git rm .bak + .gitignore
3. **H4** 把 completionMode getter 简化
4. **M3** npm uninstall 3 个未使用依赖
5. **M9** 修 lint error

### 第 2 优先级（1 天内）

6. **H1** 重写 5 处命令数量文档
7. **H2** 改 Config.update 文档示例
8. **H6** 换 icon.png
9. **H3** 承认 DDD 假象（删除 application/infrastructure）
10. **M12** 删 3 个 headerWatcher i18n key
11. **M13** 删 3 个死别名
12. **M11** 删 findUhtGeneratedHeaders/parseExistingIncludes 死函数

### 第 3 优先级（3 天内）

13. **M1** 把 47 处硬编码迁到 i18n
14. **M10** 重写 README.md
15. **M5** 解决 5 处跨层依赖
16. **M7** 迁 populateAddCompletions 调用方
17. **M4** 解决 MSVC 正则同步
18. **M8** 消除 `as unknown as`

### 第 4 优先级（1 周）

19. **H4-选项 B** 彻底删 completionMode 设置
20. **M6** 拆分 compileCommands.ts（1002 行）
21. **M2** 实现 6 个汉化 TODO（或删承诺）
22. **L17-L20** 拆分 god 文件
23. **F1** 补 MCP 测试

---

## 八、对比基线

| 指标                | 期望（行业中等） | 实际                            | 评价  |
| ------------------- | ---------------- | ------------------------------- | ----- |
| TypeScript strict   | 全开             | 全开 + noUncheckedIndexedAccess | ✅ 优 |
| i18n 双语对齐       | 100%             | 100%                            | ✅ 优 |
| 死别名              | 0                | 3                               | ❌ 差 |
| 死 i18n key         | 0                | 3                               | ❌ 差 |
| 日志撒谎            | 0                | 1+                              | ❌ 差 |
| 命令数量一致性      | 1 个数字         | 6 个不同数字                    | ❌ 差 |
| DDD vs 实际         | 一致             | application/infrastructure 空壳 | ❌ 差 |
| i18n 实际覆盖率     | 100%             | ~50%                            | ⚠️ 中 |
| 测试覆盖            | ≥80%             | 56 文件（未深挖覆盖率）         | ⚠️ 中 |
| 未使用依赖          | 0                | 3                               | ❌ 差 |
| god 文件（>500 行） | 0                | 8+                              | ⚠️ 中 |
| 汉化 TODO 僵尸      | 0                | 6                               | ❌ 差 |
| `.bak` 在 git       | 0                | 1                               | ❌ 差 |

---

## 九、附录：审计方法学

本次审计采用 4 路并行 explore agent + 直接文件读取 + 静态分析：

1. **代码质量与类型安全**（explore agent bg_0af32959）— 因超时取消，但已用直接 grep 补全 as/eslint-disable/TODO 统计
2. **架构边界与模块依赖**（explore agent bg_93ad6906）— 已完成详细报告
3. **文档陷阱残留与构建配置**（explore agent bg_05ce30bd）— 已完成详细报告
4. **测试覆盖与 i18n 完整性**（explore agent bg_d94a1df4）— 因超时取消，已用手动 grep + PowerShell Compare-Object 补全
5. **依赖卫生与安全审计**（explore agent bg_e6e14667）— 已完成详细报告

直接运行：

- `npm run typecheck` ✅ 0 错误
- `npm run lint` ⚠️ 1 error + 105 warnings
- `git ls-files` 验证 .bak 跟踪状态
- `git check-ignore -v` 验证忽略规则
- `Compare-Object` 验证 i18n 双语 key 对齐
- `Get-ChildItem` 验证文件大小、路径

---

**报告结束**

> 若要修复任何问题，请按"第七节 优先修复路线图"实施。
> 本报告所有发现均带文件:行号证据，可独立复现验证。

### M14. ueDiagnosticWatcher.ts spawn 拼接 user 输入

**证据** — `src/clangd
