---
status: testing
phase: 08-ue-header-auto-sync
source: 08-01-SUMMARY.md, 08-01-PLAN.md
started: 2026-07-06T01:38:31Z
updated: 2026-07-06T01:41:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

number: 7
name: Functional — .generated.h / non-.h / outside-projectFolder / no-macro saves do NOT trigger
expected: |
  保存 (a).generated.h (b).cpp (c)路径在 projectFolder 之外的 .h (d)不含 UE 反射宏的 .h → 全部不触发 UBT；[headerWatcher] log 不增加新条目。
awaiting: user response

## Tests

### 1. Module exports — startHeaderWatcher + cancelHeaderWatcherTrigger
expected: src/clangd/headerWatcher.ts 导出 startHeaderWatcher（4 参数）+ cancelHeaderWatcherTrigger（bare function）。测试文件 test/unit/clangd/headerWatcher.test.ts 存在且 8 个用例覆盖宏过滤 / debounce / cancellation。
result: pass
evidence: headerWatcher.ts:240 + :261 导出；test 文件 11969 字节，8 个 it/test 用例。

### 2. Cancellation hook wired into executeGenerateCompileCommands
expected: src/commands/generateCompileCommands.ts 顶部 import cancelHeaderWatcherTrigger；在 executeGenerateCompileCommands 函数体内、任何 await 之前第一个调用 cancelHeaderWatcherTrigger()（保证手动 UBT 触发不会与 pending debounce 双发）。
result: pass
evidence: generateCompileCommands.ts:31 import；:38 cancelHeaderWatcherTrigger() 在函数体顶部。

### 3. Extension activation wires startHeaderWatcher between activateClangd and activateUI
expected: src/extension.ts import startHeaderWatcher；在 activate() 中调用次序：… activateClangd() → startHeaderWatcher(context, config, logger, workspace) → activateUI()。
result: pass
evidence: extension.ts:48 activateClangd → :50 startHeaderWatcher → :51 activateUI；D-14 注释就位。

### 4. Config setting clangdHeaderWatcher.enabled (default true)
expected: package.json contributes.configuration 有 vscodeUEHelper.clangdHeaderWatcher.enabled（boolean, default true）；src/core/config.ts 提供 get clangdHeaderWatcherEnabled(): boolean。
result: pass
evidence: package.json:374 注册；config.ts:201 getter，fallback ?? true。

### 5. i18n keys present in both locales
expected: src/i18n/locales/en.json 与 zh.json 各含 headerWatcher.regenerating / headerWatcher.synced / headerWatcher.failed 三键；英文值带 "$(sync~spin)" / "$(check)" / "$(warning)" 图标前缀。
result: pass
evidence: en.json 3 键 + zh.json 3 键，全部带 Unicode 图标前缀。

### 6. Functional: save UE-reflection .h inside projectFolder triggers debounced UBT regen
expected: F5 启动 EDH → 在 workspace.projectFolder 内保存带 UPROPERTY/UFUNCTION/UFUNCTION 宏的 .h → 约 1.5s 后状态栏短暂显示 "$(sync~spin) UHT regenerating…"，随后变 "$(check) UHT synced"。Output Channel [headerWatcher] 有触发日志。
result: pass
evidence: 日志链完整 scheduled→ENTRY→cache HIT→regen success (EnemyCharacterBase.h)。watcher 机制按设计工作。
NOTE: 用户报告"宏报错依旧存在"——与 watcher 机制无关，是独立的 compile_commands.json 内容或 clangd 配置问题，见 Gaps #1。

### 7. Functional: .generated.h / non-.h / outside-projectFolder / no-macro saves do NOT trigger
expected: 保存 (a).generated.h (b).cpp (c)路径在 projectFolder 之外的 .h (d)不含 UE 反射宏的 .h → 全部不触发 UBT；[headerWatcher] log 不增加新条目。
result: [pending]

### 8. Functional: enabled=false short-circuits watcher
expected: 设置 vscodeUEHelper.clangdHeaderWatcher.enabled=false → 重新加载窗口 → 保存合格 .h → 不触发 UBT，不显示状态栏消息。
result: [pending]

### 9. Functional: manual command cancels pending auto-debounce (no double-fire)
expected: 保存合格 .h → 在 1.5s debounce 期间手动执行 vscodeUEHelper.generateCompileCommands → 立即观察到 cancelHeaderWatcherTrigger 日志；最终只有 1 次 UBT 子进程启动。
result: [pending]

### 10. Functional: UBT failure logged, NO popup
expected: 让 UBT 失败（如临时破坏一个 .Build.cs）→ 保存合格 .h → 失败后在状态栏短暂显示 "$(warning) UHT regen failed (see Output)"；Output Channel [headerWatcher] 有错误日志；绝无 vscode.window 弹窗。
result: [pending]

## Summary

total: 10
passed: 6
issues: 1
pending: 4
skipped: 0
blocked: 0

## Gaps

- truth: "保存含 UE 反射宏的 .h 后，compile_commands.json 应被正确刷新，从而 clangd 能正确解析 UCLASS/GENERATED_BODY 宏"
  status: failed
  reason: "User reported: HeaderWatcher 日志链完整 (scheduled→ENTRY→cache HIT→regen success)，但 clangd 对 UCLASS()/GENERATED_BODY() 宏依旧报错；疑似根因 = (a) compile_commands.json 内容缺乏 UE include 路径或宏定义 或 (b) cache HIT 跳过的 UBT 本就没生成正确的 compile_commands.json 或 (c) clangd/clangUEHelper 实际未使用新生成的 compile_commands.json"
  severity: major
  test: 6
  root_cause: "Phase 7 缓存两个缺陷叠加：(1) ccPath 写入缓存时指向引擎安装目录 `D:\Program Files\UE_5.8\compile_commands.json` 而非工程 `.vscode/vscodeuehelper/compile_commands.json`；(2) 缓存 fingerprint 仅含 .uproject/Build.cs/Target.cs — .h 文件变更不会使缓存失效 → HeaderWatcher 触发 generateCompileCommands 时总是走快路径、跳过 UBT/UHT → .generated.h 不刷新 → clangd 用过期宏定义报错。清除缓存后用户验证错误消失，证实诊断。"
  artifacts:
    - path: "src/clangd/compileCommands.ts"
      issue: "Phase 7 快路径缓存使用 .uproject/Build.cs/Target.cs fingerprint，忽略 .h 变更"
    - path: "src/clangd/compileCommandsCache.ts"
      issue: "缓存 seed 后 ccPath 指向引擎目录而非工程目录"
    - path: "src/clangd/headerWatcher.ts"
      issue: "触发前未 invalidate 缓存 → 快路径跳过 UBT/UHT"
  missing:
    - "headerWatcher 在 generateCompileCommands 前应 CompileCommandsCache.invalidate(workspace.projectDir)"
  debug_session: ""
