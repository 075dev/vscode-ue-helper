# VSCodeUEHelper 知识库

**生成时间:** 2025-01
**项目:** VSCode UE Helper - Unreal Engine C++ 开发插件

## 项目总览

这是一个为 Unreal Engine 5.2+ 开发者设计的 VS Code 扩展，提供：
- UBT 构建集成 (Build/Rebuild/Clean)
- Live Coding 热重载 (Windows)
- clangd 智能提示 + compile_commands.json 生成
- MCP AI Agent 集成 (Cursor/Claude Code 自动启用)
- 16 个命令 + 完整的状态栏 UI

## 项目起源

本项目融合了两个优秀开源项目的设计模式，代码完全重写以避免版本耦合：

| 上游项目 | 版本 | 借鉴内容 |
|---|---|---|
| **[rmoubayed/engine-link](https://github.com/rmoubayed/engine-link)** | v3 | UBT 构建流水线、Live Coding 热重载、引擎自动发现、MCP AI Agent 集成 |
| **[boocs/unreal-clangd](https://github.com/boocs/unreal-clangd/tree/v3)** | v3 | clangd 智能提示、compile_commands.json 维护、workspace 备份机制、preparse-includes 宏补全 |

**设计融合点**：
- engine-link 的 MCP 集成架构 + unreal-clangd 的 clangd 配置方案
- 统一的模块化激活顺序，避免两个上游项目的竞态问题
- 保留了两个项目各自的优势特性，去除了冗余代码

## 目录结构

```
VSCodeUEHelper/
├── src/                    # 源代码
│   ├── core/               # 基础设施 (Logger, Config, 命令注册)
│   ├── detection/          # 项目/引擎检测
│   ├── build/              # UBT 构建、Live Coding、Task Provider
│   ├── clangd/             # clangd 配置、编译数据库、补全模式
│   ├── commands/           # 16 个 VS Code 命令实现
│   ├── ui/                 # 状态栏、QuickPick、通知、问题面板
│   ├── parsers/            # MSVC/UBT/链接器 错误解析
│   ├── mcp/                # Model Context Protocol 服务器
│   ├── rules/              # AI Agent 规则生成 (Cursor/Copilot)
│   └── i18n/               # 国际化 (zh/en)
├── test/                   # Vitest 单元测试
├── resources/              # 图标、头文件列表等
├── doc/                    # 架构文档
├── out/                    # esbuild 输出 (Git 忽略)
├── package.json            # 插件 manifest + 脚本
├── tsconfig.json           # TypeScript 配置 (严格模式)
└── .eslintrc.json          # ESLint 规则
```

## 架构速查

### 激活顺序 (关键！不能乱序)
```
1. initI18n()               ← 必须最先，Logger 之前
2. Logger + Config          ← 基础设施，所有模块依赖
3. activateDetection()      ← 项目/引擎发现，返回 ready Promise
4. activateBuild()          ← UBT Task Provider
5. activateClangd()         ← clangd 状态栏 + 工作区备份
6. activateUI()             ← 11 个状态栏按钮，await detection.ready
7. activateCommands()       ← 注册 16 个命令到 VS Code
```

### 核心设计模式
- **Promise-based 而非回调**：`detection.ready` 是 Promise，UI await 后才渲染，避免竞态
- **模块化激活**：每个模块有 `activateXxx()` 函数，接收依赖，返回 handles
- **强类型配置**：所有 `vscodeUEHelper.*` 设置都有 TypeScript 包装
- **中文注释优先**：所有代码注释使用中文，便于国内开发者理解

## 去哪里找代码

| 任务 | 位置 | 关键文件 |
|---|---|---|
| 添加新命令 | `src/commands/` | `index.ts` 注册，`xxx.ts` 实现 |
| 修改构建逻辑 | `src/build/` | `ubt.ts`, `buildRunner.ts`, `taskProvider.ts` |
| clangd 配置 | `src/clangd/` | `clangdConfig.ts`, `compileCommands.ts`, `completionMode.ts` |
| 引擎/项目检测 | `src/detection/` | `engineDiscovery.ts`, `uprojectScanner.ts`, `vsBuildTools.ts` |
| 状态栏 UI | `src/ui/` | `statusBar.ts`, `quickPicks.ts`, `notifications.ts` |
| 错误解析 | `src/parsers/` | `msvcParser.ts`, `ubtParser.ts`, `linkerParser.ts` |
| MCP 工具 | `src/mcp/` | `server.ts`, `tools.ts`, `lifecycle.ts` |
| 添加日志 | `src/core/` | `logger.ts` |
| 配置项 | `src/core/` | `config.ts` |
| 国际化 | `src/i18n/` | `locales/zh.ts`, `locales/en.ts` |

## 约定与规范

### TypeScript 严格模式
所有代码必须通过 `tsc --noEmit`，关键规则：
```json
"strict": true,
"noUncheckedIndexedAccess": true,
"noImplicitAny": true,
"strictNullChecks": true
```

### 导入路径别名
tsconfig 配置了路径别名，**必须使用**：
```typescript
import { Logger } from '@core/logger';      // ✅ 正确
import { Config } from '@core/config';      // ✅ 正确
import { Logger } from '../core/logger';    // ❌ 禁止
```

### 中文注释
所有文件、函数、类的头部注释必须使用中文，说明：
- 该模块/函数的职责
- 关键设计决策
- 依赖关系
- 注意事项

### 命令注册模式
```typescript
// src/commands/index.ts 中注册
registerCommand(context, 'vscodeUEHelper.xxx', () =>
  executeXxx(config, logger, deps),
);

// 独立文件实现: src/commands/xxx.ts
export async function executeXxx(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> { /* 实现 */ }
```

## 反模式 (此项目中禁止)

1. **不要用回调** - 所有异步操作用 Promise/async-await
2. **不要忽略 floating promises** - `void foo()` 明确标记故意不 await
3. **不要用 `any`** - 除非万不得已，且必须加 `// eslint-disable-line` 说明原因
4. **不要跳过空检查** - `noUncheckedIndexedAccess` 开启，数组访问必须判空
5. **不要在错误路径漏掉日志** - 所有 `catch` 必须调用 `logger.error()`

## 独特风格

- **i18n 优先设计**：所有用户可见字符串都通过 `t('key')` 翻译
- **Output Channel 结构化日志**：每个模块有自己的日志前缀 `[module] message`
- **globalState 持久化**：用户选择的配置跨会话保留
- **Disposable 模式**：所有 VS Code 资源都推入 `context.subscriptions`，自动清理

## 常用命令

```bash
npm run build              # esbuild → out/extension.js (58kb 左右)
npm run watch              # 监听模式开发
npm run typecheck          # TypeScript 类型检查
npm run lint               # ESLint 检查
npm run format:check       # Prettier 格式检查
npm run test:unit          # Vitest 单元测试 (18 个测试)
npm run package            # vsce 打包成 .vsix
```

## 开发要点

### 调试
- F5 启动 Extension Development Host
- 断点直接打在 TypeScript 源文件
- Output 面板选 "VSCodeUEHelper" 看日志

### 测试
- Vitest 单元测试覆盖核心逻辑
- 集成测试需要 UE 引擎环境，手动运行

### 发布前检查清单
1. ✅ `npm run typecheck` 通过
2. ✅ `npm run lint` 通过
3. ✅ `npm run test:unit` 通过
4. ✅ `npm run package` 成功
5. ✅ F5 启动后所有状态栏按钮正常显示

## 注意事项

- **模块激活顺序非常重要**：detection 必须在 UI 之前，因为 UI await detection.ready
- **Windows 特有功能**：Live Coding、VS Build Tools 检测只在 Windows 运行
- **MCP 自动检测**：通过 `CURSOR`/`CLAUDE` 环境变量判断，只在支持的编辑器启动
- **工作区依赖**：必须打开 `.code-workspace`，独立文件夹不支持检测
