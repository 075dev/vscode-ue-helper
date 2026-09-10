<!-- Parent: ../AGENTS.md -->
# i18n 模块 —— 中英双语字符串查找

> 治理参考：`.specify/memory/constitution.md` §III（Localized, Observable, Resource-Safe UX）。所有用户可见字符串必须走 `t('key', params)`，**en 与 zh 双语同步**。本模块是宪法 §III 的双语可观测性的字面量落地层。

## 模块概述

`@i18n` 提供翻译查找 + 占位符替换。locale 自动从 `vscode.env.language` 检测；缺翻译时 fallback 到英文；key 缺失时返回 key 字面量（便于发现漏翻译）。

## 核心文件

| 文件                  | 职责                                                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | `initI18n` / `t(key, params)` / `setLocale` / `getLocale`；占位符支持 `{name}` → `params.name`（同时接受 string / number） |
| `locales/en.json`     | 英文翻译字典（TypeScript `keyof typeof en` 强类型 key 集）                                                            |
| `locales/zh.json`     | 中文翻译字典；key 集合必须与 `en.json` 严格一致                                                                        |

## 关键约束（宪法 §III）

- **`initI18n()` 必须在 Logger 创建之前调用**——`Logger` 内部可能输出 i18n 字符串（见 `src/extension.ts` 入口顺序）。
- **所有用户可见字符串必须经 `t()`**：状态栏、QuickPick、通知、Problems 面板、Output Channel、webview、命令返回值。
- **en 与 zh 同步**：`en.json` 改 key → 立即同步 `zh.json`；`zh.json` 缺 key → `t()` 自动 fallback 到 `en.json`，UI 不崩但翻译缺失 —— 视为缺陷。
- **占位符**：`{name}` / `{count}` 等走 `t(key, { name: 'foo', count: 3 })`，避免 `string.format` / `template literal` 拼接。
- **新增 key** 必须先在 `en.json` 加（确定类型）再在 `zh.json` 同步；TS `keyof typeof en` 会在 `t()` 调用点报错拦截漏 key。

## 用法示例

```typescript
import { t } from '@i18n';

// 普通翻译
vscode.window.showInformationMessage(t('build.notify.success'));

// 带占位符
vscode.window.showInformationMessage(t('build.notify.errors', { count: 3 }));
// en.json: "Build failed with {count} errors"
// zh.json: "构建失败，{count} 个错误"
```

## 跨模块约束

- **不引入新翻译机制**：禁止在 UI / 命令 / 通知里用 `string concatenation` / `template literal` 拼用户可见字符串；只能走 `t()`。
- **不在 `src/i18n/` 内写 vscode 业务逻辑**：本模块只做字符串查表 + 占位符替换；不读 `vscode.workspace.*`、不写 `OutputChannel`。
- **测试**：`test/unit/i18n/` 覆盖 `initI18n` / locale fallback / 占位符替换。
