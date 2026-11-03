---
bugfix: 001
slug: live-coding-connects-existing-project
status: fixed
fixed_at: 2026-09-17T22:40:00+08:00
severity: major
review: approved
---

# bugfix-001:Live Coding 按钮打开新项目而非连接现有编辑器热重载

## 现象

- 用户报告:点击 Live Coding 按钮后,会**打开一个新的项目**(UE 弹出编辑器实例/项目管理器)然后进行热重载;期望是直接连接**现有**项目进行热重载。
- 代码证据:旧命令为 `UnrealEditor.exe -ExecCmds="LiveCoding.Compile" -nullrhi -unattended`,无 `-Project` 参数 → UE 收到无项目启动时打开项目管理器。

## 复现路径

- 测试:`test/unit/build/liveCoding.test.ts` → `resolveLiveCodingCmd(bugfix-001: 连接现有项目热重载)`
- 修复前 4/4 断言失败(✗ 复现确认):
  - `expected 'E:\UE_5.3\...\UnrealEditor.exe' to be '...Build.bat'`
  - `expected '-ExecCmds="LiveCoding.Compile" -nullr…' to contain '-Project='`
  - `expected [...] to include '-LiveCoding'`
  - `expected '...' not to contain 'ExecCmds'`
- 修复后 4/4 通过(✓)。

## 根因

`resolveLiveCodingCmd`(src/build/ubt.ts)把 Live Coding 实现为"启动一个不带 `-Project` 的全新 `UnrealEditor.exe` 实例并用 `-ExecCmds` 让新实例自己热重载",而非同文件注释中已声明的 UBT `-LiveCoding` 方式(UE 官方等价于编辑器内 Live Coding 按钮,连接正在运行的编辑器);缺 `-Project` 导致 UE 打开项目管理器,且热重载作用在多余的新实例上。

- 引入点:`resolveLiveCodingCmd` 初版即如此;`LiveCodingOptions.projectPath` 字段自始存在却从未被使用,相邻的 `launchEditor` 同样接收 `projectPath` 并正确传给编辑器,证明是接线遗漏而非设计决策。
- 类别:逻辑错误(实现方式选错 + 参数遗漏)。

## 修复

| 文件 | 位置 | 变更 |
|------|------|------|
| src/build/ubt.ts | resolveLiveCodingCmd | 重写为复用 `buildUBTCommand` + 追加 `-LiveCoding`(签名改为 `(args: UBTArgs)`) |
| src/build/liveCoding.ts | triggerLiveCoding | 改用 `runBuild` 执行(Build.bat 需 cmd.exe /c 包装,见 F1-1)并等待 UBT 退出;`LiveCodingOptions` 增加 `configuration`/`targetType` |
| src/commands/liveCoding.ts | executeLiveCoding | 传入 `config.configuration`/`config.target`;处理成功/取消/失败三分支反馈(取消走 `cmd.buildCancelled` 中性提示);UBT 进度推给 withProgress;token→AbortController 桥接使取消按钮生效(评审 critical-1) |
| test/unit/build/liveCoding.test.ts | 新增 | 回归测试 4 例锁定命令契约(入口 Build.bat、带 -Project、带 -LiveCoding、无 ExecCmds) |

**提交:** 未提交(工作区尚有用户进行中的其它变更,由用户决定提交时机;建议 `fix(bugfix-001): Live Coding 改用 UBT -LiveCoding 连接现有编辑器`)。

## 回归验证(fresh evidence)

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run typecheck` | PASS | 无错误 |
| `npm test`(vitest) | PASS | 1229/1229(100 文件,含新增回归测试) |
| `npm run build`(esbuild) | PASS | out/ 产物正常 |
| `npx eslint`(改动 4 文件) | PASS | 0 错误 |

## 同类检查

- [x] `grep` 扫描同模式代码
- 结论:**无同类缺陷**。`ExecCmds` 无代码残留(仅注释说明);`launchEditor.ts` 的 `spawn` 是"启动编辑器"命令的本职用途且正确携带 `projectPath`;`src/build/` 下无其它绕过 `runBuild` 的 UBT 调用。

## 遗留与顺带发现

- 全量 lint 存在 12 个**预先存在**的错误(`test/unit/commands/switchHeaderSource.test.ts`、`test/unit/ui/notifications.test.ts`,均为工作区未提交文件),与本次修复无关,未顺带修改。
- 编辑器未运行时,UBT `-LiveCoding` 会回退为普通全量构建(耗时较长);后续可考虑用 `editorDetect.isUnrealEditorRunning` 先行提示(现成基础设施,未纳入本次最小修复)。
- (评审 non-critical-2)`triggerLiveCoding` 的 wiring 无单元测试覆盖(若 `project: opts.projectPath` 回归遗漏,resolveLiveCodingCmd 的测试仍绿);后续可补 runBuild 注入式测试。
- (评审 non-critical-4)`liveCoding.triggered` 文案("已触发")滞后于同步等待编译完成的语义,纯文案问题。

## 评审记录

- 第 1 轮(ql-reviewer):`criticals_found` —— critical-1:withProgress 取消按钮 no-op(token 未桥接 signal,cancelled 分支不可达)。
- 第 2 轮(ql-reviewer 复审):**PASS** —— token→AbortController→runBuild({signal}) 桥接与 build.ts 同构,预取消检查覆盖选择器阶段取消窗口,cancelled 分支可达且不误报失败;无新问题。

## 旅程日志(≤5 条)

- 第一次写复现测试时误用了目标签名(UBTArgs 对象)调旧 2 参签名,得到 `Unsupported platform: [object Object]` 的**报错**而非断言失败——按工作流"复现不干净"规则,改用旧签名写行为断言,得到干净的 AssertionError 后才开始修代码。
- typecheck 抓到 `engineRoot` 参数在 UBT 方式下不再需要(`ubtPath` 已含完整路径),收敛为单参数签名。
