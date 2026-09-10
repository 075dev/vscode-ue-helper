<!-- Parent: ../AGENTS.md -->
# src —— 源代码模块索引

> 治理参考：`.specify/memory/constitution.md`。本目录是 VS Code 扩展主进程的 TypeScript 源代码根，按业务领域垂直切分。**业务代码必须用路径别名 import**（`@core` / `@build` / `@clangd` / `@commands` / `@detection` / `@mcp` / `@ui` / `@parsers` / `@i18n`）—— 相对导入在 ESLint 锁定下会被拦下（详见根 `AGENTS.md` 路径别名段）。

## 模块目录

| 模块                  | 路径                          | 内容                                                                        |
| --------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| `core/`               | `src/core/AGENTS.md`          | Logger / Config / WorkspaceState 横切基础设施                               |
| `detection/`          | `src/detection/AGENTS.md`     | `.code-workspace` 解析 / uproject / 引擎发现                              |
| `build/`              | `src/build/AGENTS.md`         | UBT / Live Coding / Editor 启动 / Task Provider（**Windows only**）          |
| `clangd/`             | `src/clangd/AGENTS.md`        | `.clangd` 统一写入 / compile_commands / 补全文件 / workspace 备份            |
| `clangd/proxy/`       | `src/clangd/proxy/AGENTS.md`  | 独立 LSP 代理 CLI 子进程                                                    |
| `clangd/diagnostics/` | `src/clangd/diagnostics/AGENTS.md` | "Diagnose Clangd Project" 命令的检查器                                |
| `commands/`           | `src/commands/AGENTS.md`      | 21 个 VS Code 命令处理器                                                    |
| `ui/`                 | `src/ui/AGENTS.md`            | 状态栏 / QuickPick / 通知 / Problems / Webview / Project Explorer           |
| `mcp/`                | `src/mcp/AGENTS.md`           | MCP 服务器（**仅 Cursor / Claude Code 启动**）                              |
| `i18n/`               | `src/i18n/AGENTS.md`          | 中英双语字符串查找（`t('key', params)`）                                    |
| `parsers/`            | `src/parsers/AGENTS.md`       | MSVC / UBT / 链接器 / `.uproject` 纯函数解析                                |
| `rules/`              | `src/rules/AGENTS.md`         | AI Agent 规则生成（Cursor + Copilot）                                       |
| `extension.ts`        | —                             | 唯一入口，激活顺序硬约束（详见根 `AGENTS.md` §入口与激活顺序）              |

## 路径别名（与 `tsconfig.json` / `esbuild.config.mjs` / `vitest.config.ts` 同步）

```typescript
import { Logger } from '@core/logger';           // ✅
import { WorkspaceState } from '@core/workspace'; // ✅
import { runBuild } from '@build';               // ✅
import { ClangdOps } from '@clangd/clangdOps';   // ✅
// import { Logger } from '../../core/logger';   // ❌ ESLint no-restricted-imports 拦截
```

## 入口顺序硬约束（宪法 §III lifecycle ownership）

`src/extension.ts` 必须按以下顺序激活：

```
initI18n()                                 ← Logger 之前
→ Logger + Config
→ activateDetection(...)
→ new WorkspaceState({ detection, logger })
→ new ClangdOps({ workspace, logger })
→ activateBuild / activateClangd / activateUI
→ activateCommands（最后，依赖全部 handles）
→ ControlPanelProvider.register(...)
```

跨顺序的模块引用会被 `AGENTS.md` 圈定边界后由 `no-restricted-syntax` / `no-restricted-imports` 锁住。
