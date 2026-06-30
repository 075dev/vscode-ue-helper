---
date: 2026-06-30
generator: gsd-map-codebase (orchestrator fallback)
focus: concerns
---

# Concerns — vscode-ue-helper

下面这批条目来自对 `src/clangd/`、`src/mcp/`、`src/build/`、`src/commands/`、`src/detection/`、`src/core/` 与构建配置的全量扫描（由 gsd-codebase-mapper 子智能体汇总，编排者复写持久化）。

## 1. Tech Debt

- **Stub MCP 工具**：`src/mcp/tools.ts` 仍含占位符工具，导出的元信息多于实际实现。AI 代理调用部分工具会得到"No-op"返回。
- **Dormant WorkspaceBackup**：`src/clangd/workspaceBackup.ts` 编写了 UBT 刷新前的 `.code-workspace` 备份逻辑，但当前 `autoBackupWorkspace` 默认为 `true` 时只在被动事件链路触发，缺乏显式调度。
- **Dead code**：
  - `src/detection/engineLocator.ts`：被 `engineDiscovery.ts` 取代，但导出符号仍可见。
  - `core.Config.showWelcomeOnActivation` —— 配置 schema 里已经没有，但类型上仍存在。
- **Hardcoded "Phase N" strings**：某些诊断 UI 输出（如 `diagnostics/format.ts`）包含 `Phase 1/2/3` 字面量，没走 i18n。
- **hot-reload bug from commit `2b26b8e`**：近期回归，详见 `git log -p 2b26b8e`。

## 2. Known Bugs

- **`bridge.handleSignal()` race**：`src/clangd/proxy/bridge.ts` 在并发 LSP 帧流里没有序列化，SIGUSR1 / IPC 异常时偶发丢消息。
- **Settings-backup orphans**：禁用代理时未清理已写入的 `settings.json` 备份快照，残留文件。
- **`setSystemIncludes` race condition**：与 UBT 并发运行时会重复追加 `-I` 路径到 `.clangd`。
- **Swallowed errors in `completionMode.ts`**：补全模式切换失败时仅 `console.warn`，不通过 `outputChannel` / `notifier` 告知用户。
- **Partial-JSON false-positive**：`src/clangd/compileCommands.ts` 的容错在缺尾括号 / 截断内容时偏向"成功"，实际数据残缺。

## 3. Security Considerations

- **MCP 输入校验缺失**：`src/mcp/server.ts` 的 `CallToolRequestSchema` 处理器直接把 `args` 透传给 `callTool`，未对入参做 schema 校验；外部 AI 代理可借此注入任意命令参数。
- **Proxy writes to workspace `settings.json`**：代理启用流程覆盖式写入 `<workspace>/.vscode/settings.json`，多窗口同时打开会互相覆盖。
- **`regenerateWorkspace` overwrites without merge**：丢失用户已有的 `settings` / `extensions` 推荐块。
- **硬编码 `C:\Program Files\LLVM\bin`**：`src/clangd/proxy/realClangdResolver.ts` 默认值硬编码 Windows LLVM 安装路径，对 Scoop / winget 用户不友好，也无 docString 提示。
- **Live Coding runs unsigned binaries**：命令实现走 `execa` + 命名管道，并不验证 UE 进程签名，存在误连恶意进程的小概率窗口。

## 4. Performance

- **`fillMissingCompileCommands` 无界递归**：`src/clangd/compileCommands.ts` 在补全缺失条目时存在递归放大，最坏 O(n²)。
- **Full `.clangd` rewrites**：每次 `useMCP` / completionMode 切换都会覆盖式重写 `.clangd`，全量重建 clangd 索引。
- **Dormant watcher**：`src/clangd/workspaceBackup.ts` 的 chokidar 在某些退出路径上未被 close，进程退出时 warning 日志。
- **Unbounded `runBuild` output accumulation**：`src/build/buildRunner.ts` 把 UBT stdout 全部缓存在内存里，长时间 `Rebuild` 可能 OOM。

## 5. Fragile Areas

- **UBT 路径漂移**：UE 5.7 之后 `BuildTool.exe` 取代 `UnrealBuildTool.exe`，`src/build/ubt.ts` 的解析规则需要持续维护。
- **`Config` getter race with undefined**：`src/core/config.ts` 的访问器在上下文尚未初始化时返回 `undefined`，没有显式 fail-fast。
- **Symlink bypass in `realClangdResolver`**：未拒绝对符号链接解析结果，存在路径混淆。
- **Half-implemented keepalive (didChange)**：`src/clangd/proxy/keepalive.ts` 只对 `didClose` 做了保活，未处理 `didChange` 全量替换。
- **Self-firing watcher**：监听 `.clangd` 时若代理自身也写该文件，会触发循环回调。

## 6. Scaling Limits

- **单一 MCP server 实例**：`MCPServer` 不支持多实例 / 多 workspace。
- **非原子 `compile_commands.json` 写**：替换式写，断电或中途崩溃会留下半文件。
- **硬编码 UE 5.4 preparse 列表**：`resources/preparse-includes/ue5-{fast,slow}.json` 未跟随 UE 版本迁移。

## 7. Dependencies at Risk

- **MCP SDK churn**：`@modelcontextprotocol/sdk ^1.0.0` 早期版本，API 不稳定。
- **过时的 `@types/vscode` 1.85**：当前 VS Code 已发布更高主版本；建议升级锁定。
- **弃用的 `vsce`**：`^2.15.0` 是旧版，应迁移到 `@vscode/vsce`。
- **`execa` / `chokidar` / `neverthrow` / `xstate` 已声明但局部未用**：可能造成 bundle 膨胀，建议清理 import。

## 8. Missing Critical Features

- **Stubbed MCP tools**：见 §1。
- **No `.clangd` merge**：重写时未与已有内容合并，丢失用户自定义配置。
- **No pre-build validation**：构建前不检查 UBT 输出路径 / `.uproject` 完整性。
- **No MCP restart on settings change**：用户改 `useMCP` 后需手动重载窗口。

## 9. Test Coverage Gaps

- **`test/integration/` 为空**：集成测试目录无任何用例。
- **覆盖率盲点**：`src/build/buildRunner.ts`、`src/commands/uninstall.ts`、`src/clangd/workspaceBackup.ts`、`src/build/launchEditor.ts`、`src/mcp/tools.ts` 全部缺测。
- **Vitest 阈值未真正落地**：`vitest.config.ts` 写了阈值，但 CI 未发现提交报告强制门禁，可能是流水线脚本缺失。

## 10. Build Pipeline Risks

- **`vscode` 误入 `clangdProxy.js`**：代理 CLI 是独立进程，任何 `import * as vscode from 'vscode'` 都会拖入 d.ts 失败。
- **Launcher 脚本被覆盖**：每次 `npm run build` 都会改写 `out/launcher/*.bat|sh`，未做内容 hash diff。
- **可能打包了 source map**：生产 minify 选项依赖 `process.env.NODE_ENV === 'production'`，在某些 CI 默认值下可能泄漏 `.map`。
- **32-bit Node OOM**：大工程 Rebuild + 无界 stdout 缓冲在 32 位 Node 上更早 OOM。

## 11. Vendor / Upstream Risk

- **UE 版本兼容未声明**：`README.md` / `package.json` 没说要兼容哪些 UE 版本。
- **clangd 宏契约假设**：依赖 `clangd` 对宏补全的窗口行为，clangd 升级后可能违约。
- **MCP 协议演进**：1.0.0 → 1.x 变化频繁。
- **VS Code API 变更**：`vscode ^1.85` 锁定面较窄。

## 12. Operational Concerns

- **已提交的 `.vsix`**：仓库根目录有 `vscode-ue-helper-0.1.0.vsix`，`.gitignore` 已排除但历史 commit 已含。
- **Orphan `temp_writer.{js,mjs}`**：仓库根目录残留两个 1KB 临时文件，可能是调试期间遗留，应清理。
- **`.hermes/**` 未 excluded**：`.vscodeignore` 已排除，但 `.gitignore` 没有对应的条目。

## Recommended Next Steps (优先级排序)

1. 给 MCP 工具补齐 schema 校验 + 真实实现
2. 修复 `bridge.handleSignal()` race + `setSystemIncludes` race
3. `.clangd` 和 `compile_commands.json` 写入改为原子 / merge
4. 清理 dead code + 给 stub MCP 函数显式失败
5. 重整 `vitest` 阈值门禁，补全 `test/integration/` 与高风险模块测试
6. 把 `vsce` 升级到 `@vscode/vsce`，把 `@types/vscode` 提一档
7. 移除 `temp_writer.*`，给 `.gitignore` 补 `.hermes/**`
