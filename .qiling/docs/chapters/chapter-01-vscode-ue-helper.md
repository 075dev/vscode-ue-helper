---
chapter_id: "chapter-01"
title: "vscode-ue-helper"
part: "第一篇 · 认识项目"
phase: init
generated_at: "2026-09-28T08:08:12.386Z"
generated_by: "器灵工作流 v0.18.0 / ql-scan"
ql_version: "0.18.0"
last_mapped_commit: "9b73e260e6b6446b3caa20325e6f31cbc071b657"
status: "initialized"
docsmap_init: true
scan_path: "."
scanned_entries: 330
routes_detected: 0
events_detected: 3
commands_detected: 0
custom_extracts: 0
endpoints: 0
events: 3
---

# 第 01 章 · vscode-ue-helper(起步)

> 本章是全书的**第一章**:认识并跑起来。由 `/ql-scan` 阅读代码自动生成。
> `<!-- manual -->` 块内的内容欢迎人工撰写润色(重扫自动保留);其余机器节不要手改——项目结构变化后用 `/ql-scan --force` 重扫覆盖。

**一句话:** All-in-one VS Code plugin for Unreal Engine C++ development: UBT build, Live Coding hot-reload, clangd IntelliSense, and optional MCP AI agent integration.

## 本章导学

<!-- manual:syllabus -->
- **本章你将学到:** vscode-ue-helper 的 19 个 npm 命令、3 个事件、36 处命令/工具注册(27 个 VSCode 命令 + 9 个 MCP 工具,见 §3.5)怎么用——从把项目跑起来,到按证据核对每一项能力。
- **前置章节:** 无——本章是全书第一章,从零开始。
- **读法:** 只想查用 → 直接进 [§三 使用说明](#三使用说明);完整了解 → 按顺序读;赶时间 → 先读章末"本章小结"再回看正文(教科书惯例)。

(以上为生成器初稿;欢迎人工改写学习目标与前置章节)
<!-- /manual:syllabus -->

## 一、这个功能是什么

<!-- manual:overview -->
**覆盖能力:**

| 能力 | 数量 | 明细位置 |
|------|------|----------|
| npm 命令 | 19 | [§3.1](#三使用说明) |
| 事件发布 | 3 | [§3.3](#三使用说明) |
| 自定义提取(--patterns) | 36 | [§3.5](#三使用说明) |

**项目形态:** Node.js 生态项目(`package.json` 检出),关键依赖:`esbuild`、`typescript`、`vitest`、`eslint`(用途为推断)

(以上为生成器初稿;欢迎人工补充:这个项目解决什么问题、什么时候用、不适用什么场景)
<!-- /manual:overview -->

## 二、快速上手

<!-- manual:quickstart -->
1. **环境:** Node.js 生态项目(`package.json` 检出);包管理器:npm
2. **安装:** `npm install`
3. **运行:** 启动方式未自动检出——先完成安装,再按 `package.json` 的 `scripts` 人工确认(排查见 §五)
4. **下一步:** 常用命令清单见 [§3.1](#三使用说明),挑一个命令试跑(如 `npm run build`)

(以上为生成器初稿;欢迎人工补充第一次跑通项目的完整步骤与易踩的坑)
<!-- /manual:quickstart -->

## 三、使用说明

> 本节所有能力条目均从代码反推,每条附 `文件:行号` 证据;与 OpenAPI 契约的对应关系待 `/ql-design` 后补全。

### 3.1 命令清单(package.json scripts,原样列出)

| 命令 | 实际执行 |
|------|----------|
| `npm run build` | `npm run clean && node esbuild.config.mjs` |
| `npm run clean` | `node scripts/clean-out.mjs` |
| `npm run watch` | `node esbuild.config.mjs --watch` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run typecheck:watch` | `tsc --noEmit --watch` |
| `npm run lint` | `eslint src test --ext .ts` |
| `npm run lint:fix` | `eslint src test --ext .ts --fix` |
| `npm run format` | `prettier --write "src/**/*.ts" "test/**/*.ts" "*.{json,md,mjs}"` |
| `npm run format:check` | `prettier --check "src/**/*.ts" "test/**/*.ts" "*.{json,md,mjs}"` |
| `npm run test:unit` | `vitest run` |
| `npm run test:unit:watch` | `vitest` |
| `npm run test` | `npm run test:unit` |
| `npm run test:coverage` | `vitest run --coverage` |
| `npm run prepackage` | `npm run build` |
| `npm run package` | `vsce package` |
| `npm run publish` | `vsce publish` |
| `npm run perf:baseline` | `node scripts/measure-proxy-overhead.mjs --baseline` |
| `npm run perf:after` | `node scripts/measure-proxy-overhead.mjs --after` |
| `npm run perf:diff` | `node scripts/measure-proxy-overhead.mjs --diff` |

### 3.3 事件发布

| 事件名 | 动作 | 证据(文件:行) |
|--------|------|------------------|
| `onDidChangeSelection` | fire | `src/core/workspace.ts:219` |
| `changeEmitter` | fire | `src/ui/projectExplorer.ts:51` |
| `exit` | emit | `test/unit/core/subprocessRegistry.test.ts:88` |

### 3.6 项目结构(目录树,深度 ≤ 4,忽略 node_modules/dist/build/.git 等)

```
📄 .eslintrc.json
📄 .gitattributes
📄 .gitignore
📄 .mcp.json
📄 .prettierrc
📁 .vscode/
  📁 .vscode/clangd-perf-cache/
  📄 .vscode/extensions.json
  📄 .vscode/launch.json
  📄 .vscode/settings.json
  📄 .vscode/tasks.json
📄 .vscodeignore
📄 CHANGELOG.md
📄 CONTRIBUTING.md
📁 doc/
  📄 doc/01-architecture.md
  📄 doc/02-modules.md
  📄 doc/04-developer-guide.md
  📄 doc/README.md
📄 esbuild.config.mjs
📄 LICENSE
📄 package.json
📄 package.nls.json
📄 package.nls.zh-cn.json
📄 README.md
📁 resources/
  📄 resources/icon.png
  📁 resources/preparse-includes/
    📄 resources/preparse-includes/ue5-slow.json
  📄 resources/README.md
📁 scripts/  # 构建/工具脚本(推断)
  📄 scripts/check-i18n-v2.cjs
  📄 scripts/check-i18n.cjs
  📄 scripts/clean-out.mjs
  📄 scripts/cov-matrix.cjs
  📄 scripts/extract-ue-docs.ts
  📄 scripts/find-hardcoded-v2.cjs
  📄 scripts/find-hardcoded.cjs
  📄 scripts/gen-icon.ps1
  📄 scripts/measure-proxy-overhead.mjs
  📄 scripts/patch-workspace-initialized.mjs
📁 src/  # 源码主目录(推断)
  📄 src/AGENTS.md
  📁 src/clangd/
    📄 src/clangd/AGENTS.md
    📄 src/clangd/clangdConfig.ts
    📄 src/clangd/clangdOps.ts
    📁 src/clangd/compileCommands/
      📄 src/clangd/compileCommands/cache.ts
      📄 src/clangd/compileCommands/fillMissing.ts
      📄 src/clangd/compileCommands/symlink.ts
      📄 src/clangd/compileCommands/task.ts
    📄 src/clangd/compileCommands.ts
    📄 src/clangd/compileCommandsCache.ts
    📄 src/clangd/compileCommandsFallback.ts
    📄 src/clangd/compileCommandsHint.ts
    📄 src/clangd/completionFiles.ts
    📄 src/clangd/completionMode.ts
    📄 src/clangd/createRspMatchers.ts
    📄 src/clangd/diagnoseProject.ts
    📁 src/clangd/diagnostics/
      📄 src/clangd/diagnostics/AGENTS.md
      📄 src/clangd/diagnostics/checks.ts
      📄 src/clangd/diagnostics/format.ts
      📄 src/clangd/diagnostics/io.ts
      📄 src/clangd/diagnostics/types.ts
    📄 src/clangd/fileWatcher.ts
    📄 src/clangd/fingerprint.ts
    📄 src/clangd/flagGlossary.ts
    📄 src/clangd/formatTidyFiles.ts
    📄 src/clangd/index.ts
    📄 src/clangd/intermediateUhtCollector.ts
    📄 src/clangd/modifyRspFiles.ts
    📄 src/clangd/perfLog.ts
    📄 src/clangd/perfProxy.ts
    📄 src/clangd/preparseIncludes.ts
    📁 src/clangd/proxy/
      📄 src/clangd/proxy/AGENTS.md
      📄 src/clangd/proxy/bridge.ts
      📄 src/clangd/proxy/cli.ts
…(共 330 项,已截断显示前 80 项;完整清单请直接浏览目录或收窄 --scan-path)
```

---

## 四、配置与限制

### 4.1 技术栈

**语言分布(按文件扩展名统计):**

| 扩展名 | 文件数 | 占比 |
|--------|--------|------|
| .ts | 238 | 83.8% |
| .md | 20 | 7.0% |
| .json | 13 | 4.6% |
| .cjs | 5 | 1.8% |
| .mjs | 4 | 1.4% |
| .png | 1 | 0.4% |
| .ps1 | 1 | 0.4% |
| .bak | 1 | 0.4% |

**框架/关键依赖(推断自 package.json):**

| 依赖 | 用途(推断) | 版本 | 运行时 | 范围 |
|------|--------------|------|--------|------|
| `esbuild` | 构建工具 | ^0.20.0 | Node.js | dev |
| `typescript` | 语言/类型 | ^5.3.3 | Node.js | dev |
| `vitest` | 测试框架 | ^1.3.0 | Node.js | dev |
| `eslint` | 代码检查 | ^8.57.0 | Node.js | dev |

**包管理器:** npm

**入口(main/bin):** `out/extension.js`



### 4.2 依赖清单

| 依赖 | 版本 | 范围 |
|------|------|------|
| `@modelcontextprotocol/sdk` | ^1.0.0 | prod |
| `chokidar` | ^3.6.0 | prod |
| `json5` | ^2.2.3 | prod |
| `yaml` | ^2.9.0 | prod |
| `@types/glob` | ^8.1.0 | dev |
| `@types/node` | ^20.11.0 | dev |
| `@types/vscode` | ^1.85.0 | dev |
| `@typescript-eslint/eslint-plugin` | ^7.0.0 | dev |
| `@typescript-eslint/parser` | ^7.0.0 | dev |
| `@vitest/coverage-v8` | ^1.6.1 | dev |
| `@vscode/test-electron` | ^2.3.8 | dev |
| `esbuild` | ^0.20.0 | dev |
| `eslint` | ^8.57.0 | dev |
| `prettier` | ^3.2.5 | dev |
| `typescript` | ^5.3.3 | dev |
| `vitest` | ^1.3.0 | dev |
| `vsce` | ^2.15.0 | dev |

---

## 五、故障排查

**把项目跑起来**

- 启动链路未能自动检出(原因见附录 C):先确认依赖已安装,再按 `package.json` 的 `scripts` 与项目 README 人工确认启动方式。

**能力清单看起来太少?**

- 本扫描器识别 npm scripts、HTTP 路由(`app.get()` 类惯例)、事件发布(`emitter.emit()` / `this._onX.fire()` 惯例)、命令/工具注册(`registerCommand` / MCP tool / CLI command)。项目若用其他注册风格,用 `--patterns` 自定义提取器补充后重扫。

**怀疑文档过期?**

- 用附录 C 的基线 commit 自查:`git log --oneline <基线>..HEAD`;项目结构大改后用 `/ql-scan --force` 重扫。

---

## 本章小结

<!-- manual:summary -->
- 本章认识了 vscode-ue-helper:19 个 npm 命令、3 个事件、36 处命令/工具注册(27 个 VSCode 命令 + 9 个 MCP 工具)。
- 启动链路未自动检出,排查方式见 §五 与附录 C。
- 完整能力清单与证据在 [§三](#三使用说明);配置与限制在 [§四](#四配置与限制)。

(以上为生成器初稿;欢迎人工改写要点回顾)
<!-- /manual:summary -->

## 下一章

<!-- manual:next -->
- 全书目前只有这一章(起步);每次 `/ql-deliver` 交付后会追加新的功能章,并归入目录中的篇(见首页目录)。
- 想先动手?回到 [§二 快速上手](#二快速上手) 把命令跑一遍。

(以上为生成器初稿;欢迎人工按学习路径指定下一章——不必等于交付顺序)
<!-- /manual:next -->

---

## 附录 A · 交付与开发留档

(本附录面向维护者与 AI 审计,使用者可跳过)

### A.1 扫描信息

| 字段 | 值 |
|------|---|
| 来源命令 | /ql-scan |
| 扫描路径 | . |
| 扫描基线 commit | 9b73e260e6b6446b3caa20325e6f31cbc071b657 |
| 扫描条目数 | 330(目录树显示 80) |
| 生成时间 | 2026-09-28T08:08:12.386Z |

### A.2 新代码放哪(推断指引)

| 要新增的内容 | 建议位置(推断) |
|--------------|------------------|
| API 端点 | 遵循项目现有分层;若无路由目录,建议新建 routes/ 并在入口注册 |
| 业务逻辑 | 与现有模块就近放置,保持单一入口 |
| 测试 | 跟随现有测试目录,与被测文件同名 |

### A.3 下一步

- 尚无 OpenAPI 契约 → 运行 `/ql-design` 生成契约(§3.2 路由清单可作为讨论输入)
- 已有 OpenAPI 契约 → 运行 `/ql-build` 直接构建

---

## 附录 B · 与上一章节对比

无(本章节为初始化章节,是文档树的第一个节点;后续交付章节的对比见各章节附录 B)。

---

## 附录 C · 数据来源与验证

### C.1 关联文档

- [文档树索引](../README.md)
- 项目状态:[../.planning/STATE.md](../../.planning/STATE.md)
- OpenAPI 契约:[.planning/context/openapi.yaml](../../.planning/context/openapi.yaml)

### C.2 未检出清单

| 项 | 状态 | 原因 | 建议 |
|----|------|------|------|
| HTTP 路由 | 未检出(Not detected) | 未在路由语境文件(`*routes*`/`*router*`/`*controller*` 或 `app.xxx()` 调用)中发现端点声明 | 若使用装饰器/配置式等其他路由风格,用 `--patterns` 自定义提取器补充,或运行 `/ql-design` 生成契约 |
| 命令/工具注册 | 未检出(Not detected) | 未发现 `registerCommand` / MCP `server.tool` / CLI `program.command` 类调用 | 若项目有其他注册风格,用 `--patterns` 自定义提取器补充 |
| 启动链路 | 未检出(Not detected) | package.json 无 start/dev 脚本 | 以项目 README 或 `package.json` 的 scripts 为准人工确认 |

### C.3 证据与推断约定

- §三 各表中的 `文件:行号` 是**证据锚点**——每条能力均从代码反推,可对照源码核实。
- 带"(推断)"的内容(目录职责、依赖用途、新代码位置)来自命名约定词典,**是推断而非事实**,以实际代码为准。
- 新鲜度:frontmatter `last_mapped_commit` 即生成时的 git HEAD;运行 `git log --oneline <基线>..HEAD` 判断文档是否过期。

### C.4 变更日志

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-09-28T08:08:12.386Z | 自动生成 | 由 `/ql-scan` 初始化,基线 commit `9b73e260` |
| 2026-10-03 | add | ClangdLocator 统一 clangd 路径解析:懒探测+缓存+失效,两视图(proxy 排除 launcher / SDK 推导 clang 驱动器);realClangdResolver 与 windowsSdk 重复链路收敛,默认 LLVM 目录唯一份,proxy 链路新增 where 候选级;36 端点对外行为不变(决策 D8)(add-003) |
