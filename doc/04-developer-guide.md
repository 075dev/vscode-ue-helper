# 04 — 开发指南

> 面向维护者和贡献者：环境搭建、命令清单、新增/修改/调试、测试、打包。本指南受 [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) 治理；质量门禁、依赖纪律、修订流程以宪法 IV–V 为准。

## 1. 环境要求

| 工具           | 版本           | 说明                                                          |
| -------------- | -------------- | ------------------------------------------------------------- |
| Node.js        | ≥ 18           | 见 `package.json#engines.node`                                |
| VS Code        | ≥ 1.85         | 见 `package.json#engines.vscode`                              |
| Unreal Engine  | 5.2+（运行时） | 5.4+ 推荐（preparseIncludes 头列表 5.4 为基准）               |
| clangd         | 22.x           | 由扩展包依赖 `llvm-vs-code-extensions.vscode-clangd` 自动安装 |
| MSBuild + MSVC | Windows only   | vswhere.exe 在标准安装位置会被自动发现                        |

## 2. 首次搭建

```bash
git clone <repo>
cd VSCodeUEHelper
npm install
npm run build
# 然后按 F5 在 VS Code 里启动 Extension Development Host
```

推荐安装的扩展（见 `.vscode/extensions.json`）：ESLint、Prettier、TS Next、EditorConfig。

## 3. 命令清单

```bash
# ===== 构建 =====
npm run build           # clean + esbuild → out/extension.js + out/clangdProxy.js + launcher
npm run watch           # esbuild watch 模式（VS Code F5 用此）
npm run clean           # 只删 out/src 和 out/test（防 .vsix 残留），不动 out/extension.js

# ===== 质量门禁（按推荐顺序，宪法 IV）=====
npm run typecheck       # tsc --noEmit，必须零错误
npm run lint            # ESLint src test
npm run format:check    # Prettier（仅校验；CI/release 不强制）
npm run test:unit       # Vitest（vitest run 单次；测试组织见 §4）
npm run test:e2e        # VS Code EDH 真机 e2e（需 mocha；细节见 §4「端到端测试」）
# npm test == npm run test:unit：test 脚本是 test:unit 的别名（package.json#scripts.test = "npm run test:unit"），不存在 test:integration 入口

# ===== 性能 / 调试辅助 =====
npm run perf:baseline   # LSP 代理开销基线 → .vscode/clangd-perf-cache/proxy-baseline.json
npm run perf:after      # 同上 → proxy-after.json
npm run perf:diff       # 对比两个 JSON，< 1% 偏差算通过

# ===== 打包发布 =====
npm run package         # vsce package → .vsix（自动 prepackage: build）
npm run publish         # vsce publish（需先 vsce login）
```

**禁止 / 注意**：

- 直接 `node out/extension.js`（缺 VS Code runtime）
- 在没有真实 Unreal 项目的 CI 环境声称"已通过烟雾测试"——按宪法 IV 必须记录不可用环境或延迟验证；不要用脚手架或窄测试冒充交付

## 4. 测试

### 跑单个测试文件

```bash
npx vitest run test/unit/clangd/clangdOps.test.ts
```

### 跑单个测试名

```bash
npx vitest run -t "mutate 应该原子写入"
```

### 调试某个测试

VS Code 里 `Run Unit Tests` 配置（`.vscode/launch.json`）会以 verbose reporter 启动 vitest。

### 测试设施

`test/unit/setup.ts`：

- **mock 整个 `vscode` 模块**（`workspace` / `window` / `commands` / `languages` / `tasks` 等）
- **mock `chokidar`**（防真实 fs watcher 卡住测试进程）
- `globals: false`，每个测试文件显式 `import { describe, it, expect, vi } from 'vitest'`

### Coverage

```bash
npx vitest run --coverage
```

阈值（vitest.config.ts）：

| 维度       | 阈值 |
| ---------- | ---- |
| lines      | 80%  |
| functions  | 80%  |
| branches   | 75%  |
| statements | 80%  |

排除：`src/extension.ts`、`src/**/*.d.ts`。

### 测试组织

`test/unit/` 与 `src/` 镜像目录布局（`test/unit/clangd/` 对应 `src/clangd/`）。约定：

- 一个文件 / 类 / 关键函数 = 一个 test 文件
- 测试文件名 `<source>.test.ts`
- 不依赖 vscode（用 mock 代替）

### 端到端测试（真实 VS Code 窗口）

`test/e2e/` 用 `@vscode/test-electron` 拉起真实的 Extension Development Host（EDH），加载 `out/extension.js` 真产物，验证扩展能激活、命令全部注册。

```bash
# 首次需要 mocha —— suite/index.js 自管 mocha runner，按约定不进 devDependencies
npm install --no-save --no-package-lock mocha@10

npm run test:e2e        # = build + tsc -p tsconfig.e2e.json + node .tsc-e2e/runTests.js
```

**两个必须知道的坑**：

1. **clangd 扩展依赖**：`package.json#extensionDependencies` 声明了 `llvm-vs-code-extensions.vscode-clangd`。EDH 默认使用空扩展目录，依赖不存在时 VS Code 会**拒绝激活本扩展**，于是「命令全部注册」断言必然失败（实测 3 个用例全红，扩展完全没激活）。`runTests.ts` 会自动把用户已装的 clangd 扩展复制到 `.vscode-test/extensions-e2e/` 并用 `--extensions-dir` 挂上；换机器跑需要先在 VS Code 里装 clangd 扩展，否则会报明确的缺依赖错误。
2. **产物隔离**：e2e 编译产物在 `.tsc-e2e/`（已 gitignore），VS Code 运行时在 `.vscode-test/`（同样已忽略）。首次运行会下载 VS Code stable 二进制，耗时较长。

预期输出：`4 passing` —— 扩展激活不抛异常 / 28 个命令全部注册 / 200ms 时 `isActive=true` / 200ms 时命令数 ≥ 28。

## 5. 调试扩展

### Extension Development Host（F5）

`.vscode/launch.json` 提供两个配置：

- `Run Extension`：单次运行
- `Run Extension (Watch Mode)`：跑 `npm: watch`，esbuild 增量编译

在 Extension Development Host 窗口里：

- Output 面板选 "VSCodeUEHelper" 看日志
- 断点打在 TypeScript 源文件（source map 已生成）
- Console 面板看 `console.*`

### 调试代理 CLI

代理 CLI 不依赖 vscode，可以独立调试：

```bash
# 直接跑（不需要 VS Code）
node out/clangdProxy.js \
  --real-clangd="<path-to-clangd>" \
  --project-dir="<path-to-uproject-dir>" \
  --engine-root="<path-to-engine>" \
  --log-path="/tmp/proxy.log" \
  --localization-enabled \
  --
```

代理 stdout 是 LSP 协议通道，调试时**绝不能**让日志走 stdout。用 `--log-path` 或 stderr。

### 诊断项目

如果扩展行为异常，先跑 `Diagnose Clangd Project` 命令（命令面板搜 "Diagnose"），它会扫描 `.clangd` / `compile_commands.json` / preparse 头 / clangd 二进制 / 补全文件，写结构化报告（pass/warn/fail）到 Output。

## 6. 新增 / 修改命令

**新增** 4 步：

1. **`package.json`**：在 `contributes.commands` 添加定义
   ```json
   {
     "command": "vscodeUEHelper.myCmd",
     "title": "My Cmd",
     "title@zh": "我的命令",
     "category": "UE Helper",
     "icon": "$(star)"
   }
   ```
2. **`src/commands/myCmd.ts`**：写 `executeMyCmd(config, logger, ...)`
3. **`src/commands/index.ts`**：导入 + `registerCommand(context, 'vscodeUEHelper.myCmd', () => executeMyCmd(...))`
4. **`src/i18n/locales/{en,zh}.json`**：加 user-visible 文案的 key

**修改**：先在 `src/commands/<name>.ts` 改逻辑；如果改 `package.json` 的 `activationEvents` 或 `commandPalette.when`，记得同步文档。

**常见错误**：

- 忘记把 `Disposable` push 到 `context.subscriptions`（用 `registerCommand` 自动处理）
- 改完 `package.json` 后没 `npm run build`（dev 模式需要重跑 watch）
- 改完 `i18n` 后没同步两个 locale

## 7. 新增 / 修改配置项

1. **`package.json#contributes.configuration.properties`**：加 `vscodeUEHelper.xxx` 的 schema 定义（带 i18n `description@zh`）
2. **`src/core/config.ts`**：加 getter
3. **`src/i18n/locales/{en,zh}.json`**：加 description 文案

**陷阱**：`Config.update()` 写完必须 `refreshRoot()`（已内部处理），但调用方常见误用：`await config.update(); 立刻读 config.xxx` 会拿到旧值。`update()` 内部已经处理了，但理解这点有助于写测试。

## 8. 新增模块

参考 `src/<新模块>/AGENTS.md` 模板：

```markdown
# <模块名> 模块知识库

## 模块概述

（一句话职责）

## 核心文件

| 文件 | 职责 |

## 关键类型

（TypeScript 代码片段）

## 关键约定

（错误处理、用户交互、依赖管理）

## 新增 X 步骤

（如果适用）
```

模块目录结构约定（参照现有）：

```
src/<module>/
├── index.ts            # 入口，export public API + activateXxx()
├── AGENTS.md           # 模块知识库（必填）
└── *.ts                # 实现文件
```

如果模块内有子模块（如 `src/clangd/proxy/`），按职责或功能再切分。

## 9. 修改 .clangd / compile_commands 行为

**只通过 `ClangdOps` API**。禁止在调用方直接 `fs.readFile` / `fs.writeFile` `.clangd` 或 `compile_commands.json`：

```typescript
// ✅ 正确
await clangdOps.mutate(({ config }) => {
  config.CompileFlags = { ...config.CompileFlags, Add: [...flags] };
});

// ❌ 错误（破坏 Phase 8 架构）
const text = await fs.readFile(workspace.clangdConfigPath!, 'utf-8');
await fs.writeFile(workspace.clangdConfigPath!, modifiedText);
```

原因：`ClangdOps.mutate` 是事务性的（read → mutate → atomic write），且通过 `WorkspaceState` 派生路径。直调 fs 拿到的路径是瞬时快照（可能派生规则改了），写入也不原子。

## 10. 调试 clangd 索引问题

常见症状：「为什么这个头文件找不到」「为什么 `UCLASS` 报 unknown_typename」。

按这个顺序查：

1. **跑 `Diagnose Clangd Project`** — 输出结构化报告
2. **看 Output 面板** — `[clangd]` / `[detection]` / `[clangdOps]` 日志
3. **看代理日志**（如果启用了 proxy）— Output 面板里的 "Clangd Proxy" 通道
4. **手动检查 `.clangd`** — `cat .clangd`，确认 `Add` / `CompilationDatabase` 字段
5. **手动跑 clangd** — `clangd --check-lines=... --check-some-file.cpp`，看是否能索引

`ueClangdCompat.h` 由 `createCompletionFiles` 自动写，**不要手改**——它会在 `createProject` / 重新安装时被覆盖。

## 11. 打包发布

```bash
# 1. 改 package.json#repository.url（占位符是 YOUR_USERNAME/vscode-ue-helper）
# 2. 改 CHANGELOG.md，加新版本
# 3. 跑质量门禁（宪法 IV：按受影响范围必跑）
npm run typecheck && npm run lint && npm run test:unit
# 4. 涉及 package metadata / 打包 / 编译产物时，加跑
npm run build
# 5. 涉及 build / clangd 行为改动时，按宪法 IV 跑真实 Windows Unreal 烟雾场景；
#    没有 Windows Unreal 环境必须显式记录不可用，不得以脚手架/窄测试冒充交付
# 6. 打包
npm run package
# 7. 产物是 vscode-ue-helper-<version>.vsix，本地测试：
code --install-extension vscode-ue-helper-<version>.vsix
```

完整细节与回滚流程见 [docs/RELEASE.md](../../docs/RELEASE.md)。

`.vsix` 内容（由 `.vscodeignore` 控制）：

- `out/extension.js`
- `out/clangdProxy.js`
- `out/launcher/proxy-launcher.{bat,sh}`
- `resources/icon.png`
- `package.json`

**不会打包**：`src/`、`test/`、`tsconfig.json`、`*.mjs`、`AGENTS.md`、`CLAUDE.md`、`.codegraph/`、`scripts/`、`*.log`、`*.map`、`doc/`、`docs/`。

发布到 Marketplace：

```bash
npm run publish    # 需要 vsce 已登录 publisher: 'vscode-ue-helper'
```

## 12. 关键约定回顾

- **产品边界（宪法 I）**：Windows 10/11 + UE 5.2+ + MSVC + Windows SDK 是唯一受支持环境；`package.json#platforms = ["win32"]`；非 Windows 路径 / 文档 / 测试需宪法修订才能引入
- **28 个命令**：完整列表见 `package.json#contributes.commands` 与 [doc/02-modules.md §6](../02-modules.md#6-srccommands--28-个-vs-code-命令)；新增命令按宪法 II 通过 `WorkspaceState` / `ClangdOps` 派生状态，遵守 §6.4 步流程
- **TypeScript strict 全开**（`strict` / `noUncheckedIndexedAccess` / `noUnusedLocals/Parameters` / `noImplicitReturns` / `noFallthroughCasesInSwitch`）
- **路径别名**（`@core/*` 等），**禁止**相对导入
- **i18n**：所有用户可见字符串走 `t('key', params)`
- **日志前缀**：`[moduleName] message`
- **disposable**：所有 VS Code 资源 push 到 `context.subscriptions`
- **代码注释强制中文**（系统级约定）
- **不引入新依赖**前先讨论 —— `package.json` 是 release artifact 的核心
- **MSVC 正则两处同步**：`package.json#problemMatchers` 和 `src/parsers/msvcParser.ts`
- **`Config.update` 写完必须 refresh** —— 内部已处理，但理解有助于调试

## 13. 仓库陷阱（避坑）

| 陷阱                                         | 后果                                                               | 怎么避免                                                                                                      |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `npm test` 实际是 `npm run test:unit` 的别名 | 别误以为存在 `test:integration` 而跳过                             | 看 `package.json#scripts.test`：`"test": "npm run test:unit"`，无 integration 入口                            |
| `completionMode` 设置已删除（H4-B）          | 不要再写 fast/slow 分支或新增 `vscodeUEHelper.completionMode` 设置 | `package.json` 已无该键；`src/core/config.ts` 的 `CompletionMode` 类型 alias 已删除；所有补全走 `slow` 单路径 |
| `.bak` 测试文件未 gitignore                  | 可能误提交                                                         | `test/unit/commands/*.bak` 别 commit                                                                          |
| MCP 在普通 VS Code no-op                     | 改 MCP 时假设 always-on 会出错                                     | 看 `src/mcp/lifecycle.ts`                                                                                     |
| chokidar 没 mock                             | fileWatcher 测试卡住进程                                           | `test/unit/setup.ts` 已 mock                                                                                  |
| headerWatcher 已删                           | 不要重新加回主动 watcher                                           | Phase 8 改被动诊断模式                                                                                        |
| `out/` 必须清理                              | `npm run clean` 只清 out/src test                                  | `npm run build` 内部已 clean + bundle                                                                         |
| 历史 `@platform` 别名已删除                  | 不要恢复无对应目录的别名                                           | 只用 `tsconfig.json` 当前列出的 `@core` / `@build` 等别名                                                     |
| 代理 stdout 是 LSP 协议                      | 写日志会破坏 LSP                                                   | 用 stderr 或 `--log-path`                                                                                     |

## 14. 辅助脚本

| 脚本                                 | 用途                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `scripts/clean-out.mjs`              | 清 `out/src` `out/test`（防打包残留）                                                      |
| `scripts/measure-proxy-overhead.mjs` | LSP 代理性能采样（baseline/after/diff）                                                    |
| `scripts/extract-ue-docs.ts`         | UE 源码头注释抽取（用 `npx tsx scripts/extract-ue-docs.ts --engine="..." --output="..."`） |

无 CI / pre-commit / Husky 配置。所有门禁靠开发者本地命令。
