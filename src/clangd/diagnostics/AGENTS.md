<!-- Parent: ../AGENTS.md -->
# clangd/diagnostics —— "Diagnose Clangd Project" 检查器

> 治理参考：`.specify/memory/constitution.md` §III（Localized, Observable, Resource-Safe UX）。本目录是 `vscodeUEHelper.diagnoseProject` 命令的内部检查器集合；输出走 i18n 双语文本 + 结构化报告，**不**自动修复，只诊断。

## 模块概述

被 `src/commands/diagnoseProject.ts` 调用，串行执行一组只读检查（环境 / 配置文件 / 文件存在性 / 内容合法性），把每项的 pass / fail + 详细原因组装成可读报告。

## 核心文件

| 文件       | 职责                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------ |
| `checks.ts` | 检查器实现（compile_commands.json / `.clangd` / 系统包含路径 / 补全文件存在性 / 缓存）    |
| `io.ts`    | 只读 fs 封装（`readIfExists` / `statSafe`）                                                |
| `format.ts`| 报告文本格式化（按层级缩进、双语 key 渲染）                                                |
| `types.ts` | `CheckResult` / `DiagnosticReport` 等结构化类型                                            |

## 关键约束

- **只读不写** —— 本目录**绝对不**触发 `ClangdOps` 写 `.clangd`、不跑 UBT / 不重启代理；只读取状态并报告
- **无 `index.ts`** —— 是设计如此；从 `diagnoseProject.ts` 内部按需 `import`（`no-restricted-imports` 锁定 barrel 滥用）
- **报告 i18n 双语** —— 用户可见字符串走 `t('diagnose.*', params)`，`en` 与 `zh` 同步
- **失败不抛异常** —— 每个检查独立 try / catch，失败时返回结构化 `CheckResult`，不中断后续检查

## 检查项概览

| 检查                     | 关注点                                                    |
| ------------------------ | --------------------------------------------------------- |
| `compileCommandsExists`  | `compile_commands.json` 是否存在                          |
| `compileCommandsFresh`   | `compile_commands.json` mtime 是否晚于 `.uproject`        |
| `clangdConfigValid`      | `.clangd` YAML 解析 + 关键字段（CompileFlags.Add）完整性 |
| `systemIncludesValid`    | MSVC + Windows SDK 头路径可达                            |
| `completionFilesExist`   | `addCompletions.h` / `addMacroCompletions.h` 等补全文件齐备 |
| `cacheConsistent`        | `.clangd` 指纹与缓存键一致                                |

## 跨模块约束

- **不依赖 `vscode.window.show*`** —— 本目录是纯逻辑，UI 由 `diagnoseProject.ts` 命令层负责
- **不调 `@build` / `@clangd/clangdOps`** —— 避免循环依赖；如需复用读取逻辑，提到 `@core` 或 `@clangd` 顶层
