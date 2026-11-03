---
bugfix: 003
slug: audit-fixes
status: fixed
fixed_at: '2026-10-11T16:55:00+08:00'
severity: major
review: skipped
---

# bugfix-003:整仓审计发现的三处缺陷(installRules 覆盖用户文件 / mutate 并发丢写 / 关联表无界增长)及死代码清理

## 现象

本报告登记 2026-10-11 整仓质量审计(ponytail-audit,约 90 文件/27k 行深读)发现并修复的缺陷与清理。用户可见的失败表现:

- **F1(major,数据丢失)**:执行 Install Rules 命令时,`.github/copilot-instructions.md`(GitHub Copilot 官方用户自定义指令路径)被静默覆盖为插件内置内容,无检查、无备份、无提示;随后 Uninstall 还会删除该文件——用户手写的 AI 指令不可找回。
- **F2(minor,低概率丢配置)**:`.clangd` 的 `mutate`(读→改→写回)无互斥;控制面板快速连点两个开关时两次调用交错,后写者覆盖先写者,配置丢失且难复现排查。
- **F3(minor,泄漏)**:LSP 代理 `RequestCorrelation` 表只在响应到达时移除条目;请求取消、clangd 崩溃、连接关闭导致的在途请求永久滞留,IDE 长开缓慢累积。

**时序说明(如实登记):** 本次为审计驱动的批量修复,修复先于补档完成,未走"先写失败测试再修"的标准时序;补档时以 **stash 验证**补齐了"回归测试在旧代码下真实失败"的证据(见复现路径),并做了全仓同类模式扫描。死代码清理(F4–F8)与缺陷修复同批完成,一并列档。

## 复现路径

回归测试在修复被 stash(还原为旧代码)后真实失败,恢复修复后转绿(fresh evidence):

- **F1**:`test/unit/commands/installRules.test.ts > copilot 文件已存在且用户未选覆盖 → 只写 cursor 文件,不覆盖现有内容`
  - 旧代码:FAIL(静默写入两个文件)→ 修复后:PASS
- **F2**:`test/unit/clangd/clangdOps.test.ts > 并发 mutate 串行执行,两次修改都保留在结果里([审计 F2])`
  - 旧代码:FAIL(结果只剩 `['base', 'second']`,first 被覆盖)→ 修复后:PASS
- stash 验证输出:`Tests 2 failed | 15 passed (17)`;恢复后 `17 passed (17)`
- F3 无专项测试(行为变化仅 `close()` 时清空 Map,由既有 proxy 测试回归保障)

## 根因

- **F1**:installRules 把插件专属语义("安装规则文件")套在了**非插件专属的官方共享路径**上,写入前未检查目标归属——根因是"对共享路径缺少存在性检查 + 用户确认"。
  - 引入点:installRules 初版(模式参考 engine-link);类别:边界遗漏
- **F2**:`ClangdOps.mutate` 是 read-modify-write,await 间隙允许第二次调用读入同一份旧内容——根因是"事务入口缺串行化"。
  - 类别:并发边界遗漏(SSoT 收敛后 mutate 成为唯一 .clangd 写入口,但未加互斥)
- **F3**:关联表的生命周期与连接生命周期未绑定,条目删除只挂在"响应到达"单一路径上——根因是"资源清理未覆盖异常路径(取消/崩溃/关闭)"。
  - 类别:错误处理缺失

## 修复

| 文件 | 位置 | 变更 |
|------|------|------|
| src/commands/installRules.ts | :48-77 | 写 copilot 文件前 `fs.access` 探测;已存在时弹 覆盖/跳过 确认,跳过则只写 Cursor 规则并在摘要说明 |
| src/i18n/locales/zh.json / en.json | :267-270 | 新增 `installRules.copilotExists / overwrite / skip / skippedCopilot` 四条文案 |
| src/clangd/clangdOps.ts | :57-66, :186-199 | `mutate` 经 `mutateQueue` Promise 链串行化,前次失败不阻塞后续 |
| src/clangd/proxy/bridge.ts | :764-775 | `close()` 中 `correlation.clear()` |
| src/clangd/workspaceBackup.ts | 全文件 | 删除未使用的 `startWatching()` + watcher 字段(启用会回滚用户对 .code-workspace 的手动编辑,死代码带雷)[审计 F4] |
| src/extension.ts | :27-28, :155-158 | 删除从未 push 的 `disposables` 数组与 deactivate 空转循环 [F5] |
| src/clangd/proxy/bridge.ts | applyLocalizationToResponse | 删除 completion/signatureHelp/inlayHint 三个 no-op 本地化占位函数及分发 [F6] |
| src/core/subprocessRegistry.ts | :218-229 | 删除收集后不使用的 `stderrChunks` [F8] |
| test/unit/commands/clangdProxyCommands.test.ts.bak | 删除 | 编辑器备份残留文件 [F7] |

**提交:** 未提交(工作区待用户确认;建议 `fix(bugfix-003): 审计修复——installRules 覆盖确认、mutate 串行化、关联表清理 + 死代码清理`)

## 回归验证(fresh evidence)

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run test:unit` | PASS | 112 文件 / 1362 测试全绿(净增 3 个回归用例) |
| `npm run typecheck` | PASS | 无输出 |
| `npm run lint` | PASS(与基线一致) | 63 项既有问题,本次改动零新增(stash 前后对比一致) |
| stash 验证(旧代码跑新测试) | FAIL→PASS | 2 failed / 15 passed → 恢复后 17/17,证明回归测试锁定 F1/F2 |

## 同类检查

- [x] `grep` 扫描同模式代码
- **F1 同模式(`fs.writeFile` 覆盖用户路径):** `completionFiles.ts` 已有"已存在绝不覆盖"保护;`modifyRspFiles.ts` / `formatTidyFiles.ts` 写的是 UBT 生成物;`.cursor/rules/unreal-cpp.mdc` 同为直接覆盖但文件名插件专属,覆盖语义可接受——**记录 1 处待观察,不修**。
- **F2 同模式(read-modify-write):** `mutate` 是唯一的 .clangd 写入口(SSoT),无第二个并发写方;`workspaceBackup` 为文件复制不适用——无同类。
- **F3 同模式(只增不减的 Map):** bridge 的 `lastDocVersions` / `originalUris` 在 `didClose` 有清理,增长以打开文件数为上界——有界,不修。

## 遗留与顺带发现

- 审计报告未逐行深读的部分:`ui/controlPanel*`、`compileCommandsFallback.ts`、`completionFiles.ts`、`createProject.ts`、`firstRunInit.ts`、`genericTranslator.ts`、`detection/`、e2e 套件(下次审计补)。
- 仓库根 `features.json` / `patterns.json` 为 /ql-scan 产物,未跟踪;是否入库或 gitignore 待用户决定。
- 既有 lint 63 项(3 error / 60 warning)为历史遗留,本次未动。
- `forceReparseOpenFiles` 注入 didChange 复用旧 version 是否被 clangd 接受,需真机验证,未查证。

## 旅程日志(≤5 条)

- 审计先行(ponytail-audit 全仓深读)比逐 bug 等报错更划算:三处缺陷中两处(F1/F2)在用户报障前拦截。
- 事后补档用 `git stash` 验证回归测试锁定,可以补齐"先红后绿"证据,无需重做修复。
- 删 `startWatching` 这类"看起来是功能"的死代码前先全仓 grep 调用方(含测试)——本次确认零调用才删。
- 教训:审计/评审类工作完成后应立即按 bugfix 流程留档,避免修复脱离工作流记录(本次即补档动因)。
