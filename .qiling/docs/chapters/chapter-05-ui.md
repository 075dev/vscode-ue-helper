---
chapter_id: "chapter-05"
title: "控制面板与用户界面"
feature: "ui"
part: "第四篇 · 界面"
generated_at: "2026-10-26T01:52:09.547Z"
generated_by: "器灵工作流 v0.25.0 / ql-scan 功能域分章"
ql_version: "0.25.0"
last_mapped_commit: "92804b6fa547ed3e242e099236d5552069bc18e9"
status: "scaffold"
endpoints: 0
events: 1
---

# 第 05 章 · 控制面板与用户界面

> 本章是功能单元 **ui** 的功能章,正文永远反映**最新状态**;历史变更见附录 B 演进史。
> `<!-- manual -->` 块欢迎人工撰写润色(重扫自动保留);其余机器节不要手改。

**一句话:** 控制面板、项目资源管理器、状态栏、通知与问题面板

## 本章导学

<!-- manual:syllabus -->
<!-- auto:BEGIN -->
- **本章你将学到:** 控制面板与用户界面(ui)的功能怎么用——14 个源码文件、1 条能力入口(清单见 §三)。
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
| 事件 | 1 | [§3](#三使用说明) |

**功能说明:** 控制面板、项目资源管理器、状态栏、通知与问题面板
<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充:这个功能解决什么问题、什么时候用、不适用什么场景)
<!-- /manual:overview -->

## 二、快速上手

<!-- manual:quickstart -->
<!-- auto:BEGIN -->
本功能的能力入口(完整清单与证据见 §三):

- 事件:`changeEmitter(fire)`

<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充第一次使用本功能的完整步骤)
<!-- /manual:quickstart -->

## 三、使用说明

### 3.1 能力入口(带证据)

| 类型 | 标识 | 证据(文件:行) |
|------|------|------------------|
| 事件 | `changeEmitter(fire)` | `src/ui/projectExplorer.ts:51` |

### 3.2 归属文件

- `src/ui/AGENTS.md`
- `src/ui/controlPanel.html.ts`
- `src/ui/controlPanel.ts`
- `src/ui/controlPanelMessages.ts`
- `src/ui/index.ts`
- `src/ui/notifications.ts`
- `src/ui/outputChannel.ts`
- `src/ui/perfStatusBar.ts`
- `src/ui/problemsPanel.ts`
- `src/ui/projectExplorer.ts`
- `src/ui/projectExplorerFs.ts`
- `src/ui/projectExplorerModel.ts`
- `src/ui/quickPicks.ts`
- `src/ui/statusBar.ts`

## 四、配置与限制

**该域文件构成:**

| 扩展名 | 文件数 |
|--------|--------|
| .ts | 13 |
| .md | 1 |

## 五、故障排查

- 能力行为异常 → 先对照 §3.1 的 `文件:行号` 证据定位实现;文档疑似过期 → 用附录 C 的基线 commit 自查。
- 本功能的问题在 §三 清单找不到入口 → 可能属于其他功能域,回[全书目录](../README.md#目录)查找。

## 本章小结

<!-- manual:summary -->
<!-- auto:BEGIN -->
- 本章覆盖功能单元 ui:14 个文件、1 条能力入口。
<!-- auto:END -->
- 能力证据在 §三;本功能的"为什么"与使用心得欢迎写入本块。
<!-- /manual:summary -->

## 下一章

<!-- manual:next -->
- 继续按目录顺序阅读下一章;功能之间的依赖以实际调用为准(见各章 §三 证据)。
<!-- /manual:next -->

---

## 附录 A · 交付与开发留档

- 功能域:ui(归属文件 14 个)· 来源:features.json 声明

## 附录 B · 功能演进史

| 版本/交付 | 日期 | 该功能发生了什么 | 证据 |
|-----------|------|------------------|------|
| 审计修复（19 条） | 2026-10-25 | 控制面板首屏先 await 项目信息再渲染 HTML（此前渲染成空项目被 CSS 藏掉），`panelReady` 后重推全部状态，`postMessage` 投递失败记 warn；webview 消息与配置值增加类型校验，伪造消息不再能驱动扩展侧命令 | `src/ui/controlPanel.ts`、`src/ui/controlPanelMessages.ts` |

(本章正文永远最新态;该功能的历史变更逐条追加于此,只增不清)

## 附录 C · 数据来源与验证

- **来源:** 能力条目由 `ql-scan` 提取器按惯例反推,每条带 `文件:行号`;功能域划分来自`features.json` 清单声明。
- **变更日志:** 2026-10-26T01:52:09.547Z 由功能域分章初次生成(后续由 ql-doc 随交付更新)。
