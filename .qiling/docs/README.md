# vscode-ue-helper · 项目书

> **All-in-one VS Code plugin for Unreal Engine C++ development: UBT build, Live Coding hot-reload, clangd IntelliSense, and optional MCP AI agent integration.**
>
> 本页是全书的**前言与目录**。全书按"先跑起来,再逐功能深入"的顺序组织:每章有导学(学什么)、正文(怎么用)、小结(回顾什么)。

## 前言

- **这本书讲什么:** All-in-one VS Code plugin for Unreal Engine C++ development: UBT build, Live Coding hot-reload, clangd IntelliSense, and optional MCP AI agent integration.
- **适合谁:** 新接手的开发者(按目录顺序读)/ 只想查用的调用方(直接进章节 §三 使用说明)/ 维护者(看各章附录 A)。
- **怎么读:** 按下方目录顺序学习;每章开头"本章导学"标了前置章节与读法,章末"本章小结"可先读再回看正文。
- **快速上手:** 1. 安装 `npm install` 2. 运行 启动方式见第一章 §二 3. 详细步骤见 [第一章 §二](./chapters/chapter-01-vscode-ue-helper.md#二快速上手)

## 目录

**第一篇 · 认识项目**

- [第 01 章 · vscode-ue-helper(起步)](./chapters/chapter-01-vscode-ue-helper.md)

**第二篇 · 构建与项目**

- [第 02 章 · UBT 构建与项目命令](./chapters/chapter-02-build.md)

**第三篇 · IntelliSense**

- [第 03 章 · clangd Proxy 代理](./chapters/chapter-03-clangd-proxy.md)
- [第 04 章 · clangd 的 UE 支持](./chapters/chapter-04-clangd-ue.md)

**第四篇 · 界面**

- [第 05 章 · 控制面板与用户界面](./chapters/chapter-05-ui.md)

**第五篇 · AI 集成**

- [第 06 章 · MCP AI 工具集成](./chapters/chapter-06-mcp.md)

---

## 参考汇总(全书附表)

| 维度 | 数量 | 明细位置 |
|------|------|----------|
| API 端点(合计) | 0 | 各章节 §三 使用说明 |
| 事件(合计) | 4 | 同上 |

### 路径清单(跨章节去重,/ql-doc 章节累积后填)

| 方法 | 路径 | 章节 | 说明 |
|------|------|------|------|
| | | | |

### 错误码汇总(/ql-doc 章节累积后填)

| HTTP | code | 章节 | 含义 |
|------|------|------|------|
| | | | |

### 数据模型汇总(/ql-doc 章节累积后填)

| Schema | 章节 | 字段数 | 说明 |
|--------|------|--------|------|
| | | | |

## 术语表

| 术语 | 含义 | 首见章节 |
|------|------|----------|
| | | |

(机器不臆造术语;由 /ql-doc 章节累积或人工补充)

## 关于本书

<details>
<summary>生成方式、版本、新鲜度与严谨性约定(点开展开)</summary>

- **生成:** 器灵工作流 v0.20.1;`/ql-scan`(第一章)+ `/ql-doc`(交付后逐章追加)共同维护,本页**不要手改**。
- **章节结构:** 本章导学 → 正文五章(是什么/快速上手/使用说明/配置与限制/故障排查)→ 本章小结/下一章 → 附录三章(交付留档/章节对比/数据来源与验证);篇由各章 frontmatter `part` 声明。
- **人工撰写:** 章节内 `<!-- manual:ID -->` 块可人工撰写润色,重新生成时自动保留。
- **项目元信息:** 项目名 vscode-ue-helper · 版本 0.2.0 · 总章节数 6 · 包管理器 npm · 文档基线 commit cd18a096(第一章)
- **新鲜度自查:** `git log --oneline <基线>..HEAD` 条目较多说明代码已演进、文档可能过期;项目结构大改后运行 `/ql-scan --force` 重扫。
- **严谨性约定:** ①证据锚点——能力条目附 `文件:行号`,API 以 `openapi.yaml` 为单一可信源 ②未检出显式声明——扫不到写"未检出(Not detected)"+原因,绝不编造 ③推断必须标注"(推断)" ④不画假图——mermaid 只用真实检测值 ⑤密钥扫描——产出不含敏感值。

</details>
