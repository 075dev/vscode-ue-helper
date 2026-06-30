# Phase 4: CLI Fix + Rule Expansion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-01
**Phase:** 4-CLI Fix + Rule Expansion
**Areas discussed:** CLI Fix Approach, Rule Expansion Direction, Testing Strategy, Specific Rules List, Implementation Scope

---

## CLI Fix Approach

| Option | Description | Selected |
|--------|-------------|----------|
| cli.ts 中构造并传递 | 在 cli.ts 的 runProxy() 中构造 LocalizationOptions，传入 LspBridge | ✓ |
| LspBridge 内部自创建 | 让 LspBridge 内部调用 createDefaultLocalizationTable() | |
| 你决定 | 其他方式 | |

**User's choice:** cli.ts 中构造并传递
**Notes:** 直观、改动集中、符合现有代码流

---

## Rule Expansion Direction

| Option | Description | Selected |
|--------|-------------|----------|
| UE 常见编译错误 | 虚函数覆盖未标记 override、隐式转换丢失精度等 | |
| clangd 特有消息 | clangd 独有诊断 | |
| 混合覆盖 | UE 常见错误为主，clangd 特有消息为辅 | ✓ |

**User's choice:** 混合覆盖
**Notes:** UE 常见错误为主（~6条），clangd 特有消息为辅（~2条），达到 30+ 目标

---

## Testing Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 追加到现有文件 | 添加到 test/unit/clangd/proxy/localization.test.ts | ✓ |
| 独立测试文件 | 新建独立的测试文件 | |

**User's choice:** 追加到现有文件
**Notes:** 保持单文件组织

---

## Specific Rules List (Group 1)

| Option | Description | Selected |
|--------|-------------|----------|
| override 遗漏 | overriding 'virtualFunc' must have 'override' specifier | ✓ |
| 隐式转换丢失精度 | cast from 'typeA' to 'typeB' loses precision | ✓ |
| 调用保护构造函数 | calling a protected constructor of class 'X' | ✓ |
| 返回类型不匹配 | return type of selected overload is 'T' but expected 'U' | ✓ |

**User's choice:** 全部 4 条纳入

---

## Specific Rules List (Group 2)

| Option | Description | Selected |
|--------|-------------|----------|
| 模板实例化不匹配 | explicit instantiation does not refer to a function template | ✓ |
| 取临时对象地址 | taking address of a temporary | ✓ |
| 已弃用 API | 'X' is deprecated | ✓ |
| 全部纳入 | 将 7 条全部纳入 | ✓ |

**User's choice:** 全部 7 条纳入

---

## Implementation Scope

| Option | Description | Selected |
|--------|-------------|----------|
| 最小改动 | 仅在 cli.ts 中构造 LocalizationOptions + 传入 LspBridge | ✓ |
| 你决定 | 其他想法 | |

**User's choice:** 最小改动

---

## Deferred Ideas

None.

