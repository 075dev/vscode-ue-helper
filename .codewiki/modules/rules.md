# rules 模块文档

## 基本信息
- **路径**: `src/rules/`
- **文件数**: 2
- **语言**: TypeScript
- **职责**: AI Agent Rules——为 Cursor / Claude Code 提供项目级规则文件，指导 AI 如何操作 UE 项目。

## 符号表

### 导出

| 符号名 | 文件:行号 | 类型 | 说明 |
|--------|----------|------|------|
| installRules | `src/rules/index.ts` | function | 复制 rules 文件到项目目录 |
| cursorRules | `src/rules/cursorRules.ts` | | Cursor 规则的模板/内容 |

## 功能

- 通过 `vscodeUEHelper.installRules` 命令触发
- 复制预定义的 AI agent rules 到工作区
- 帮助 Cursor/Claude Code 更好地理解 UE 项目结构和构建流程

## 对外依赖

| 依赖模块 | 用途 |
|----------|------|
| @core/logger | 日志 |
| vscode | workspace API |

## 被依赖情况

- `commands/installRules.ts` — 唯一调用者
