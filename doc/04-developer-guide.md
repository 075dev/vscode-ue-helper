# 04 · 开发指南

> 本文档面向 **想改 VSCodeUEHelper 或贡献代码** 的开发者。读完就能上手加新命令、改检测逻辑、写测试、打包发布。

---

## 1. 开发环境搭建

### 必备工具

- Node.js 18+
- VS Code 1.85+
- Git
- （可选）VS Code 扩展 "ESLint" + "Prettier"

### Clone & Setup

```bash
cd D:/AIWorkSpace/VScodePlugin/VSCodeUEHelper
npm install
```

### 调试流程

1. 用 VS Code 打开本项目根目录
2. 按 `F5` —— 启动 "Extension Development Host"（一个新 VS Code 窗口，装着我们的插件）
3. 在新窗口里打开任意 UE 项目（如 `E:\Dream\XianDreamwalking\XianDreamwalking.code-workspace`）
4. 状态栏底部应该出现 11 个按钮

修改代码后：
- `Ctrl+Shift+B` → 选 `npm: watch` 启动 esbuild 监视
- 编辑窗口自动重新加载插件

### 关键命令

```bash
npm run typecheck    # tsc --noEmit (类型检查，不产出文件)
npm run build        # esbuild → out/extension.js
npm run watch        # esbuild --watch (持续编译)
npm run lint         # ESLint
npm run format       # Prettier
npm run test:unit    # Vitest (单元测试)
npm run test         # test:unit + test:integration (集成测试需 electron)
npm run package      # vsce package → out/*.vsix
```

---

## 2. 目录结构

```
src/
├── extension.ts          # 入口
├── core/                 # Logger, Config, command-registry
├── i18n/                 # t() + locales/{en,zh}.json
├── detection/            # 项目/引擎发现
│   ├── index.ts          #   入口
│   ├── workspaceFolders.ts   # .code-workspace 读取
│   ├── uprojectScanner.ts   # .uproject 解析（JSON5）
│   ├── engineDiscovery.ts
│   ├── engineLocator.ts     # ← 当前未使用
│   ├── vsBuildTools.ts
│   ├── workspaceContext.ts
│   ├── uprojectAssociation.ts
│   └── types.ts
├── build/                # UBT / Live Coding / 启动 Editor
├── clangd/               # clangd 配置 / Windows SDK / MSVC
├── ui/                   # 状态栏 / QuickPick / Output
├── commands/             # 15 个命令实现
├── mcp/                  # MCP 服务器
├── parsers/              # MSVC/UBT/链接器输出解析
├── rules/                # AI agent rules
└── platform/             # 预留（空）

test/unit/                # Vitest 单元测试
test/integration/         # 集成测试（需要 electron）

doc/                      # 中文项目文档（README.md 是入口）
```

---

## 3. 添加新命令

以"打印 UE 项目信息到 Output 面板"为例（这其实就是 `showProjectInfo`，但走完整流程）。

### Step 1: 在 `package.json` 加命令定义

```json
{
  "command": "vscodeUEHelper.myNewCommand",
  "title": "My New Command",
  "title@zh": "我的新命令",
  "category": "UE Helper",
  "icon": "$(info)"
}
```

### Step 2: 在 `src/commands/` 创建文件

```ts
// src/commands/myNewCommand.ts
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import type { DetectionHandles } from '@detection';

export async function executeMyNewCommand(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  logger.info('[myNewCommand] invoked');
  const result = await detection.ready;
  const projectNames = result.projects.map((p) => p.name).join(', ') || '(none)';
  const engineVersions = result.engines.map((e) => e.version).join(', ') || '(none)';
  vscode.window.showInformationMessage(
    `Projects: ${projectNames}\nEngines: ${engineVersions}`,
  );
}
```

### Step 3: 在 `src/commands/index.ts` 注册

```ts
import { executeMyNewCommand } from './myNewCommand';

// 在 activateCommands 内：
registerCommand(context, 'vscodeUEHelper.myNewCommand', () =>
  executeMyNewCommand(config, logger, detection),
);
```

### Step 4: 加状态栏按钮（可选）

在 `src/ui/statusBar.ts` 的 `StatusBarManager` 类加一个 `myNewBtn: vscode.StatusBarItem;`，构造时 `createStatusBarItem`，`update()` 里渲染文字，`dispose()` 里释放。

详见 [05-code-reference.md](./05-code-reference.md#statusbar-加按钮)。

### Step 5: 写测试

```ts
// test/unit/commands/myNewCommand.test.ts
import { describe, it, expect } from 'vitest';
// ... 测试你的 executeMyNewCommand
```

---

## 4. 修改检测逻辑

### 改 `.code-workspace` 读取

`src/detection/workspaceFolders.ts:readWorkspaceEntries(workspaceFile)` 是入口。改这里的逻辑会直接影响所有下游。

例如：让 `folders` 顺序可配置（不强制 [0]=项目 / [1]=引擎）：

```ts
// 在 entries 上加注释：
//   { name, path, role: 'project' | 'engine' | 'unknown' }
// 让 index.ts 按 role 而不是位置判断
```

### 改 `.uproject` 解析

`src/detection/uprojectScanner.ts:parseUProject()` 用 JSON5 解析。改这里要保持向后兼容（旧的 .uproject 可能字段缺失）。

### 加新检测源

比如想加 "从 `Saved/Config/Windows/WindowsEngine.ini` 读引擎路径"：

1. 在 `src/detection/` 加 `iniScanner.ts`
2. 导出 `scanIniFile(path): Promise<EngineInfo>`
3. 在 `index.ts:handles.ready` 里调用，跟 `.code-workspace` 的结果 merge

---

## 5. 调试技巧

### 打开 Output 面板

`Ctrl+Shift+U` → 选 "VSCodeUEHelper" 通道。所有 `logger.info/warn/error` 都写到这里。

### 在源码里打断点

VS Code 自带 Node 调试器。在 `.ts` 文件左侧点红点设断点 → F5 启动 Extension Development Host → 触发对应代码路径。

### 用 `console.log` 临时调试

```ts
console.log('[myFeature] state:', { project, engine });
```

Extension Development Host 的 DevTools (`Help → Toggle Developer Tools`) 能看到。

### 重现"无项目"场景

临时改 `.code-workspace`：
```json
{
  "folders": [
    { "name": "Empty", "path": "." }
  ]
}
```

（没有 `folders[1]` 也没有 .uproject）。然后重启 Extension Development Host 观察日志。

### 跨平台测试

- **Windows**：用 Git Bash 但底层仍是 Windows。spawn `.bat` 必须 `cmd.exe /c`
- **macOS / Linux**：`execFile` 用 POSIX shell 解析。Mac 上 `open -a <app>` 启动 .app

---

## 6. 单元测试

### 写测试

```ts
// test/unit/parsers/myParser.test.ts
import { describe, it, expect } from 'vitest';
import { MyParser } from '@parsers/myParser';

describe('MyParser', () => {
  it('parses a valid input', () => {
    const parser = new MyParser();
    const result = parser.parse('foo bar baz');
    expect(result).toEqual([{ ... }]);
  });
});
```

### 跑测试

```bash
npm run test:unit
```

Vitest 监视模式：
```bash
npm run test:unit:watch
```

### Mock vscode 模块

VS Code API 在 Node 里没有实现。测试时 mock 掉：

```ts
import { vi } from 'vitest';
vi.mock('vscode', () => ({
  window: { showInformationMessage: vi.fn() },
  workspace: { getConfiguration: vi.fn(() => ({ get: () => 'Development' })) },
}));
```

---

## 7. 国际化（i18n）

### 加新翻译键

1. 在 `src/i18n/locales/zh.json` 和 `en.json` 各加一个键：

```json
{
  "myFeature.greeting": "你好，{name}",
  "myFeature.greeting@en": "Hello, {name}"
}
```

> 实际是两个文件分别写。`zh.json` 里就是 `"myFeature.greeting": "你好，{name}"`，`en.json` 里是 `"myFeature.greeting": "Hello, {name}"`。

2. 在代码里：

```ts
import { t } from '@i18n';
vscode.window.showInformationMessage(t('myFeature.greeting', { name: 'world' }));
// zh → "你好，world"
// en → "Hello, world"
```

---

## 8. 状态栏按钮调优

### 改按钮布局

`src/ui/statusBar.ts` 构造函数里 `createStatusBarItem(Left, priority)`。priority 越大越靠左。

### 改按钮文字 / tooltip

`update(ctx, settings)` 方法里赋值 `this.xxxBtn.text / .tooltip`。

### 隐藏按钮

```ts
this.xxxBtn.hide();  // 不显示
```

visibility 逻辑在 `update()` 末尾的 `if (ctx.project) { ... } else { ... }`。

---

## 9. 常见错误与解决

| 错误 | 原因 | 修复 |
|---|---|---|
| `spawn EINVAL` | 直接 spawn `.bat` | 用 `cmd.exe /c <file>` |
| `No .uproject found` | `.code-workspace` 的 `folders[0]` 错 | 检查 `.code-workspace` JSON |
| `target rules file not found` | UBT 期望 `XianDreamwalkingEditor` 不是 `Editor` | 调 `resolveUBTTarget()` 转换 |
| `Unexpected token ] in JSON` | `.uproject` 有尾部逗号 / 注释 | 用 `JSON5.parse`（已做） |
| `EPERM: operation not permitted` | symlink 创建失败（Windows 无开发者模式） | fallback 到 `copyFile` |
| Cancel 按钮无效 | `child.kill()` 只杀 cmd.exe | 用 `taskkill /F /T` |

---

## 10. 打包与发布

### 打包 .vsix

```bash
npm run package
# → out/vscode-ue-helper-0.1.0.vsix
```

### 发布到 Marketplace（需要 vsce PAT）

```bash
npm run publish
```

需要：
1. Azure DevOps 账号
2. publisher 名字（`package.json` 里设置，当前 `vscode-ue-helper`）
3. PAT token：vsce login <publisher>

---

## 11. 代码规范

### TypeScript 严格度

- `strict: true` —— 不能隐式 any
- `noUncheckedIndexedAccess: true` —— `arr[i]` 是 `T | undefined`
- `exactOptionalPropertyTypes: true`

### 命名

- **文件**：camelCase（`workspaceFolders.ts`）
- **类 / 类型**：PascalCase（`StatusBarManager`、`ProjectInfo`）
- **函数 / 变量**：camelCase
- **常量**：UPPER_SNAKE_CASE（仅模块级常量）

### Import 顺序

```ts
// 1. Node 内置
import * as fs from 'node:fs/promises';

// 2. 第三方
import * as vscode from 'vscode';

// 3. 内部（用 @ 别名）
import { Logger } from '@core/logger';
import { UprojectScanner } from '@detection';
```

ESLint + Prettier 已经在 `.eslintrc.json` / `.prettierrc` 配置好。

### 错误处理

- **不要** `try { ... } catch {}` 静默吞错
- **要** 至少 `logger.warn(...)` 或向上 throw
- 用户可见错误用 `vscode.window.showErrorMessage(message, ...buttons)`，必要时 modal

---

## 下一步

- [05-code-reference.md](./05-code-reference.md) —— 关键算法详解
- 看具体模块的源码 —— 每个文件顶部都有 docstring 说明职责