---
chapter_id: "chapter-06"
title: "MCP AI 工具集成"
feature: "mcp"
part: "第五篇 · AI 集成"
generated_at: "2026-10-06T14:26:24.447Z"
generated_by: "器灵工作流 v0.20.1 / ql-scan 功能域分章"
ql_version: "0.20.1"
last_mapped_commit: "cd18a09670d8398c5e65825166d9398370ce0093"
status: "scaffold"
endpoints: 0
events: 0
---

# 第 06 章 · MCP AI 工具集成

> 本章是功能单元 **mcp** 的功能章,正文永远反映**最新状态**;历史变更见附录 B 演进史。
> `<!-- manual -->` 块欢迎人工撰写润色(重扫自动保留);其余机器节不要手改。

**一句话:** 面向 AI agent 的 MCP 工具(ue_build / ue_rebuild / ue_get_build_errors 等),把构建能力暴露给 AI 编码助手

## 本章导学

<!-- manual:syllabus -->
<!-- auto:BEGIN -->
- **本章你将学到:** MCP AI 工具集成(mcp)的功能怎么用——6 个源码文件、9 条能力入口(清单见 §三)。
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
| MCP 工具(ue_ 前缀) | 9 | [§3](#三使用说明) |

**功能说明:** 面向 AI agent 的 MCP 工具(ue_build / ue_rebuild / ue_get_build_errors 等),把构建能力暴露给 AI 编码助手
<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充:这个功能解决什么问题、什么时候用、不适用什么场景)
<!-- /manual:overview -->

## 二、快速上手

<!-- manual:quickstart -->
<!-- auto:BEGIN -->
本功能的能力入口(完整清单与证据见 §三):

- MCP 工具(ue_ 前缀):`ue_build`
- MCP 工具(ue_ 前缀):`ue_rebuild`
- MCP 工具(ue_ 前缀):`ue_clean`
- MCP 工具(ue_ 前缀):`ue_get_build_errors`
- MCP 工具(ue_ 前缀):`ue_launch_editor`
- MCP 工具(ue_ 前缀):`ue_live_coding`
- MCP 工具(ue_ 前缀):`ue_generate_compile_commands`
- MCP 工具(ue_ 前缀):`ue_show_project_info`
…共 9 条

<!-- auto:END -->

(以上为生成器初稿;欢迎人工补充第一次使用本功能的完整步骤)
<!-- /manual:quickstart -->

## 三、使用说明

### 3.1 能力入口(带证据)

| 类型 | 标识 | 证据(文件:行) |
|------|------|------------------|
| MCP 工具(ue_ 前缀) | `ue_build` | `src/mcp/tools.ts:52` |
| MCP 工具(ue_ 前缀) | `ue_rebuild` | `src/mcp/tools.ts:76` |
| MCP 工具(ue_ 前缀) | `ue_clean` | `src/mcp/tools.ts:81` |
| MCP 工具(ue_ 前缀) | `ue_get_build_errors` | `src/mcp/tools.ts:88` |
| MCP 工具(ue_ 前缀) | `ue_launch_editor` | `src/mcp/tools.ts:95` |
| MCP 工具(ue_ 前缀) | `ue_live_coding` | `src/mcp/tools.ts:100` |
| MCP 工具(ue_ 前缀) | `ue_generate_compile_commands` | `src/mcp/tools.ts:105` |
| MCP 工具(ue_ 前缀) | `ue_show_project_info` | `src/mcp/tools.ts:110` |
| MCP 工具(ue_ 前缀) | `ue_set_system_includes` | `src/mcp/tools.ts:115` |

### 3.2 归属文件

- `.mcp.json`
- `src/mcp/AGENTS.md`
- `src/mcp/index.ts`
- `src/mcp/lifecycle.ts`
- `src/mcp/server.ts`
- `src/mcp/tools.ts`

## 四、配置与限制

**该域文件构成:**

| 扩展名 | 文件数 |
|--------|--------|
| .ts | 4 |
| .json | 1 |
| .md | 1 |

## 五、故障排查

- 能力行为异常 → 先对照 §3.1 的 `文件:行号` 证据定位实现;文档疑似过期 → 用附录 C 的基线 commit 自查。
- 本功能的问题在 §三 清单找不到入口 → 可能属于其他功能域,回[全书目录](../README.md#目录)查找。

## 本章小结

<!-- manual:summary -->
<!-- auto:BEGIN -->
- 本章覆盖功能单元 mcp:6 个文件、9 条能力入口。
<!-- auto:END -->
- 能力证据在 §三;本功能的"为什么"与使用心得欢迎写入本块。
<!-- /manual:summary -->

## 下一章

<!-- manual:next -->
- 继续按目录顺序阅读下一章;功能之间的依赖以实际调用为准(见各章 §三 证据)。
<!-- /manual:next -->

---

## 附录 A · 交付与开发留档

- 功能域:mcp(归属文件 6 个)· 来源:features.json 声明

## 附录 B · 功能演进史

| 版本/交付 | 日期 | 该功能发生了什么 | 证据 |
|-----------|------|------------------|------|
| | | | |

(本章正文永远最新态;该功能的历史变更逐条追加于此,只增不清)

## 附录 C · 数据来源与验证

- **来源:** 能力条目由 `/ql-scan` 提取器按惯例反推,每条带 `文件:行号`;功能域划分来自`features.json` 清单声明。
- **变更日志:** 2026-10-06T14:26:24.447Z 由功能域分章初次生成(后续由 /ql-doc 随交付更新)。
