# 溯源索引

> 每条 Codewiki 结论均可追溯到源码位置。

## 架构结论溯源

| 结论 | 依据 | 置信度 |
|------|------|--------|
| 项目为 VS Code Extension | `package.json:2` name=`vscode-ue-helper`, `package.json:36` main=`out/extension.js` | 🟢确定 |
| 入口为 `activate()` | `src/extension.ts:56` `export async function activate(context)` | 🟢确定 |
| 模块激活顺序为 i18n → Logger → detection → build → clangd → ui → commands | `src/extension.ts:13-19` 注释明确标注，`src/extension.ts:71-87` 代码严格遵循 | 🟢确定 |
| 使用 esbuild 构建 | `esbuild.config.mjs:1-62`, `package.json:300` `"build": "node esbuild.config.mjs"` | 🟢确定 |
| TypeScript strict 模式全开 | `tsconfig.json:9-21` strict, noImplicitAny, strictNullChecks 等全为 true | 🟢确定 |
| 用 vitest 测试 | `vitest.config.ts:1-43`, `package.json:308` `"test:unit": "vitest run"` | 🟢确定 |
| 信任 `.code-workspace` 不做文件系统扫描 | `doc/01-architecture.md:103-107` 明确说明 | 🟢确定 |
| 用 JSON5 解析 `.uproject` | `doc/02-modules.md:110-118` 说明，`package.json:333` 依赖 `json5: ^2.2.3` | 🟢确定 |
| 无循环依赖 | 拓扑排序验证：extension → modules → core/i18n，方向单向 | 🟢确定 |
| MCP 服务自动检测宿主 | `package.json:247` `useMCP: "auto" = enable only in Cursor/Claude Code` | 🟢确定 |

## 关键逻辑溯源

| 功能 | 实现位置 | 代码签名 | 置信度 |
|------|---------|---------|--------|
| 插件激活 | `src/extension.ts:56-119` | `activate(context: ExtensionContext): Promise<void>` | 🟢确定 |
| 插件卸载 | `src/extension.ts:128-143` | `deactivate(): void` | 🟢确定 |
| 国际化初始化 | `src/i18n/index.ts` | `initI18n(): void` | 🟢确定 |
| 项目+引擎发现 | `src/detection/index.ts` | `activateDetection(context, config, logger): DetectionHandles` | 🟢确定 |
| .code-workspace 解析 | `src/detection/workspaceFolders.ts` | `readWorkspaceEntries(workspaceFile): [{name, path}]` | 🟢确定 |
| .uproject 解析 (JSON5) | `src/detection/uprojectScanner.ts` | `parseFromPath(uprojectPath): Promise<ProjectInfo>` | 🟢确定 |
| Build.version 解析 | `src/detection/workspaceFolders.ts` | `readBuildVersion(engineRoot): string` | 🟢确定 |
| UBT 构建 | `src/build/buildRunner.ts` | 执行 `cmd.exe /c Build.bat` | 🟢确定 |
| Live Coding | `src/build/liveCoding.ts` | 触发 UE Live Coding | 🟢确定 |
| 启动 Editor | `src/build/launchEditor.ts` | `spawn('cmd', ['/c', 'start', ...], {detached})` | 🟢确定 |
| clangd 配置生成 | `src/clangd/clangdConfig.ts` | `writeClangdConfig(...)` | 🟢确定 |
| compile_commands.json | `src/clangd/compileCommands.ts` | `generateCompileCommands(...)` | 🟢确定 |
| Windows SDK/MSVC 检测 | `src/clangd/windowsSdk.ts:32-194` | 通过 InstalledDir 反查 | 🟢确定 |
| 工作区备份 | `src/clangd/workspaceBackup.ts` | 自动备份 .code-workspace | 🟢确定 |
| 状态栏渲染 | `src/ui/statusBar.ts` | `StatusBarManager.update(ctx, settings)` | 🟢确定 |
| 11 个状态栏按钮 | `src/ui/statusBar.ts` + `doc/01-architecture.md:177-190` | 详见架构文档 4. 状态栏 UI | 🟢确定 |
| 命令注册 | `src/core/command-registry.ts` | `registerCommand(context, id, callback)` | 🟢确定 |
| Logger | `src/core/logger.ts` | `class Logger` — info/warn/error/show | 🟢确定 |
| Config | `src/core/config.ts` | `class Config` — get/update 强类型包装 | 🟢确定 |
| MCP Server | `src/mcp/server.ts` | MCP 协议服务端启动 | 🟢确定 |
| MSVC 输出解析 | `src/parsers/msvcParser.ts` | 解析 MSVC error/warning 格式 | 🟢确定 |
| UBT 输出解析 | `src/parsers/ubtParser.ts` | 解析 UBT 构建输出 | 🟢确定 |
| Linker 输出解析 | `src/parsers/linkerParser.ts` | 解析链接器输出 | 🟢确定 |

## 测试覆盖溯源

| 测试文件 | 覆盖模块 | 类型 |
|----------|---------|------|
| `test/unit/core/config.test.ts` | src/core/config | 单元测试 |
| `test/unit/clangd/clangdConfig.test.ts` | src/clangd/clangdConfig | 单元测试 |
| `test/unit/detection/workspaceEngines.test.ts` | src/detection/workspaceEngines | 单元测试 |
| `test/unit/parsers/msvcParser.test.ts` | src/parsers/msvcParser | 单元测试 |
| `test/unit/parsers/ubtParser.test.ts` | src/parsers/ubtParser | 单元测试 |
| `test/integration/` | 全插件 | 集成测试 |
