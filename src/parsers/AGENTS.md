<!-- Parent: ../AGENTS.md -->
# parsers 模块 —— 纯函数诊断 / 配置解析器

> 治理参考：`.specify/memory/constitution.md` §II（Single Sources of Truth）。本模块是**纯函数层**——无 vscode API 依赖（除读文件），不持状态，不写文件。负责把 UBT / MSVC / 链接器 / `.uproject` 的输出解析成结构化数据，供 `build` / `ui` / `commands` 消费。

## 模块概述

三类纯函数解析器，无副作用：

- **MSVC 诊断**：构建错误的统一入口（**实际生效**的实现）
- **UBT 进度行**：状态栏进度条
- **`.uproject`**：UE 项目 JSON 读取

## 核心文件

| 文件                | 职责                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `msvcParser.ts`     | 提取 MSVC / UBT 诊断（`file.cpp(line,col): error C2065: msg`）。**实际生效**的实现是此文件（不是 `package.json#problemMatchers`）|
| `ubtParser.ts`      | UBT 进度行（`[1/45] Compile Module.Core.cpp`）解析 → 状态栏进度条                                             |
| `uprojectParser.ts` | 读 `.uproject` 文件返回原始 JSON（JSON5，支持 trailing commas），供运行时读 `UprojectScanner` 未建模字段       |

## 关键约束

### MSVC 正则（pitfall #7）

定义于 `src/parsers/msvcParser.ts`：

```
^(.*)\((\d+)(?:,(\d+))?\):\s+(error|warning|note|fatal error)\s+([A-Z]+\d+):\s+(.*)$
```

**`package.json#contributes.problemMatchers` 只是给 VS Code Task 用户手工配置参考**，本插件不自动 task 消费 UBT 输出。改 MSVC 正则只需改本文件；不要去碰 `problemMatchers`。

### 行列 0/1-based 转换

- MSVC 输出 **1-based**（行号、列号）
- VS Code `Diagnostic.range` 是 **0-based**
- 解析时**必须**减 1（在 `msvcParser.ts` 统一处理），下游 `problemsPanel.ts` 拿到的是已转换的 0-based 范围

### 绝对路径

- Problems 面板需要**绝对路径**才能定位文件
- MSVC 输出相对路径或短路径，解析时要 `path.resolve(workspaceRoot, ...)`
- 解析失败时**保留**原始字符串，不要静默丢弃

## 纯函数约束

- **不依赖 vscode API**（除 `vscode.Uri` / `vscode.DiagnosticRange` 等类型）—— 测试可直接 `import` 调用
- **不持状态** —— 每个函数接收字符串、返回结构化结果
- **不写文件 / 不调子进程** —— 只读 + 解析

## 测试

`test/unit/parsers/` 覆盖解析器的正常路径 + 边缘情况（trailing newline / 多列范围 / JSON5 trailing commas）。
