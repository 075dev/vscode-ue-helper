---
chapter_id: "chapter-04"
title: "clangd 的 UE 支持"
feature: "clangd-ue"
part: "第三篇 · IntelliSense"
generated_at: "2026-10-06T14:26:24.447Z"
generated_by: "器灵工作流 v0.20.1 / ql-scan 功能域分章"
ql_version: "0.20.1"
last_mapped_commit: "cd18a09670d8398c5e65825166d9398370ce0093"
status: "scaffold"
endpoints: 0
events: 0
---

# 第 04 章 · clangd 的 UE 支持

> 本章是功能单元 **clangd-ue** 的功能章,正文永远反映**最新状态**;历史变更见附录 B 演进史。
> `<!-- manual -->` 块欢迎人工撰写润色(重扫自动保留);其余机器节不要手改。

**一句话:** compile_commands 生成与回退、UE 宏与补全文件、头源切换、UE 链接管理——UE C++ 的 IntelliSense 全套支持

## 本章导学

<!-- manual:syllabus -->
<!-- auto:BEGIN -->
- **本章你将学到:** clangd 的 UE 支持(clangd-ue)的功能怎么用——50 个源码文件、0 条能力入口(清单见 §三)。
- **前置章节:** 第 01 章(先让项目跑起来)。
<!-- auto:END -->
- **读法:** 查用 → 直接进 §三;想懂设计 → 看来源与证据。
<!-- /manual:syllabus -->

## 一、这个功能是什么

<!-- manual:overview -->
<!-- auto:BEGIN -->
**覆盖能力:** 本章暂未检出能力条目(见附录 C)。

**功能说明:** compile_commands 生成与回退、UE 宏与补全文件、头源切换、UE 链接管理——UE C++ 的 IntelliSense 全套支持
<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充:这个功能解决什么问题、什么时候用、不适用什么场景)
<!-- /manual:overview -->

## 二、快速上手

<!-- manual:quickstart -->
<!-- auto:BEGIN -->
本功能暂未检出直接入口;运行方式见第 01 章快速上手与项目 README。

<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充第一次使用本功能的完整步骤)
<!-- /manual:quickstart -->

## 三、使用说明

### 3.2 归属文件

- `src/clangd/AGENTS.md`
- `src/clangd/clangdConfig.ts`
- `src/clangd/clangdOps.ts`
- `src/clangd/compileCommands/cache.ts`
- `src/clangd/compileCommands/fillMissing.ts`
- `src/clangd/compileCommands/symlink.ts`
- `src/clangd/compileCommands/task.ts`
- `src/clangd/compileCommands.ts`
- `src/clangd/compileCommandsCache.ts`
- `src/clangd/compileCommandsFallback.ts`
- `src/clangd/compileCommandsHint.ts`
- `src/clangd/completionFiles.ts`
- `src/clangd/completionMode.ts`
- `src/clangd/createRspMatchers.ts`
- `src/clangd/diagnoseProject.ts`
- `src/clangd/diagnostics/AGENTS.md`
- `src/clangd/diagnostics/checks.ts`
- `src/clangd/diagnostics/format.ts`
- `src/clangd/diagnostics/io.ts`
- `src/clangd/diagnostics/types.ts`
- `src/clangd/fileWatcher.ts`
- `src/clangd/fingerprint.ts`
- `src/clangd/flagGlossary.ts`
- `src/clangd/formatTidyFiles.ts`
- `src/clangd/index.ts`
- `src/clangd/intermediateUhtCollector.ts`
- `src/clangd/locator/clangdLocator.ts`
- `src/clangd/modifyRspFiles.ts`
- `src/clangd/perfLog.ts`
- `src/clangd/perfProxy.ts`
- `src/clangd/preparseIncludes.ts`
- `src/clangd/proxyLogChannel.ts`
- `src/clangd/proxyLogTailer.ts`
- `src/clangd/proxyManager.ts`
- `src/clangd/types.ts`
- `src/clangd/ueClangdCompat.ts`
- `src/clangd/ueHelpers.ts`
- `src/clangd/ueLinkManager.ts`
- `src/clangd/ueMacroCompletionData.ts`
- `src/clangd/ueMacroCompletionProvider.ts`
…(共 50 个文件,已截断)

## 四、配置与限制

**该域文件构成:**

| 扩展名 | 文件数 |
|--------|--------|
| .ts | 47 |
| .md | 3 |

## 五、故障排查

- 能力行为异常 → 先对照 §3.1 的 `文件:行号` 证据定位实现;文档疑似过期 → 用附录 C 的基线 commit 自查。
- 本功能的问题在 §三 清单找不到入口 → 可能属于其他功能域,回[全书目录](../README.md#目录)查找。

## 本章小结

<!-- manual:summary -->
<!-- auto:BEGIN -->
- 本章覆盖功能单元 clangd-ue:50 个文件、0 条能力入口。
<!-- auto:END -->
- 能力证据在 §三;本功能的"为什么"与使用心得欢迎写入本块。
<!-- /manual:summary -->

## 下一章

<!-- manual:next -->
- 继续按目录顺序阅读下一章;功能之间的依赖以实际调用为准(见各章 §三 证据)。
<!-- /manual:next -->

---

## 附录 A · 交付与开发留档

- 功能域:clangd-ue(归属文件 50 个)· 来源:features.json 声明

## 附录 B · 功能演进史

| 版本/交付 | 日期 | 该功能发生了什么 | 证据 |
|-----------|------|------------------|------|
| bugfix-003 | 2026-10-11 | `ClangdOps.mutate` 经队列串行化,修复并发调用(控制面板连点开关)后写覆盖先写的丢配置问题;回归测试锁定(stash 验证旧代码下真实失败) | `.qiling/planning/bugfix/003-audit-fixes.md` |
| 审计修复（19 条） | 2026-10-25 | `.clangd` 改为多文档安全读写(保留注释);系统头路径持久化到设置项并由唯一渲染入口重建 flag 组;编译数据库候选顺序改为「项目本地 → helper 目录 → 引擎根」;补齐条目同步替换命令行源文件路径;新增源文件不再被指纹快路径吞掉;数据库改为一次原子写(紧凑格式);工作区备份按原文件名恢复并纳入 `launch.json` | `src/clangd/clangdYaml.ts`、`src/clangd/clangdFlagRenderer.ts`、`src/clangd/clangdOps.ts`、`src/clangd/compileCommands.ts`、`src/clangd/compileCommands/fillMissing.ts`、`src/clangd/compileCommands/dbFile.ts`、`src/clangd/workspaceBackup.ts` |

(本章正文永远最新态;该功能的历史变更逐条追加于此,只增不清)

## 附录 C · 数据来源与验证

- **来源:** 能力条目由 `/ql-scan` 提取器按惯例反推,每条带 `文件:行号`;功能域划分来自`features.json` 清单声明。
- **变更日志:** 2026-10-06T14:26:24.447Z 由功能域分章初次生成(后续由 /ql-doc 随交付更新)。
