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

---

## 参考汇总(全书附表)

| 维度 | 数量 | 明细位置 |
|------|------|----------|
| API 端点(合计) | 36(27 命令 + 9 MCP 工具) | 各章节 §三 使用说明 |
| 事件(合计) | 4(VSCode EventEmitter × 2 + MCP JSON-RPC 面 × 2) | 同上 |
| 全局错误码 | 9 | 本章 §五 故障排查 + 下方错误码汇总 |
| 数据模型(Schema) | 6 | 下方数据模型汇总 |

### 路径清单(跨章节去重,/ql-doc 章节累积后填)

| 方法 | 路径 | 章节 | 说明 |
|------|------|------|------|
| POST | /commands/build | chapter-01 | UBT 增量构建当前 UE 项目 |
| POST | /commands/rebuild | chapter-01 | UBT -Rebuild(Clean + Build) |
| POST | /commands/clean | chapter-01 | UBT -Clean 清理中间产物 |
| POST | /commands/copyBuildCommand | chapter-01 | 复制当前配置的 UBT 构建命令行到剪贴板 |
| POST | /commands/liveCoding | chapter-01 | 触发 Live Coding 热重载(仅 Windows) |
| POST | /commands/generateCompileCommands | chapter-01 | 经 UBT -ProjectFiles 生成 compile_commands.json |
| POST | /commands/launchEditor | chapter-01 | 启动 Unreal Editor 打开选中的 .uproject |
| POST | /commands/showProjectInfo | chapter-01 | 展示检测到的项目/引擎信息 |
| POST | /commands/diagnoseProject | chapter-01 | 项目环境诊断(引擎路径/工具链/配置完整性) |
| POST | /commands/createProject | chapter-01 | 创建新 UE C++ 项目(向导式) |
| POST | /commands/refreshProjectExplorer | chapter-01 | 刷新项目资源管理器树视图 |
| POST | /commands/openProjectExplorerFile | chapter-01 | 在编辑器中打开资源管理器选中的文件 |
| POST | /commands/openWorkspaceFile | chapter-01 | 打开工作区内指定文件 |
| POST | /commands/openTerminalInNewWindow | chapter-01 | 在新窗口终端中打开指定目录 |
| POST | /commands/switchHeaderSource | chapter-01 | 在活动编辑器的头文件与源文件之间切换 |
| POST | /commands/enableClangdProxy | chapter-01 | 启用 clangd 代理配置 |
| POST | /commands/disableClangdProxy | chapter-01 | 停用 clangd 代理配置 |
| POST | /commands/showClangdProxyStatus | chapter-01 | 展示 clangd 代理状态 |
| POST | /commands/setSystemIncludes | chapter-01 | 配置 Windows MSVC + Windows SDK 系统包含路径 |
| POST | /commands/installRules | chapter-01 | 安装 .editorconfig/clangd 规则文件到项目 |
| POST | /commands/noLintCurrentLine | chapter-01 | 对当前行插入 clang-tidy 屏蔽注释 |
| POST | /commands/noLintNextLine | chapter-01 | 对下一行插入 clang-tidy 屏蔽注释 |
| POST | /commands/selectConfig | chapter-01 | 交互选择构建 Configuration(Development/Shipping 等) |
| POST | /commands/selectTarget | chapter-01 | 交互选择构建 Target |
| POST | /commands/showControlPanel | chapter-01 | 打开控制面板(Webview) |
| POST | /commands/retryFirstTimeInit | chapter-01 | 重试首次初始化(引擎检测/clangd 引导) |
| POST | /commands/uninstall | chapter-01 | 从项目卸载本插件注入的配置/规则 |
| POST | /mcp/tools/ue_build | chapter-01 | 构建/重建/清理(模式参数化),可选单模块过滤 |
| POST | /mcp/tools/ue_rebuild | chapter-01 | UBT -Rebuild(独立工具名,意图命中更好) |
| POST | /mcp/tools/ue_clean | chapter-01 | UBT -Clean |
| POST | /mcp/tools/ue_get_build_errors | chapter-01 | 读取最近一次构建的结构化诊断(同步快照) |
| POST | /mcp/tools/ue_launch_editor | chapter-01 | 启动 Unreal Editor |
| POST | /mcp/tools/ue_live_coding | chapter-01 | 触发 Live Coding 热重载(仅 Windows) |
| POST | /mcp/tools/ue_generate_compile_commands | chapter-01 | 生成 compile_commands.json |
| POST | /mcp/tools/ue_show_project_info | chapter-01 | 展示项目/引擎信息 |
| POST | /mcp/tools/ue_set_system_includes | chapter-01 | 配置系统包含路径 |

### 错误码汇总(/ql-doc 章节累积后填)

| code | 章节 | 含义 |
|------|------|------|
| PROJECT_NOT_DETECTED | chapter-01 | 工作区无 .uproject |
| UBT_NOT_FOUND | chapter-01 | 引擎/UBT 路径不可用 |
| BUILD_FAILED | chapter-01 | 构建退出码非 0(诊断见快照) |
| LIVE_CODING_UNAVAILABLE | chapter-01 | Editor 未运行或控制台未连接 |
| CLANGD_NOT_AVAILABLE | chapter-01 | clangd 不可用 |
| OPERATION_CANCELLED | chapter-01 | 用户取消 |
| MCP_CONTEXT_NOT_INITIALIZED | chapter-01 | MCP 上下文未初始化(宿主未激活) |
| UNKNOWN_TOOL | chapter-01 | 未知 MCP 工具名 |
| INTERNAL_ERROR | chapter-01 | 内部错误(兜底) |

### 数据模型汇总(/ql-doc 章节累积后填)

| Schema | 章节 | 字段数 | 说明 |
|--------|------|--------|------|
| Envelope | chapter-01 | 3 | 统一响应信封(ok/summary/data/error,决策 D5) |
| Error | chapter-01 | 3 | 错误对象(code/message/details) |
| BuildResult | chapter-01 | 5 | 构建结果(mode/exitCode/durationMs 等) |
| BuildSummary | chapter-01 | 8 | ue_get_build_errors 返回的构建摘要(与 summarizeBuildErrorsForAgent 对齐) |
| ProjectInfo | chapter-01 | 6 | 项目信息 |
| MCPDispatch | chapter-01 | 5 | MCP dispatch 确认(fire-and-forget,决策 D4) |

## 术语表

| 术语 | 含义 | 首见章节 |
|------|------|----------|
| | | |

(机器不臆造术语;由 /ql-doc 章节累积或人工补充)

## 关于本书

<details>
<summary>生成方式、版本、新鲜度与严谨性约定(点开展开)</summary>

- **生成:** 器灵工作流 v0.20.0;`/ql-scan`(第一章)+ `/ql-doc`(交付后逐章追加)共同维护,本页**不要手改**。
- **章节结构:** 本章导学 → 正文五章(是什么/快速上手/使用说明/配置与限制/故障排查)→ 本章小结/下一章 → 附录三章(交付留档/章节对比/数据来源与验证);篇由各章 frontmatter `part` 声明。
- **人工撰写:** 章节内 `<!-- manual:ID -->` 块可人工撰写润色,重新生成时自动保留。
- **项目元信息:** 项目名 vscode-ue-helper · 版本 0.2.0(已发布 GitHub Release,tag `v0.2.0`) · 总章节数 1 · 包管理器 npm · 文档基线 commit e1ec12e7(含 add-004 章节更新)
- **新鲜度自查:** `git log --oneline <基线>..HEAD` 条目较多说明代码已演进、文档可能过期;项目结构大改后运行 `/ql-scan --force` 重扫。
- **严谨性约定:** ①证据锚点——能力条目附 `文件:行号`,API 以 `openapi.yaml` 为单一可信源 ②未检出显式声明——扫不到写"未检出(Not detected)"+原因,绝不编造 ③推断必须标注"(推断)" ④不画假图——mermaid 只用真实检测值 ⑤密钥扫描——产出不含敏感值。

</details>
