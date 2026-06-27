# platform 模块文档

## 基本信息
- **路径**: `src/platform/`
- **文件数**: 0
- **语言**: N/A
- **职责**: 预留——跨平台抽象层（目前空目录，未实现）。

## 符号表

无。目录为空，不包含任何 `.ts` 文件。

## 规划用途

`tsconfig.json` 已配置路径别名 `@platform`：
```json
"@platform": ["src/platform/index"],
"@platform/*": ["src/platform/*"]
```

预计未来用于：
- 平台特定逻辑抽象（Windows/Mac/Linux 差异）
- 当前这些逻辑分散在 `build/` 和 `clangd/` 的 `isWindows` 判断中

## 对外依赖

无。

## 被依赖情况

无——当前无模块导入 `@platform`。
