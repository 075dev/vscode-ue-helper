---
chapter_id: "chapter-02"
title: "UBT 构建与项目命令"
feature: "build"
part: "第二篇 · 构建与项目"
generated_at: "2026-10-26T01:52:09.547Z"
generated_by: "器灵工作流 v0.25.0 / ql-scan 功能域分章"
ql_version: "0.25.0"
last_mapped_commit: "92804b6fa547ed3e242e099236d5552069bc18e9"
status: "scaffold"
endpoints: 0
events: 0
---

# 第 02 章 · UBT 构建与项目命令

> 本章是功能单元 **build** 的功能章,正文永远反映**最新状态**;历史变更见附录 B 演进史。
> `<!-- manual -->` 块欢迎人工撰写润色(重扫自动保留);其余机器节不要手改。

**一句话:** UBT 编译/清理/重建、Live Coding 热重载、UE 项目创建/检测/诊断与规则安装

## 本章导学

<!-- manual:syllabus -->
<!-- auto:BEGIN -->
- **本章你将学到:** UBT 构建与项目命令(build)的功能怎么用——38 个源码文件、28 条能力入口(清单见 §三)。
- **前置章节:** 第 01 章(先让项目跑起来)。
<!-- auto:END -->
- **读法:** 查用 → 直接进 §三;想懂设计 → 看来源与证据。
<!-- /manual:syllabus -->

## 一、这个功能是什么

<!-- manual:overview -->
<!-- auto:BEGIN -->
**覆盖能力:**

| 能力 | 数量 | 明细 |
|------|------|------|
| VSCode 命令注册(track 包装) | 28 | [§3](#三使用说明) |

**功能说明:** UBT 编译/清理/重建、Live Coding 热重载、UE 项目创建/检测/诊断与规则安装
<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充:这个功能解决什么问题、什么时候用、不适用什么场景)
<!-- /manual:overview -->

## 二、快速上手

<!-- manual:quickstart -->
<!-- auto:BEGIN -->
本功能的能力入口(完整清单与证据见 §三):

- VSCode 命令注册(track 包装):`vscodeUEHelper.showProjectInfo`
- VSCode 命令注册(track 包装):`vscodeUEHelper.build`
- VSCode 命令注册(track 包装):`vscodeUEHelper.rebuild`
- VSCode 命令注册(track 包装):`vscodeUEHelper.clean`
- VSCode 命令注册(track 包装):`vscodeUEHelper.launchEditor`
- VSCode 命令注册(track 包装):`vscodeUEHelper.liveCoding`
- VSCode 命令注册(track 包装):`vscodeUEHelper.generateCompileCommands`
- VSCode 命令注册(track 包装):`vscodeUEHelper.diagnoseProject`
…共 28 条

<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充第一次使用本功能的完整步骤)
<!-- /manual:quickstart -->

## 三、使用说明

### 3.1 能力入口(带证据)

| 类型 | 标识 | 证据(文件:行) |
|------|------|------------------|
| VSCode 命令注册(track 包装) | `vscodeUEHelper.showProjectInfo` | `src/commands/index.ts:60` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.build` | `src/commands/index.ts:63` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.rebuild` | `src/commands/index.ts:66` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.clean` | `src/commands/index.ts:69` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.launchEditor` | `src/commands/index.ts:72` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.liveCoding` | `src/commands/index.ts:75` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.generateCompileCommands` | `src/commands/index.ts:78` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.diagnoseProject` | `src/commands/index.ts:88` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.clearClangdIndex` | `src/commands/index.ts:93` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.createProject` | `src/commands/index.ts:94` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.installRules` | `src/commands/index.ts:97` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.uninstall` | `src/commands/index.ts:98` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.setSystemIncludes` | `src/commands/index.ts:99` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.openWorkspaceFile` | `src/commands/index.ts:102` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.openTerminalInNewWindow` | `src/commands/index.ts:103` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.selectConfig` | `src/commands/index.ts:106` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.selectTarget` | `src/commands/index.ts:107` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.enableClangdProxy` | `src/commands/index.ts:108` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.disableClangdProxy` | `src/commands/index.ts:109` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.showClangdProxyStatus` | `src/commands/index.ts:112` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.showControlPanel` | `src/commands/index.ts:115` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.copyBuildCommand` | `src/commands/index.ts:118` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.noLintCurrentLine` | `src/commands/index.ts:122` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.noLintNextLine` | `src/commands/index.ts:125` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.switchHeaderSource` | `src/commands/index.ts:130` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.retryFirstTimeInit` | `src/commands/index.ts:147` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.refreshProjectExplorer` | `src/commands/index.ts:154` |
| VSCode 命令注册(track 包装) | `vscodeUEHelper.openProjectExplorerFile` | `src/commands/index.ts:157` |

### 3.2 归属文件

- `src/commands/AGENTS.md`
- `src/commands/build.ts`
- `src/commands/clearClangdIndex.ts`
- `src/commands/copyBuildCommand.ts`
- `src/commands/createProject.ts`
- `src/commands/diagnoseProject.ts`
- `src/commands/disableClangdProxy.ts`
- `src/commands/enableClangdProxy.ts`
- `src/commands/firstRunInit.ts`
- `src/commands/generateCompileCommands.ts`
- `src/commands/index.ts`
- `src/commands/installRules.ts`
- `src/commands/launchEditor.ts`
- `src/commands/liveCoding.ts`
- `src/commands/noLint.ts`
- `src/commands/openProjectExplorerFile.ts`
- `src/commands/openTerminalInNewWindow.ts`
- `src/commands/openWorkspaceFile.ts`
- `src/commands/refreshProjectExplorer.ts`
- `src/commands/selectConfig.ts`
- `src/commands/selectTarget.ts`
- `src/commands/setSystemIncludes.ts`
- `src/commands/showClangdProxyStatus.ts`
- `src/commands/showControlPanel.ts`
- `src/commands/showProjectInfo.ts`
- `src/commands/switchHeaderSource.ts`
- `src/commands/uninstall.ts`
- `src/commands/_resolve.ts`
- `src/detection/AGENTS.md`
- `src/detection/engineDiscovery.ts`
- `src/detection/index.ts`
- `src/detection/types.ts`
- `src/detection/uprojectScanner.ts`
- `src/detection/workspaceContext.ts`
- `src/detection/workspaceFolders.ts`
- `src/rules/AGENTS.md`
- `src/rules/cursorRules.ts`
- `src/rules/index.ts`

## 四、配置与限制

**该域文件构成:**

| 扩展名 | 文件数 |
|--------|--------|
| .ts | 35 |
| .md | 3 |

## 五、故障排查

- 能力行为异常 → 先对照 §3.1 的 `文件:行号` 证据定位实现;文档疑似过期 → 用附录 C 的基线 commit 自查。
- 本功能的问题在 §三 清单找不到入口 → 可能属于其他功能域,回[全书目录](../README.md#目录)查找。

## 本章小结

<!-- manual:summary -->
<!-- auto:BEGIN -->
- 本章覆盖功能单元 build:38 个文件、28 条能力入口。
<!-- auto:END -->
- 能力证据在 §三;本功能的"为什么"与使用心得欢迎写入本块。
<!-- /manual:summary -->

## 下一章

<!-- manual:next -->
- 继续按目录顺序阅读下一章;功能之间的依赖以实际调用为准(见各章 §三 证据)。
<!-- /manual:next -->

---

## 附录 A · 交付与开发留档

- 功能域:build(归属文件 38 个)· 来源:features.json 声明

## 附录 B · 功能演进史

| 版本/交付 | 日期 | 该功能发生了什么 | 证据 |
|-----------|------|------------------|------|
| 审计修复（19 条） | 2026-10-25 | 构建快照早退收口（每次构建带唯一 `buildId`，早退路径补写失败快照）；TaskProvider 接线真实 UBT 命令；启动编辑器去掉 `cmd /c start` 改直接 spawn；构建与 Live Coding 共用并发锁；`Set System Includes` 的 silent 模式不再弹窗 | `src/commands/build.ts`、`src/build/taskProvider.ts`、`src/build/launchEditor.ts`、`src/build/lock.ts`、`src/commands/setSystemIncludes.ts` |

(本章正文永远最新态;该功能的历史变更逐条追加于此,只增不清)

## 附录 C · 数据来源与验证

- **来源:** 能力条目由 `ql-scan` 提取器按惯例反推,每条带 `文件:行号`;功能域划分来自`features.json` 清单声明。
- **变更日志:** 2026-10-26T01:52:09.547Z 由功能域分章初次生成(后续由 ql-doc 随交付更新)。
