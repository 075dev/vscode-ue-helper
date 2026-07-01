# Phase 7: Diagnostics 规则系统性扩展 - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning

<domain>
## Phase Boundary

系统性扩展 clangd/clang-cl 诊断消息汉化规则表。这是一个**持续迭代**的过程——用户在使用 UE 项目时触发各种诊断，从 Proxy 日志中提取未匹配的消息，逐步添加规则。

目标：规则表从 58 条扩展到 150+ 条。

</domain>

<decisions>
## Implementation Decisions

### 工作方式
- **D-01:** 用户继续正常使用 UE 项目，Proxy 日志记录所有 `(no rule matched)` 的消息
- **D-02:** 用户把希望汉化的消息原文发过来，我逐条添加规则
- **D-03:** 每次添加规则后用户重启 Proxy 验证效果

### 规则策略
- **D-04:** 所有新规则使用 `append` 模式（保留原文 + 追加翻译），除非消息本身不适合（如编译器标志消息）
- **D-05:** 新规则同时应用于 `diagnostics`、`codeActions`、`hover` 三个目标
- **D-06:** 每条新规则必须有对应的单元测试用例

### 优先级
- **D-07:** 优先覆盖用户实际遇到的消息（从日志中提取）
- **D-08:** 其次覆盖 clangd/clang-cl 常见诊断类别

</decisions>

<canonical_refs>
## Canonical References

### 核心文件
- `src/clangd/proxy/localization.ts` — 规则表，所有规则在此添加
- `test/unit/clangd/proxy/localization.test.ts` — 规则测试

### 日志
- Proxy 日志路径（用户设置）— 用于提取未匹配的消息

</canonical_refs>

<code_context>
## Existing Code Insights

### 当前规则结构
- 规则 1-30：标准 clangd 诊断（类型错误、语法错误等），`append` 模式
- 规则 31-50：UE/clang-cl 通用规则，`append` 模式
- 规则 51-58：Hover 专用规则，`replace` 模式，仅 `hover` 目标

### 规则添加方式
在 `createDefaultLocalizationTable()` 的 `rules` 数组中追加条目：
```ts
{
  pattern: "diagnostic message regex pattern",
  replacement: "[中文翻译 $1 引用]",
  mode: 'append',
  target: ['diagnostics', 'codeActions', 'hover'],
}
```

</code_context>

<specifics>
## 工作流程

1. 用户: 在 UE 项目中正常编码，触发诊断
2. 用户: 打开 Proxy 日志，找到 `(no rule matched)` 的消息
3. 用户: 把消息原文发给我
4. 我: 添加规则 + 测试
5. 用户: 构建并重启 Proxy，验证汉化效果
6. 回到步骤 1

</specifics>

<deferred>
## Deferred Ideas

- Hover 内容系统性汉化 — Phase 8
- 规则分类优化和性能测试 — Phase 9

</deferred>

---

*Phase: 7-Diagnostics 规则系统性扩展*
*Context gathered: 2026-07-01*
