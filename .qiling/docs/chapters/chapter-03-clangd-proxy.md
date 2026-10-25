---
chapter_id: "chapter-03"
title: "clangd Proxy 代理"
feature: "clangd-proxy"
part: "第三篇 · IntelliSense"
generated_at: "2026-10-06T14:26:24.447Z"
generated_by: "器灵工作流 v0.20.1 / ql-scan 功能域分章"
ql_version: "0.20.1"
last_mapped_commit: "cd18a09670d8398c5e65825166d9398370ce0093"
status: "scaffold"
endpoints: 0
events: 0
---

# 第 03 章 · clangd Proxy 代理

> 本章是功能单元 **clangd-proxy** 的功能章,正文永远反映**最新状态**;历史变更见附录 B 演进史。
> `<!-- manual -->` 块欢迎人工撰写润色(重扫自动保留);其余机器节不要手改。

**一句话:** clangd 代理进程管理、热重载桥接与 UE 兼容层——让 clangd 在 UE 工程里稳定工作

## 本章导学

<!-- manual:syllabus -->
<!-- auto:BEGIN -->
- **本章你将学到:** clangd Proxy 代理(clangd-proxy)的功能怎么用——18 个源码文件、0 条能力入口(清单见 §三)。
- **前置章节:** 第 01 章(先让项目跑起来)。
<!-- auto:END -->
- **读法:** 查用 → 直接进 §三;想懂设计 → 看来源与证据。
<!-- /manual:syllabus -->

## 一、这个功能是什么

<!-- manual:overview -->
<!-- auto:BEGIN -->
**覆盖能力:** 本章暂未检出能力条目(见附录 C)。

**功能说明:** clangd 代理进程管理、热重载桥接与 UE 兼容层——让 clangd 在 UE 工程里稳定工作
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

- `src/clangd/proxy/AGENTS.md`
- `src/clangd/proxy/bridge.ts`
- `src/clangd/proxy/cli.ts`
- `src/clangd/proxy/cliArgs.ts`
- `src/clangd/proxy/cliRuntime.ts`
- `src/clangd/proxy/framing.ts`
- `src/clangd/proxy/generatedHeaderWatcher.ts`
- `src/clangd/proxy/genericTranslator.ts`
- `src/clangd/proxy/keepalive.ts`
- `src/clangd/proxy/localization.ts`
- `src/clangd/proxy/messages.ts`
- `src/clangd/proxy/processBridge.ts`
- `src/clangd/proxy/realClangdResolver.ts`
- `src/clangd/proxy/settingsManager.ts`
- `src/clangd/proxy/settingsReader.ts`
- `src/clangd/proxy/status.ts`
- `src/clangd/proxy/ueDiagnosticWatcher.ts`
- `src/clangd/proxy/ueDocLookup.ts`

## 四、配置与限制

**该域文件构成:**

| 扩展名 | 文件数 |
|--------|--------|
| .ts | 17 |
| .md | 1 |

## 五、故障排查

- 能力行为异常 → 先对照 §3.1 的 `文件:行号` 证据定位实现;文档疑似过期 → 用附录 C 的基线 commit 自查。
- 本功能的问题在 §三 清单找不到入口 → 可能属于其他功能域,回[全书目录](../README.md#目录)查找。

## 本章小结

<!-- manual:summary -->
<!-- auto:BEGIN -->
- 本章覆盖功能单元 clangd-proxy:18 个文件、0 条能力入口。
<!-- auto:END -->
- 能力证据在 §三;本功能的"为什么"与使用心得欢迎写入本块。
<!-- /manual:summary -->

## 下一章

<!-- manual:next -->
- 继续按目录顺序阅读下一章;功能之间的依赖以实际调用为准(见各章 §三 证据)。
<!-- /manual:next -->

---

## 附录 A · 交付与开发留档

- 功能域:clangd-proxy(归属文件 18 个)· 来源:features.json 声明

## 附录 B · 功能演进史

| 版本/交付 | 日期 | 该功能发生了什么 | 证据 |
|-----------|------|------------------|------|
| bugfix-003 | 2026-10-11 | `bridge.close()` 清空请求关联表(消除取消/崩溃导致的在途请求条目无界增长);删除 completion/signatureHelp/inlayHint 三个 no-op 本地化占位函数 | `.qiling/planning/bugfix/003-audit-fixes.md` |
| 审计修复（19 条） | 2026-10-25 | 请求关联 key 加 client / server 命名空间,消除客户端与服务端同 id 时的响应串扰;未知 CLI 参数从「整进程退出」降级为 warning 并忽略 | `src/clangd/proxy/messages.ts`、`src/clangd/proxy/bridge.ts`、`src/clangd/proxy/cliArgs.ts`、`src/clangd/proxy/cli.ts` |

(本章正文永远最新态;该功能的历史变更逐条追加于此,只增不清)

## 附录 C · 数据来源与验证

- **来源:** 能力条目由 `/ql-scan` 提取器按惯例反推,每条带 `文件:行号`;功能域划分来自`features.json` 清单声明。
- **变更日志:** 2026-10-06T14:26:24.447Z 由功能域分章初次生成(后续由 /ql-doc 随交付更新)。
