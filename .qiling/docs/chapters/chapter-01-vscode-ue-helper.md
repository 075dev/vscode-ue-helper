---
chapter_id: "chapter-01"
title: "vscode-ue-helper"
phase: init
generated_at: "2026-09-19T15:12:20.601Z"
generated_by: "器灵工作流 v0.15.0 / ql-scan"
ql_version: "0.15.0"
last_mapped_commit: "0d738d8c034275d9f3f6154931d55a30101c7c48"
status: "initialized"
docsmap_init: true
scan_path: "."
scanned_entries: 935
routes_detected: 0
events_detected: 1
endpoints: 0
events: 1
---

# 第 01 章 · vscode-ue-helper(初始化)

> **本文档由 `/ql-scan` 生成** —— 通过阅读项目目录结构,产出与 `/ql-doc` 完全一致格式的初始化章节。
> 进入开发流程后,新章节由 `/ql-doc` 追加,本章节作为起点。
> **不要手改本文件** —— 项目结构变化后用 `/ql-scan --force` 重扫覆盖。

---

## 章节摘要

| 字段 | 值 |
|------|---|
| 章节 ID | chapter-01 |
| 来源命令 | /ql-scan |
| 扫描路径 | . |
| 项目名 | vscode-ue-helper |
| 扫描基线 commit | 0d738d8c034275d9f3f6154931d55a30101c7c48 |
| 扫描条目数 | 935(目录树显示 80) |
| 命令数(npm scripts) | 19 |
| 路由数(带证据) | 0 |
| 事件数(带证据) | 1 |
| 状态 | initialized |

**项目定位:** All-in-one VS Code plugin for Unreal Engine C++ development: UBT build, Live Coding hot-reload, clangd IntelliSense, and optional MCP AI agent integration.(来自 package.json description)

---

## 一、本章节承载的能力(从代码扫描)

> 本节所有条目均为**从代码反推的已存在能力**,每条附 `文件:行号` 证据。
> 与 OpenAPI 契约的对应关系待 `/ql-design` 后补全;在此之前,本节就是当前能力的唯一清单。

### 1.1 命令清单(package.json scripts,原样列出)

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

### 1.2 HTTP 路由(证据锚点)

未检出 HTTP 路由(Not detected)——未在路由语境文件(`*routes*`/`*router*`/`*controller*` 或 `app.xxx()` 调用)中发现端点声明。若项目使用其他路由风格(如装饰器/配置式路由),请人工补充或先运行 `/ql-design` 生成 OpenAPI 契约。

### 1.3 事件发布(证据锚点)

| 事件名 | 动作 | 证据(文件:行) |
|--------|------|------------------|
| `exit` | emit | `test/unit/core/subprocessRegistry.test.ts:88` |

---

## 二、项目结构与启动流程

### 2.1 技术栈

**语言分布(按文件扩展名统计,扫描范围内全部文件):**

| 扩展名 | 文件数 | 占比 |
|--------|--------|------|
| .log | 249 | 36.0% |
| .ts | 227 | 32.9% |
| .pak | 58 | 8.4% |
| .json | 53 | 7.7% |
| .md | 41 | 5.9% |
| .adml | 14 | 2.0% |
| .dll | 10 | 1.4% |
| .ps1 | 6 | 0.9% |

**框架/关键依赖(推断自 package.json):**

| 依赖 | 用途(推断) | 版本 | 运行时 | 范围 |
|------|--------------|------|--------|------|
| `esbuild` | 构建工具 | ^0.20.0 | Node.js | dev |
| `typescript` | 语言/类型 | ^5.3.3 | Node.js | dev |
| `vitest` | 测试框架 | ^1.3.0 | Node.js | dev |
| `eslint` | 代码检查 | ^8.57.0 | Node.js | dev |

**包管理器:** npm

### 2.2 依赖清单

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

### 2.3 目录树(深度 ≤ 4,忽略 node_modules/dist/build/.git 等)

```
📄 .eslintrc.json
📄 .gitattributes
📄 .gitignore
📄 .mcp.json
📁 .omc/
  📄 .omc/deepinit-manifest.json
  📁 .omc/handoffs/
    📄 .omc/handoffs/team-plan.md
    📄 .omc/handoffs/team-verify.md
  📁 .omc/plans/
    📄 .omc/plans/architecture-improvement-2026-07-29.md
  📄 .omc/project-memory.json
  📁 .omc/sessions/
    📄 .omc/sessions/954be90f-c24d-45f0-a5e2-771775b22c06.json
    📄 .omc/sessions/e69315ee-bfc7-43ad-b830-ce5c86a018d1.json
    📄 .omc/sessions/f56d956f-0498-491e-8bda-75de8f40620f.json
  📁 .omc/state/
    📄 .omc/state/hud-stdin-cache.json
    📁 .omc/state/session-end-jobs/
      📄 .omc/state/session-end-jobs/954be90f-c24d-45f0-a5e2-771775b22c06.json
      📄 .omc/state/session-end-jobs/discovery.json
      📄 .omc/state/session-end-jobs/e69315ee-bfc7-43ad-b830-ce5c86a018d1.json
      📄 .omc/state/session-end-jobs/f56d956f-0498-491e-8bda-75de8f40620f.json
    📁 .omc/state/sessions/
      📁 .omc/state/sessions/5fd108d3-7183-4ca8-a2ab-0b240de8cc9c/
        📄 .omc/state/sessions/5fd108d3-7183-4ca8-a2ab-0b240de8cc9c/hud-state.json
        📄 .omc/state/sessions/5fd108d3-7183-4ca8-a2ab-0b240de8cc9c/session-started.json
      📁 .omc/state/sessions/77781d7a-9581-49d4-abbe-ce16cbcd372b/
        📄 .omc/state/sessions/77781d7a-9581-49d4-abbe-ce16cbcd372b/pre-tool-advisory-throttle.json
        📄 .omc/state/sessions/77781d7a-9581-49d4-abbe-ce16cbcd372b/session-started.json
      📁 .omc/state/sessions/954be90f-c24d-45f0-a5e2-771775b22c06/
        📄 .omc/state/sessions/954be90f-c24d-45f0-a5e2-771775b22c06/hud-state.json
        📄 .omc/state/sessions/954be90f-c24d-45f0-a5e2-771775b22c06/pre-tool-advisory-throttle.json
        📄 .omc/state/sessions/954be90f-c24d-45f0-a5e2-771775b22c06/subagent-tracking-state.json
      📁 .omc/state/sessions/afef740d-4a9a-4064-8252-cc0ebf85aeb8/
        📄 .omc/state/sessions/afef740d-4a9a-4064-8252-cc0ebf85aeb8/session-started.json
      📁 .omc/state/sessions/e69315ee-bfc7-43ad-b830-ce5c86a018d1/
        📄 .omc/state/sessions/e69315ee-bfc7-43ad-b830-ce5c86a018d1/hud-state.json
        📄 .omc/state/sessions/e69315ee-bfc7-43ad-b830-ce5c86a018d1/pre-tool-advisory-throttle.json
      📁 .omc/state/sessions/f56d956f-0498-491e-8bda-75de8f40620f/
        📄 .omc/state/sessions/f56d956f-0498-491e-8bda-75de8f40620f/hud-state.json
        📄 .omc/state/sessions/f56d956f-0498-491e-8bda-75de8f40620f/last-tool-error-state.json
        📄 .omc/state/sessions/f56d956f-0498-491e-8bda-75de8f40620f/pre-tool-advisory-throttle.json
        📄 .omc/state/sessions/f56d956f-0498-491e-8bda-75de8f40620f/subagent-tracking-state.json
      📁 .omc/state/sessions/review-20260811/
        📄 .omc/state/sessions/review-20260811/cancel-signal-state.json
        📄 .omc/state/sessions/review-20260811/prd.json
        📄 .omc/state/sessions/review-20260811/progress.txt
    📄 .omc/state/team-state.json
📁 .omp/
  📁 .omp/commands/
    📄 .omp/commands/speckit.analyze.md
    📄 .omp/commands/speckit.checklist.md
    📄 .omp/commands/speckit.clarify.md
    📄 .omp/commands/speckit.constitution.md
    📄 .omp/commands/speckit.converge.md
    📄 .omp/commands/speckit.implement.md
    📄 .omp/commands/speckit.plan.md
    📄 .omp/commands/speckit.specify.md
    📄 .omp/commands/speckit.tasks.md
    📄 .omp/commands/speckit.taskstoissues.md
📄 .prettierrc
📁 .serena/
  📁 .serena/cache/
    📁 .serena/cache/typescript/
  📄 .serena/project.local.yml
📁 .specify/
  📄 .specify/feature.json
  📄 .specify/init-options.json
  📄 .specify/integration.json
  📁 .specify/integrations/
    📄 .specify/integrations/omp.manifest.json
    📄 .specify/integrations/speckit.manifest.json
  📁 .specify/memory/
    📄 .specify/memory/.constitution-template.json
    📄 .specify/memory/constitution.md
  📁 .specify/scripts/  # 构建/工具脚本(推断)
    📁 .specify/scripts/powershell/
      📄 .specify/scripts/powershell/check-prerequisites.ps1
      📄 .specify/scripts/powershell/common.ps1
…(共 935 项,已截断显示前 80 项;完整清单请直接浏览目录或收窄 --scan-path)
```

> 目录职责注释(`# xx(推断)`)来自常见命名约定词典,**是推断而非事实**,以实际代码为准。

### 2.4 启动流程

**未能自动检出启动链路(Not detected)。** 原因:package.json 无 start/dev 脚本。
> 本文档不输出臆测的启动图。请以项目 README 或 `package.json` 的 scripts 为准人工确认。

### 2.5 新代码放哪(指引)

| 要新增的内容 | 建议位置(推断) |
|--------------|------------------|
| API 端点 | 遵循项目现有分层;若无路由目录,建议新建 routes/ 并在入口注册 |
| 业务逻辑 | 与现有模块就近放置,保持单一入口 |
| 测试 | 跟随现有测试目录,与被测文件同名 |

> 以上为基于目录结构的推断指引;进入器灵工作流后,以 `/ql-design` 产出的契约为准。

---

## 三、与上一章节的对比

无(本章节为首个文档树节点)。

---

## 四、关联文档

- [文档树索引](../README.md)
- 项目状态:未检出(尚未进入器灵工作流)
- OpenAPI 契约:未检出(运行 /ql-design 后生成)

---

## 五、变更日志

| 日期 | 操作 | 说明 |
|------|------|------|
| 2026-09-19T15:12:20.601Z | 自动生成 | 由 `/ql-scan` 初始化,基线 commit `0d738d8c` |
