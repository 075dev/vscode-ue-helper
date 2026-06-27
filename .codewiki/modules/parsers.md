# parsers 模块文档

## 基本信息
- **路径**: `src/parsers/`
- **文件数**: 4
- **语言**: TypeScript
- **职责**: 编译/链接输出解析器——将 MSVC、UBT、链接器的文本输出解析为结构化错误/警告。

## 符号表

### 导出类/函数

| 符号名 | 文件:行号 | 类型 | 说明 |
|--------|----------|------|------|
| MsvcParser | `src/parsers/msvcParser.ts` | class | 解析 MSVC 编译器输出（error/warning/note） |
| UbtParser | `src/parsers/ubtParser.ts` | class | 解析 UnrealBuildTool 输出 |
| LinkerParser | `src/parsers/linkerParser.ts` | class | 解析链接器输出（LNK 错误） |
| UprojectParser | `src/parsers/uprojectParser.ts` | class | 解析 .uproject 文件内容 |

## 解析格式

### MSVC 格式

```
file.cpp(line,col): error C2001: constant too long
file.cpp(line,col): warning C4005: 'MACRO' : macro redefinition
```

解析为 `{file, line, column, severity, code, message}`。与 `package.json:277-291` 的 problemMatcher 格式对应。

### UBT 格式

解析 UnrealBuildTool 的模块编译进度、错误、警告输出。

### Linker 格式

解析 `LNK2001`、`LNK2019` 等链接错误。

## 对外依赖

| 依赖模块 | 用途 |
|----------|------|
| vscode | Diagnostic, DiagnosticSeverity 类型 |

## 被依赖情况

- `detection/` — 使用 UprojectParser 解析 .uproject
- `build/` — 使用 MsvcParser/UbtParser 解析构建输出
- `ui/problemsPanel.ts` — 将解析结果映射到 VS Code Problems 面板

## 测试覆盖

| 测试文件 | 覆盖的解析器 |
|----------|-------------|
| `test/unit/parsers/msvcParser.test.ts` | MsvcParser |
| `test/unit/parsers/ubtParser.test.ts` | UbtParser |
