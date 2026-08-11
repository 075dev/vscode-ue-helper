# 贡献指南

VSCodeUEHelper 的开发者 onboarding 文档。新人按本文档可独立走通"git clone → npm i → F5 → 跑测试 → 写新命令 → 提 PR"全流程。

> **治理文档**:本仓库的最高优先级治理文件是
> [`.specify/memory/constitution.md`](.specify/memory/constitution.md)(Windows-only 支持边界、
> WorkspaceState/ClangdOps 边界、双语 UX、验证门禁、依赖最小化)。本文档若与宪法冲突,以宪法为准。

## 1. 环境准备

| 依赖          | 版本                           | 说明                                                            |
| ------------- | ------------------------------ | --------------------------------------------------------------- |
| OS            | **Windows 10/11 (必须)**       | `package.json#platforms: ["win32"]` 强制;Mac/Linux 不在支持范围 |
| Node.js       | ≥ 18.0.0                       | esbuild target=node18,需 ≥ 18                                   |
| VS Code       | ≥ 1.85.0                       | ExtensionManifest 最低 1.85.0                                   |
| Unreal Engine | 5.2+                           | 验证用;本机安装路径示例 `D:\Program Files\UE_5.8\`              |
| MSVC 工具链   | Visual Studio 2022 Build Tools | UBT 构建必需,clangd 系统头发现依赖                              |

**为什么仅 Windows**:仓库专注于 Rider-on-Windows 的 UE5 C++ 体验对标(冷启动 + 内存),跨平台支持是显式 out-of-scope(见 `.planning/PROJECT.md` §Constraints)。Mac/Linux 用户请用 Rider 或 VSCode + 原始 clangd。

## 2. 依赖安装

```bash
npm install
```

`package.json#dependencies` 当前 4 个 runtime deps:

- `@modelcontextprotocol/sdk` —— MCP 服务器(仅 Cursor/Claude Code 启动时激活,见 `src/mcp/AGENTS.md`)
- `chokidar` —— 增量文件监听(被 proxy + fileWatcher 复用)
- `json5` —— `.uproject` 解析(Epic 用 trailing commas,标准 JSON 不支持)
- `yaml` —— `.clangd` 配置文件渲染

零引用 runtime 依赖(已在 DEBT-02 阶段卸): `execa` / `neverthrow` / `xstate`。`execa` 仅作为 vsce 传递依赖留在 lockfile(不直接 import)。

## 3. 常用命令

```bash
npm run build         # clean + esbuild → out/extension.js + out/clangdProxy.js + launcher 脚本
npm run watch         # esbuild 监听模式(开发主推)
npm run typecheck     # tsc --noEmit (必须 0 错误)
npm run lint          # ESLint src + test
npm run format:check  # Prettier 格式检查
npm run test:unit     # Vitest (入口 test/unit/**/*.test.ts, v8 覆盖率 80/80/75/80)
npm run package       # vsce package → .vsix
```

调试: VS Code 里按 `F5` 启动 Extension Development Host(`launch.json` 配置 `Run Extension`)。日志在 Output 面板的 `VSCodeUEHelper` channel。

**注意**:`npm test` 是 `npm run test:unit` 的别名(`package.json#scripts.test`),只跑 Vitest unit;`npm run test:integration` 已删除,集成测试不在本仓库验证范围。

## 4. 代码风格硬约束(摘 AGENTS.md)

详细见 `AGENTS.md` §风格与约定。速览:

- **TypeScript strict 全开**:`strict` + `noUncheckedIndexedAccess` + `noUnusedLocals/Parameters` + `noImplicitReturns` + `noFallthroughCasesInSwitch`
- **ESLint 强制**:`@typescript-eslint/no-floating-promises` / `no-misused-promises` / `await-thenable` 全 `error`
- **路径别名**(9 个, 必用, 禁止相对导入):
  - `@core` `@detection` `@build` `@clangd` `@commands` `@ui` `@mcp` `@i18n` `@parsers`
- **i18n 双语**:所有用户可见字符串走 `t('key', params)`,`src/i18n/locales/{en,zh}.json` 同步更新
- **日志前缀**:每个 `logger.info/warn/error` 首参数形如 `'[<moduleName>] <msg>'`(见 `src/core/logger.ts` 文档约定)
- **资源清理**:所有 VS Code 资源(StatusBar / Command / Watcher) push 到 `context.subscriptions`
- **代码注释强制中文**——本仓库硬约束,新代码 export 函数必须有中文 JSDoc

### 新增命令 4 步

1. **`package.json#contributes.commands`** —— 加命令定义(title + category)
2. **`src/commands/xxx.ts`** —— 写 `executeXxx(config, logger, detection, ...)` 异步函数
3. **`src/commands/index.ts`** —— import + `track('vscodeUEHelper.xxx', ...)` 注册
4. **i18n 双语** —— `src/i18n/locales/zh.json` + `en.json` 同步 key

完整 4 步法示例见 `src/commands/AGENTS.md` §新增命令步骤。

## 5. Commit 规范(Conventional Commits)

格式: `<type>(<scope>): <中文 summary>`

| Type       | 用途                             |
| ---------- | -------------------------------- |
| `feat`     | 新功能                           |
| `fix`      | 修复 bug                         |
| `chore`    | 工具链 / 资产 / 配置(无功能影响) |
| `docs`     | 纯文档                           |
| `refactor` | 重构(无功能变化)                 |
| `test`     | 仅测试                           |
| `perf`     | 性能                             |

Scope(可选): `build` / `clangd` / `commands` / `core` / `detection` / `mcp` / `ui` / `i18n` / `extension` 等模块名。

中文 summary 优先(与"代码注释强制中文"对齐)。例:

- `feat(clangd): 新增 .clangd 备份恢复命令`
- `fix(build): UBT 启动时 project path 含空格 crash`
- `chore(assets): 替换占位 icon.png 为合规 128×128`
- `docs(agents): 校准仓库陷阱 #1/#2/#7/#10 与 2026-07-23 实测`

仓库已有先例:`deb7ac7 chore(assets): 替换占位 icon.png ...` / `eb04492 docs: ...`。详见 `AGENTS.md` §Commit message 规范。

## 6. PR 流程

1. **fork + 新建分支**:分支名规范 `<type>/<short-desc>`,例 `fix/ubt-space-crash`
2. **改代码 + 加测试**(若改运行时行为)
3. **跑门禁三连**:
   ```bash
   npm run typecheck && npm run lint && npm run test:unit
   ```
   全绿才能提 PR
4. **提 PR**, 填 `.github/PULL_REQUEST_TEMPLATE.md` 字段(Phase / 影响模块 / 测试步骤 / Screenshots / Breaking Changes / Checklist)
5. **reviewer 检查 + squash merge**

## 7. Code Review Checklist

reviewer 验收 PR 时逐项勾选:

- [ ] 不引入 `any` / `@ts-ignore`(新代码必须 0 匹配,D-11 硬约束)
- [ ] 不动 ESLint bypass 规则(无新 `eslint-disable` 除非带 justified 注释)
- [ ] i18n 双语同步(改文案同步 en + zh)
- [ ] 资源清理入 `context.subscriptions`(StatusBar / Command / Watcher 都不漏)
- [ ] 公共 API 导出用 `@core/xxx` / `@clangd/xxx` 等路径别名,不写相对路径
- [ ] 中文 JSDoc 覆盖 export 函数(D-07 硬约束)
- [ ] 跑 `npm run test:unit` 全绿,新增功能有对应单测
- [ ] 改 AGENTS.md 仓库陷阱条目时,末尾追加 `*(T-NN 闭环 YYYY-MM-DD: ...)*` 风格注释(per Phase 1 反漂移约定)
- [ ] 新 runtime 依赖有具体用途、tradeoff 与显式 review 决策（宪法 §V）

## 8. 提交前自检

```bash
# 1. 列出所有改动
git diff --stat

# 2. 硬约束三连
npm run typecheck  # 期望 0 errors
npm run lint       # 期望 0 errors, 0 warnings
npm run test:unit  # 期望 Test Files all passed

# 3. 如果改了 package.json
npm run build  # 验证 esbuild 双 bundle 仍成功

# 4. 如果改了 src/clangd/ 或 src/build/
# 跑 1 次真实 UE5 项目的手动 smoke test (F5 启动 + Ctrl+Shift+B 构建)
```

## 9. 调试 / 发布流程

- **调试**:见 `docs/DEBUG.md`(F5 启动 EDH、attach 到 clangd proxy 子进程、日志位置、常见问题排查)
- **发布**:见 `docs/RELEASE.md`(version bump、CHANGELOG 更新、vsce package 验证、Marketplace 提交、rollback 流程)

## 10. 架构决策背景

关键决策的来龙去脉见 `docs/adr/`:

- `0001-phase-8-ssot.md` —— WorkspaceState 单一真相源
- `0002-phase-9-clangdops.md` —— ClangdOps 统一 .clangd 写入
- `0003-live-coding-throttle.md` —— Live Coding 5s 节流

Phase 3-6 设计背景见 `docs/design/`。
