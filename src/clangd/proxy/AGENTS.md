# clangd/proxy —— 独立 LSP 代理 CLI 进程

**特殊形态**：本目录**不由本插件主进程加载**。它是一个**独立 Node 子进程**，通过 `clangd.vscode` 扩展（用户另装）以 `clangd.path` 指向我们生成的 launcher 启动。

## 入口与构建产物

| 产物 | 来源 | 用途 |
|---|---|---|
| `out/clangdProxy.js` | esbuild **第二** bundle（cli.ts 入口） | 实际 Node 脚本 |
| `out/launcher/proxy-launcher.bat` | esbuild 自动生成 | Windows 启动器（设置 useScriptAsExecutable=true） |
| `out/launcher/proxy-launcher.sh` | esbuild 自动生成 + chmod 755 | Unix 启动器（Windows chmod 失败被吞） |

**禁止**：
- 给本目录加 `index.ts` —— 外部 clangd 扩展直接调 cli.ts bundle，barrel 无意义。
- 引入 `vscode` 模块依赖（本 bundle 在 esbuild 中 `external: []`，zero-deps on vscode）。
- i18n 入口放这里 —— stdio 进程不应依赖 vscode OutputChannel。

## 核心组件

| 文件 | 职责 |
|---|---|
| `cli.ts` | 进程入口，解析 argv，构造 LspBridge + ProcessBridge |
| `cliArgs.ts` | --project-dir / --engine-root / --ubt-path / --build-target 等参数 |
| `bridge.ts` | LspBridge：上层 LSP 客户端消息到真实 clangd 子进程的转发 |
| `processBridge.ts` | ProcessBridge：ServerTransport 实现，spawn clangd 二进制 |
| `framing.ts` | LSP Content-Length 帧解析（HTTP-like 头 + JSON body） |
| `messages.ts` | JSON-RPC 消息分类（initialize / textDocument / publishDiagnostics） |
| `keepalive.ts` | didClose 状态机（避免 off-doc 时 hover 死锁） |
| `localization.ts` | UE 词典汉化（completion / signature / inlay 类型名）。**当前不生效（TODO）** |
| `genericTranslator.ts` | 通用翻译器，文档查找兜底 |
| `ueDocLookup.ts` | UE 文档注释查找（依赖 scripts/extract-ue-docs.ts 输出） |
| `ueDiagnosticWatcher.ts` | [Phase 8 D-05/D-06] 拦截 clangd 诊断，被动触发 UBT 重建 |
| `generatedHeaderWatcher.ts` | 监听 .generated.h，通知 clangd re-parse |
| `settingsReader.ts` / `settingsManager.ts` | 读 .vscode/settings.json + 备份恢复 clangd.path 防被代理覆盖 |
| `realClangdResolver.ts` | 找真实 clangd 二进制（排除我们自己的 launcher） |
| `status.ts` | ClangdProxyStatus 状态机 + buildStatus() |
| `cliRuntime.ts` | 进程运行时辅助（信号处理、退出码） |
## stdio 协议

```
[VS Code clangd ext]  stdio  [proxy]  stdio  [clangd]
              ↑                              ↓
              └──────── LSP JSON-RPC ────────┘
```

- Content-Length 帧：`Content-Length: 1234\r\n\r\n{"jsonrpc":"2.0",...}` —— 不是 HTTP，是 LSP 规范。
- 消息路由：bridge.ts 透传大多数消息，仅在需要增强（汉化、UE 宏补全、被动重建）时拦截。

## 测试入口

`test/unit/clangd/proxy/*` —— 17 个测试文件，最大单测套件。
- `e2eHarness.test.ts`（584 行） + `e2eCliRestartLoop.test.ts` —— e2e flow 验证主战场。
- `cliStdio.test.ts`、`cliEntrypoint.test.ts` —— 进程入口测试。

## 当前已知问题

1. **6 个汉化 TODO 未落地**（localization.ts × 3 + bridge.ts × 3）—— 后续实现是空头承诺，未排进任何 phase。
2. **child_process 未全局 mock**：测试用 `vi.mock('child_process', ...)` 测试侧处理。
3. e2e 测试依赖真实 clangd 二进制存在（realClangdResolver 路径），CI 环境需预安装。
