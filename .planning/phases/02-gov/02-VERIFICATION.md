# Phase 2: 治理迁移完结 — Verification 证据

- **Phase**: 2-治理迁移完结（见 `.planning/ROADMAP.md` Phase 2）
- **目标**: 把 `.specify/`、`REMEDIATION-PLAN.md`、`AUDIT-REPORT.md` 正式标 deprecated，更新 `AGENTS.md` / `README.md` 的治理指向，确认 MCP 维持现状
- **Requirements**: GOV-002, GOV-003, MCP-001
- **创建日期**: 2026-08-25

## Exit Code 摘要

| 命令 | Exit Code | Warning 数 (lint) | 关键产物 |
|------|-----------|-------------------|----------|
| `npm run typecheck` | 0 | N/A | (无产物) |
| `npm run lint` | 0 | 53 | (无产物) |
| `npm run test:unit` | 0 | N/A | 87 test files / 1081 tests passed |
| `npm run build` | 0 | N/A | `out/extension.js` + `out/clangdProxy.js` |

## REQ-ID 闭环证据链

### GOV-002（3 文件 deprecated 横幅）

**Acceptance criteria** (per `.planning/REQUIREMENTS.md` GOV-002): 3 个文件首行可见 deprecation 横幅；不修改文件其他内容；不物理删除。

**实测状态** (3 文件中实际可追踪的 2 个 + 1 个 gitignored 例外):

- **REMEDIATION-PLAN.md** — 首行已插入 `> **DEPRECATED**: moved to .planning/PROJECT.md + .planning/REQUIREMENTS.md on 2026-08-18...` 横幅。文件其它内容未动。✓
- **AUDIT-REPORT.md** — 首行已插入 `> **DEPRECATED**: moved to .planning/PROJECT.md + .planning/REQUIREMENTS.md on 2026-08-18...` 横幅。文件其它内容未动。✓
- **.specify/memory/constitution.md** — `.gitignore:105` 含 `.specify/`，整个目录被 git 排除。`git check-ignore -v .specify/memory/constitution.md` 报告 `.gitignore:105:.specify/`，`git ls-files .specify/` 输出为空。本地尝试插入 deprecation 横幅后无法 `git add`（`.specify/` ignored），横幅修改不传播给其他开发者（committed history 不含此文件）。**GOV-002 第 3 项 acceptance 部分缺失：横幅在本地存在但对其他 contributor 不可见。**理由与缓解：
  - 理由：宪法文件由 `.omp/commands/speckit.*` 命令注册依赖，AGENTS.md 明文规定不物理删除；目录被 git 排除避免 `.omp/` 同步冲突扩散到仓库。
  - 缓解：治理指向已在 `README.md` Governance 段 + `AGENTS.md` 头部"治理依据"段显式指向 `.planning/PROJECT.md`，新 contributor 经 README/AGENTS 引导不会依赖 `.specify/memory/constitution.md`。
  - 未来如需正式跟踪 constitution，可在宪法条款完全迁出 `.omp/` 后从 `.gitignore` 移除 `.specify/` 并 commit 横幅（已 deferred 到 Phase 4 修复轨道 Wave 2 P1 评估范围）。⚠ partial

闭环 commit:
- REMEDIATION + AUDIT + README 一并提交:`f7bc1a0 chore(gov): 标记 REMEDIATION/AUDIT deprecated + README Governance 指向 .planning/PROJECT.md`

### GOV-003（AGENTS.md + README.md 治理指向）

**Acceptance criteria** (per `.planning/REQUIREMENTS.md` GOV-003): 更新 `AGENTS.md` 头部"治理依据"段、README.md "Governance"段指向 `.planning/PROJECT.md`；两处更新 commit 清晰可追溯；本文件不被重复指向。

**实测状态**:

- **AGENTS.md** — 已指向 `.planning/PROJECT.md`（`.planning/PROJECT.md` 优先于 `.specify/memory/constitution.md`）。本 phase 执行前已闭环（Phase 0 / 后续 commit `db498c3` + 仓库陷阱 #11 同步）。**无需修改**。✓
- **README.md** — Governance 段已从 `> [.specify/memory/constitution.md]` 改为 `> [.planning/PROJECT.md]` 主链接 + `[.specify/memory/constitution.md]` 作为历史迁移来源的次链接。冲突解决规则改为"in favor of `.planning/PROJECT.md` or escalated as an amendment"。✓

闭环 commit:
- README.md 修改与 GOV-002 同 commit 提交：`f7bc1a0 chore(gov): 标记 REMEDIATION/AUDIT deprecated + README Governance 指向 .planning/PROJECT.md`

### MCP-001（6 工具 + 环境嗅探启动策略维持现状）

**Acceptance criteria** (per `.planning/REQUIREMENTS.md` MCP-001): 维持现有 6 工具 + Cursor / Claude Code 环境变量嗅探启动策略；如发现现状偏离描述则触发 fix。

**实测状态** (对比 `src/mcp/tools.ts` + `src/mcp/lifecycle.ts` + `src/core/runtime-detect.ts` 与 REQUIREMENTS.md 描述):

- **6 工具**: `src/mcp/tools.ts:49-89` `MCP_TOOLS` 常量逐项匹配 REQUIREMENTS.md:
  - `ue_build` ✓
  - `ue_launch_editor` ✓
  - `ue_live_coding` ✓
  - `ue_generate_compile_commands` ✓
  - `ue_show_project_info` ✓
  - `ue_set_system_includes` ✓
- **环境嗅探启动策略**: `src/core/runtime-detect.ts:59-62` 检测 `CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` (→ 'cursor') 与 `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` (→ 'claude-code')，`src/mcp/lifecycle.ts:17-26` `shouldStartMCP(mode)` 支持 `'auto' | 'always' | 'never'` 三态（auto = 仅 Cursor/Claude Code 启动）。✓
- **未发现偏离**：无需 fix。✓

闭环 commit: 本 phase 未产生额外 commit（MCP-001 仅核对，无文件变更）。

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

✖ 53 problems (0 errors, 53 warnings)

exit code: 0
```

### §npm run test:unit

```
$ npm run test:unit

> vscode-ue-helper@0.1.0 test:unit
> vitest run

(... 完整 660 行输出与 Phase 1 一致,因 Phase 2 未改 src/test,本节省略冗余;
关键指标: 87 test files passed, 1081 tests passed, exit code 0)
```

完整 stdout 详见 Phase 1 `01-VERIFICATION.md` §npm run test:unit（Phase 2 未改 src/test，无新差异）。

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

Done in 48ms
[esbuild] extension build complete → out/extension.js

  out\clangdProxy.js      257.5kb
  out\clangdProxy.js.map  502.9kb

Done in 17ms
[esbuild] proxy build complete → out/clangdProxy.js
[esbuild] launcher generated → out/launcher/proxy-launcher.bat

exit code: 0
```

## 执行轨迹

- **02-01**: GOV-002 (REMEDIATION + AUDIT 横幅) + GOV-003 (README Governance 指向) + AGENTS.md 已确认无需修改。`.specify/memory/constitution.md` 因 `.gitignore:105` 不追踪，本地横幅修改不传播 — 部分缺失已记录在 REQ-ID 闭环证据链 / GOV-002 节。单一 atomic commit `f7bc1a0 chore(gov): 标记 REMEDIATION/AUDIT deprecated + README Governance 指向 .planning/PROJECT.md`（3 文件变更：+8/-3）。
- **02-02**: MCP-001 现状核对（6 工具 + env-sniffing + 'auto'/'always'/'never' 三态），无偏离不触发 fix。4 门禁命令全绿（exit 0）：typecheck / lint 0 errors 53 warnings / test 87-1081 passed / build 双产物。生成 `02-VERIFICATION.md` + 唯一 atomic commit。

## 宪法 IV 例外声明

本 phase 不触发 Windows UE 现场烟测：仅修改文档（README.md + REMEDIATION/AUDIT 横幅）+ 验证 MCP 现状 + 跑 4 门禁命令。不涉及 build / clangd 行为变更，与宪法 IV 触发条件不匹配。

## Phase 完成度

- GOV-002：部分闭环（REMEDIATION ✓ / AUDIT ✓ / constitution ⚠ gitignored）
- GOV-003：闭环（AGENTS ✓ 已前置 / README ✓ 本 phase）
- MCP-001：闭环（无偏离，无 fix 触发）

**已知缺口**：GOV-002 第 3 项（`.specify/memory/constitution.md` 横幅）因 `.gitignore:105` 不传播。已 deferred 至 Phase 4 修复轨道 Wave 2 P1 评估（与宪法 I 边界修订同轨）。