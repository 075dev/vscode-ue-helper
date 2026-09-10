<!-- Parent: ../AGENTS.md -->
# clangd/proxy —— 独立 LSP 代理 CLI 进程

> 治理参考：`.specify/memory/constitution.md`。Proxy 子进程必须满足宪法 §III（Localized, Observable, Resource-Safe UX）：**`stdout` 只承载 LSP 协议帧**，所有诊断 / 日志 / 通知走独立通道（stderr / OutputChannel / 文件 tail）；还必须满足宪法 §I（Windows-First Unreal Scope）+ §V（Minimal, Traceable, Reversible Evolution）：本 bundle 严禁引入 `vscode` 依赖，避免与宿主耦合。

**特殊形态**：本目录**不由本插件主进程加载**。它是一个**独立 Node 子进程**，通过 `clangd.vscode` 扩展（用户另装）以 `clangd.path` 指向我们生成的 launcher 启动。

## 入口与构建产物

| 产物                              | 来源                                     | 用途                                                |
| --------------------------------- | ---------------------------------------- | --------------------------------------------------- |
| `out/clangdProxy.js`              | esbuild **第二** bundle（`cli.ts` 入口） | 实际 Node 脚本                                      |
| `out/launcher/proxy-launcher.bat` | esbuild 自动生成                         | Windows 启动器（设置 `useScriptAsExecutable=true`） |
| `out/launcher/proxy-launcher.sh`  | esbuild 自动生成 + chmod 755             | Unix 启动器（Windows chmod 失败被吞）               |

**禁止**：

- 给本目录加 `index.ts` —— 外部 clangd 扩展直接调 `cli.ts` bundle，barrel 无意义。
- 引入 `vscode` 模块依赖（本 bundle 在 esbuild 中 `external: []`，zero-deps on vscode）—— 违反宪法 §V（minimal dependencies）与 §III（lifecycle ownership）。
- i18n 入口放这里 —— stdio 进程不应依赖 `vscode.OutputChannel`；走 `proxyLogTailer.ts` + 文件 log + stderr 三通道。

## 核心组件

| 文件                                       | 职责                                                                                   |
| ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `cli.ts`                                   | 进程入口，解析 argv，构造 `LspBridge` + `ProcessBridge`                                |
| `cliArgs.ts`                               | `--project-dir` / `--engine-root` / `--ubt-path` / `--build-target` 等参数             |
| `bridge.ts`                                | `LspBridge`：上层 LSP 客户端消息到真实 clangd 子进程的转发。**stdout 仅 LSP 协议帧**   |
| `processBridge.ts`                         | `ProcessBridge`：`ServerTransport` 实现，spawn 真实 clangd 二进制                      |
| `framing.ts`                               | LSP `Content-Length` 帧解析（HTTP-like 头 + JSON body）                                |
| `messages.ts`                              | JSON-RPC 消息分类（`initialize` / `textDocument` / `publishDiagnostics`）              |
| `keepalive.ts`                             | `didClose` 状态机（避免 off-doc 时 hover 死锁）                                        |
| `localization.ts`                          | UE 词典汉化（completion / signature / inlay 类型名）。**当前未生效（6 处 TODO 占位）** |
| `genericTranslator.ts`                     | 通用翻译器，文档查找兜底                                                               |
| `ueDocLookup.ts`                           | UE 文档注释查找（依赖 `scripts/extract-ue-docs.ts` 输出）                              |
| `ueDiagnosticWatcher.ts`                   | [Phase 8 D-05/D-06] 拦截 clangd 诊断，被动触发 UBT 重建                                |
| `generatedHeaderWatcher.ts`                | 监听 `.generated.h`，通知 clangd re-parse                                              |
| `settingsReader.ts` / `settingsManager.ts` | 读 `.vscode/settings.json` + 备份恢复 `clangd.path` 防被代理覆盖                       |
| `realClangdResolver.ts`                    | 找真实 clangd 二进制（排除我们自己的 launcher）                                        |
| `status.ts`                                | `ClangdProxyStatus` 状态机 + `buildStatus()`                                           |
| `cliRuntime.ts`                            | 进程运行时辅助（信号处理、退出码）                                                     |

## stdio 协议

```
[VS Code clangd ext]  stdio  [proxy]  stdio  [clangd]
              ↑                              ↓
              └──────── LSP JSON-RPC ────────┘
```

- `Content-Length` 帧：`Content-Length: 1234\r\n\r\n{"jsonrpc":"2.0",...}` —— 不是 HTTP，是 LSP 规范。
- 消息路由：`bridge.ts` 透传大多数消息，仅在需要增强（汉化 / UE 宏补全 / 被动重建）时拦截。
- **硬约束**：proxy 进程的 `stdout` 上**只**写 LSP 协议帧（`encodeMessage` → `process.stdout.write`）；所有调试 / 诊断 / 通知 / 日志必须走 `process.stderr` 或独立文件 log（满足宪法 §III）。

## stdout / stderr 分工

| 通道                                      | 允许写入                                                                                                 |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `stdout`                                  | `Content-Length: …` + LSP JSON-RPC 帧（仅此而已）                                                        |
| `stderr`                                  | 诊断 / 启动 / 关闭 / keepalive 状态机日志（带 `[proxy]` / `[proxy/bridge]` / `[proxy/diagnostic]` 前缀） |
| 独立文件 log（`proxyLogPath` 设置）       | 长寿命 perf / 诊断上下文，方便 `proxyLogTailer.ts` 在 UI 中展示                                          |
| `proxyLogChannel`（主进程 OutputChannel） | 由主进程通过文件 tail 收集，不在本子进程内 push                                                          |

任何把调试信息写到 `stdout` 的改动都是宪法 §III 违规，**必须改走 stderr / 文件 log**。也禁止用 `console.log`（默认 stdout）—— 统一走 `cliRuntime.ts` 的 logger helper。

## 资源清理与生命周期

- `cli.ts` 安装 SIGINT / SIGTERM handler，关闭 `GeneratedHeaderWatcher`、`UeDiagnosticWatcher` 与 bridge；新增长寿命句柄必须接入同一关闭路径（宪法 §III lifecycle ownership）。
- `generatedHeaderWatcher.ts` 与 `ueDiagnosticWatcher.ts` 已暴露 `dispose()`；新增 watcher 必须提供等价释放入口。
- `LspBridge` 的关闭路径由 CLI runtime 在信号处理时调用。

## Windows-only 约束

- `realClangdResolver` 在 Windows 上优先查找 `.exe` 后缀；非 Windows 路径保留但只作迁移期兼容（宪法 §V reversible evolution）。
- 文件路径统一使用 `path.join` / `path.resolve`，避免 Unix-only 写法。
- launcher 在 Windows 上走 `.bat`，Unix 上走 `.sh`（Windows 上 chmod 失败被吞 —— 由 Windows-only 范围控制，不影响主路径）。

## 测试入口

`test/unit/clangd/proxy/*` —— 17 个测试文件，最大单测套件。

- `e2eHarness.test.ts`（584 行） + `e2eCliRestartLoop.test.ts` —— e2e flow 验证主战场。
- `cliStdio.test.ts`、`cliEntrypoint.test.ts` —— 进程入口测试。

### stdout / stderr 测试断言

测试组必须包含 stdout 纯净断言（宪法 §III）：

- 任何成功的 LSP 交互后 `stdout` 仍**只**包含 `Content-Length` 头和 JSON-RPC 帧；
- stderr / 文件 log 可包含调试内容，但不应泄漏到 `stdout`。
- 已有 `vi.mock('child_process', ...)` 处理子进程 mock；新增测试不要直接捕获 `console.log`。

## 当前已知问题（占位 / 未排期）

1. **6 个汉化 TODO 未落地**（`localization.ts × 3` + `bridge.ts × 3`） —— 后续实现是空头承诺，未排进任何 phase。规划时不要假设汉化已上线。
2. **`child_process` 未全局 mock** —— 测试用 `vi.mock('child_process', ...)` 测试侧处理。
3. e2e 测试依赖真实 clangd 二进制存在（`realClangdResolver` 路径），CI 环境需预安装。

## 跨模块约束（宪法 §II / §V）

- **Proxy 只做协议边界工作** —— LSP 转发、汉化、诊断观察、被动重建触发与 generated-header 通知都留在 proxy；扩展主进程负责 VS Code UI、设置和命令编排。
- **不在 proxy 内写 `.clangd`** —— `settingsManager.ts` 只对 `clangd.path` 做最小必要备份 / 恢复；`.clangd` 写入由扩展主进程走 `ClangdOps`（满足宪法 §III atomic writes）。
- **依赖最小化** —— 新增 npm 依赖要经过宪法 §V 评审（concrete use + tradeoff + explicit review）。当前 `framing` / `messages` / `keepalive` 全部手写，不引第三方 LSP 库。
