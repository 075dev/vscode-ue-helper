# Phase 8: ue-header-auto-sync - Discussion Log

**Gathered:** 2026-07-05
**Mode:** discuss (default)

## Areas Presented

| # | Area | Outcome |
|---|------|---------|
| 1 | 用户控制（默认开启 vs setting 控扭） | 选「默认开启 + setting 可关」 |
| 2 | 错误处理（弹窗 vs 静默 vs 静默重试） | 选「静默重试 + Output 日志」 |
| 3 | 手动命令与 watcher 冲突 | 选「手动命令取消 pending debounce」 |
| 4 | 触发范围（仅 .h + 反射宏 vs 所有 .h） | 选「仅 .h + 仅 UE 反射宏」 |

## Already-Decided (from prior conversation in this session)

- 触发事件：`onDidSaveTextDocument`（不用 FileSystemWatcher）
- debounce：1500ms
- 调用：`generateCompileCommands({ project, engineRoot, logger })`
- 状态栏反馈：`$(sync~spin)` + `$(check)` + `$(warning)`
- 项目过滤：仅 `workspace.projectFolder` 内的 `.h`

## Carried Forward from Phase 7

- D-04/D-05: 状态栏 disposable 模式
- D-06: 新增 setting 模式（showPerfInStatusBar 同模式）
- D-08: Phase 7 增量指纹缓存层直接复用

## Deferred (not in this phase)

- UE 类型补全（Phase 8 后续子功能）
- include 路径补全（Phase 8 后续子功能）
- 跳转定义穿透（Phase 8 后续子功能）
- 引用搜索识别反射（Phase 8 后续子功能）
- Hot Reload 联动（Phase 9）
- ueClangdCompat.h 兜底覆盖 FID_*（方案 3，未采纳）

## Agent Discretion

- debounce 具体实现（setTimeout vs 队列批处理）
- 反射宏正则字符类细节
- 状态栏消息 i18n key 命名
- 单元测试用例边界条件

## Final CONTEXT.md

`.planning/phases/08-ue-header-auto-sync/08-CONTEXT.md` — 15 个 D-decisions 锁定，1 个 spec-free 范围明确。