# VSCodeUEHelper 执行流程图

本插件的完整执行流程,按 **激活时序全景** + 四个关键子流程分层呈现。

---

## 一、激活时序全景图

```mermaid
flowchart TD
    Act(["activate(context)"]) --> S1["① initI18n()<br/>必须最先"]
    S1 --> S2["② new Logger + Config<br/>基础设施"]
    S2 --> S3["③ activateDetection()<br/>同步返回 DetectionHandles"]
    S3 --> S4["④ new WorkspaceState<br/>订阅 detection.ready"]
    S4 --> S5["⑤ new ClangdOps<br/>统一 .clangd API"]
    S5 --> S6["⑥ activateBuild()<br/>UBT TaskProvider"]
    S6 --> S7["⑦ activateClangd()<br/>注入 workspace + clangdOps"]
    S7 --> S8["⑧ activateUI()<br/>状态栏"]
    S8 --> S9["⑨ activateCommands()<br/>注册 21 命令"]
    S9 --> S10["⑩ ControlPanelProvider<br/>webview"]
    S10 --> Done(["✅ 激活完成"])

    %% detection 异步 pre-warm,多处 await
    S3 -. "异步 IIFE" .-> DF["detection.ready<br/>(Promise)"]
    DF -. "await" .-> S7
    DF -. "await" .-> S8

    classDef phase fill:#e8f0fe,stroke:#1a73e8,stroke-width:2px,color:#000;
    classDef async fill:#fef7e0,stroke:#f9ab00,stroke-width:2px,color:#000;
    classDef done fill:#e6f4ea,stroke:#1e8e3e,stroke-width:2px,color:#000;
    class S1,S2,S3,S4,S5,S6,S7,S8,S9,S10 phase;
    class DF async;
    class Done done;
```

**关键设计**:Promise 驱动的异步解耦。`activateDetection()` 同步返回 handles,但真正的检测在 `handles.ready`(IIFE 异步)里 pre-warm;后续模块(`activateUI`、`activateClangd` 里的 watcher)各自 `await detection.ready` 再拿结果,避免激活期阻塞。

---

## 二、子流程 A:detection 检测层

单一信息源是 `.code-workspace` 的 `folders[]`,硬规则识别角色:`path === '.'` -> project,`name === 'UE5'` -> engine,其余 unknown。

```mermaid
flowchart TD
    A["activateDetection()<br/>同步返回 handles"] --> B["handles.ready = IIFE 异步"]
    B --> C{"有 .code-workspace?<br/>vscode.workspace.workspaceFile"}
    C -- "否" --> X1["返回空<br/>projects=[], engines=[]"]
    C -- "是" --> D["读 .code-workspace<br/>JSON.parse folders[]"]
    D --> E["解析每个 folder:<br/>role + absPath"]
    E --> F{"path === '.'?"}
    F -- "是" --> G1["role = project"]
    F -- "否" --> H{"name === 'UE5'?"}
    H -- "是" --> G2["role = engine"]
    H -- "否" --> G3["role = unknown"]

    G1 --> P1["拼 &lt;name&gt;.uproject<br/>UprojectScanner.parseFromPath"]
    P1 --> P2{"JSON5 解析成功?"}
    P2 -- "否" --> P3["logger.error<br/>projects 留空"]
    P2 -- "是" --> P4["push ProjectInfo<br/>含 modules/targets"]

    G2 --> E1["验证 Engine/Build/Build.version"]
    E1 --> E2["readBuildVersion<br/>读 Major.Minor.Patch"]
    E2 --> E3["push EngineInstall"]

    P4 --> R["resolve detection.ready<br/>{projects, engines, folders...}"]
    P3 --> R
    E3 --> R

    classDef ok fill:#e6f4ea,stroke:#1e8e3e;
    classDef err fill:#fce8e6,stroke:#d93025;
    class R ok;
    class X1,P3 err;
```

---

## 三、子流程 B:clangd Proxy 启用与运行时架构

核心特色:在 clangd 扩展和真实 clangd 进程之间插入一个**独立子进程 LSP 代理**(`src/clangd/proxy/`,14 个文件,vscode-free)。

```mermaid
flowchart TD
    subgraph Ext["VS Code 扩展进程 (extension.js)"]
        EM["ClangdProxyManager.enable()"]
        EM --> BA["备份 clangd.path/arguments<br/>-> workspaceState"]
        BA --> BP["buildProxyArgs:<br/>--real-clangd / --keepalive-*<br/>--localization-* / --ubt-path<br/>--build-target / --project-dir / --engine-root"]
        BP --> WP["写 workspace 级配置:<br/>clangd.path = launcher<br/>arguments = proxyArgs + -- + 原始args"]
        WP --> TL["startTailer()<br/>转发 proxy 日志->Output"]
    end

    subgraph ClangdExt["clangd 扩展"]
        CE["读配置后启动<br/>clangd.path = launcher"]
    end

    subgraph Proxy["Proxy 子进程 (clangdProxy.js, vscode-free)"]
        CL["cli.ts<br/>解析 -- 与 --real-clangd"]
        CL --> BR["bridge.ts<br/>LSP 帧解析 + 转发"]
        BR --> KA["keepalive.ts<br/>拦截 didClose, TTL 内不转发"]
        BR --> LO["localization.ts<br/>诊断/codeAction/hover 中文"]
        BR --> DW["ueDiagnosticWatcher.ts<br/>被动诊断闭环 (见子流程 C)"]
    end

    subgraph Real["真实 clangd 子进程"]
        RC["clangd<br/>由 --real-clangd 指定"]
    end

    WP --> CE
    CE -->|启动 launcher.bat/sh| CL
    BR <-->|LSP 双向| RC

    User(["VS Code 用户操作"]) <-->|LSP| CE

    classDef ext fill:#e8f0fe,stroke:#1a73e8;
    classDef proxy fill:#fef7e0,stroke:#f9ab00;
    classDef real fill:#f3e8fd,stroke:#9334e6;
    class EM,BA,BP,WP,TL ext;
    class CL,BR,KA,LO,DW proxy;
    class RC,CE real;
```

**代理插入的三类增强**:
- **keepalive**:拦截 `textDocument/didClose`,TTL(默认 900s)内不转发,抑制 close->reopen 重新索引抖动;退出/`shutdown` 时 `flush()` 补发。
- **localization**:诊断/codeAction/hover 追加/覆盖中文翻译,接入 UE 文档词典。
- **被动诊断闭环**:见子流程 C。

---

## 四、子流程 C:UE 被动诊断修复闭环 ⭐(当前工作主线)

> 设计哲学:**不主动触发 UBT**,只在 clangd 报错时被动响应。proxy 是 vscode-free 进程,UBT 路径/target 由扩展侧解析后通过 CLI 参数传入。

```mermaid
flowchart TD
    Start["clangd 发出<br/>publishDiagnostics"] --> INT["UeDiagnosticWatcher 拦截<br/>(proxy 侧)"]
    INT --> NORM["normalizeFileUri<br/>统一 file:///E:/ 形式"]
    NORM --> CHK{"是 UE 特征报错?<br/>.generated.h 缺失/<br/>UBT 未生成等"}
    CHK -- "否" --> PASS["透传给 VS Code"]
    CHK -- "是" --> ADD["加入 ueErrorFiles 集合"]
    ADD --> THR{"达触发阈值?<br/>连续 N 次 / 时间窗内<br/>+ minUbtInterval 10s"}
    THR -- "否" --> WAIT["继续累计,等待下次诊断"]
    THR -- "是" --> UBT["runUbt()<br/>--ubt-path + --build-target<br/>重新生成 .generated.h"]
    UBT --> UBTOK{"UBT 成功?"}
    UBTOK -- "否" --> RETRY{"重试 < maxRetries(3)?"}
    RETRY -- "是" --> UBT
    RETRY -- "否" --> GIVEUP["停止自动触发"]
    UBTOK -- "是" --> FORCE["forceReparseOpenFiles()"]

    FORCE --> RD["读磁盘 .h 全量内容<br/>(didSave 后 == 缓冲区)"]
    RD --> URI["取 VS Code 原始 uri<br/>bridge.getOriginalUri()<br/>⚠️ 不能用规范化 uri,<br/>否则 clangd 当作 non-added document"]
    URI --> INJ["bridge.injectClientNotification<br/>textDocument/didChange (全量内容)"]
    INJ --> REPARSE["clangd 替换 draft + re-parse<br/>重读新生成的 .generated.h"]
    REPARSE --> CLR["清除 ueErrorFiles / 复位"]
    CLR --> Done(["✅ 诊断修复"])

    classDef intercept fill:#fef7e0,stroke:#f9ab00;
    classDef ubt fill:#fce8e6,stroke:#d93025;
    classDef fix fill:#e6f4ea,stroke:#1e8e3e;
    class INT,NORM,CHK,ADD,THR,PASS,WAIT intercept;
    class UBT,RETRY,GIVEUP ubt;
    class FORCE,RD,URI,INJ,REPARSE,CLR,Done fix;
```

**关键细节**(`src/clangd/proxy/ueDiagnosticWatcher.ts:484`):UBT 跑完后 clangd 不会自动重解析(那些文件不在 main-file body),所以代理主动注入 `didChange` 全量内容强制 re-parse;且必须用 `bridge.getOriginalUri()` 拿到 didOpen 时的原始 uri 形式,否则被 clangd 当作 "non-added document" 拒绝。

---

## 五、子流程 D:compile_commands.json 生成(带指纹缓存快路径)

```mermaid
flowchart TD
    Entry["generateCompileCommands(opts)"] --> FP["computeFingerprint(projectDir)<br/>SHA256 拼接源文件元数据"]
    FP --> CR["cache.tryRead(projectDir)<br/>读 .vscode/clangd-perf-cache/"]
    CR --> HIT{"fingerprint 一致<br/>且 ccPath 存在?"}
    HIT -- "是 ✅" --> FAST["跳过 UBT<br/>直接返回 ccPath<br/>(cacheFastPath)"]
    HIT -- "否" --> MISS["cacheMiss<br/>走 UBT 路径"]

    MISS --> U1["getUbtPath(engineRoot)<br/>RunUBT.bat 优先"]
    U1 --> U2{"找到 UBT?"}
    U2 -- "否" --> ERR1["throw: UBT not found"]
    U2 -- "是" --> U3["注入 LLVM_PATH<br/>env 优先 -> where clang 反推"]
    U3 --> U4["executeShellTask<br/>UBT -Mode=GenerateClangDatabase<br/>(⚠️ Native -projectfiles 不生成 cc.json)"]
    U4 --> U5["在 5 个候选路径<br/>找第一个非空文件<br/>(>2 字节)"]
    U5 --> U6{"找到?"}
    U6 -- "否" --> ERR2["throw: cc.json not found<br/>列出候选 + 原因"]
    U6 -- "是" --> WC["cache.write()<br/>写指纹缓存供下次命中"]
    WC --> RTN["返回 ccPath"]

    FAST --> PERF
    RTN --> PERF["全流程 perfLog 埋点<br/>-> PerfStatusBar"]

    classDef fast fill:#e6f4ea,stroke:#1e8e3e;
    classDef err fill:#fce8e6,stroke:#d93025;
    class FAST fast;
    class ERR1,ERR2 err;
```

---

## 六、运行时全景(各模块关系)

```mermaid
flowchart LR
    subgraph VSCode["VS Code"]
        UI["状态栏 8+ 按钮<br/>ControlPanel webview<br/>21 命令 / QuickPick"]
        CE["clangd 扩展"]
    end

    subgraph ExtProc["扩展进程"]
        WS["WorkspaceState<br/>(单一真相源)"]
        OPS["ClangdOps<br/>(.clangd 读写)"]
        PM["ClangdProxyManager"]
        CC["generateCompileCommands<br/>(指纹缓存)"]
        MCP["MCP Server<br/>6 工具 stdio"]
    end

    subgraph ProxyProc["Proxy 子进程 (vscode-free)"]
        BR["bridge<br/>LSP 转发"]
        KA["keepalive<br/>didClose 抑制"]
        LO["localization<br/>中文"]
        DW["UeDiagnosticWatcher<br/>被动诊断闭环"]
    end

    subgraph External["外部进程"]
        UBT["UBT<br/>GenerateClangDatabase"]
        RC["真实 clangd"]
        LC["Live Coding"]
        ED["UE Editor"]
        AI["Cursor / Claude Code"]
    end

    UI --> WS
    UI --> OPS
    CE -->|被 PM 改写 path| BR
    BR <-->|LSP| RC
    BR --- KA
    BR --- LO
    BR --- DW
    DW -->|触发| UBT
    DW -->|didChange 强制 reparse| RC
    CC -->|Task| UBT
    UI -->|liveCoding| LC
    UI -->|launchEditor| ED
    MCP <-->|stdio| AI

    classDef ext fill:#e8f0fe,stroke:#1a73e8;
    classDef proxy fill:#fef7e0,stroke:#f9ab00;
    classDef extproc fill:#e6f4ea,stroke:#1e8e3e;
    class UI,CE ext;
    class BR,KA,LO,DW proxy;
    class WS,OPS,PM,CC,MCP extproc;
```

---

## 图例

| 颜色 | 含义 |
|------|------|
| 🔵 蓝色 | VS Code 侧 |
| 🟡 黄色 | Proxy 子进程(vscode-free) |
| 🟢 绿色 | 扩展进程核心组件 / 成功路径 |
| 🔴 红色边框 | 错误 / 终止路径 |
| ⭐ | 子流程 C 是最近 5 个 commit 的开发主线 |

## 关键源码索引

| 流程 | 源码位置 |
|------|----------|
| 激活主序列 | `src/extension.ts:26` |
| detection 检测 | `src/detection/index.ts:84` |
| WorkspaceState | `src/core/workspace.ts` |
| ClangdOps | `src/clangd/clangdOps.ts:47` |
| clangd 激活 | `src/clangd/index.ts:101` |
| Proxy 启用 | `src/clangd/proxyManager.ts:148` |
| 设置备份/恢复 | `src/clangd/proxy/settingsManager.ts:82` |
| LSP 桥接 | `src/clangd/proxy/bridge.ts` |
| keepalive | `src/clangd/proxy/keepalive.ts` |
| 被动诊断闭环 | `src/clangd/proxy/ueDiagnosticWatcher.ts:484` |
| compile_commands 生成 | `src/clangd/compileCommands.ts:314` |
| 命令注册(21 个) | `src/commands/index.ts:31` |
| MCP 服务器 | `src/mcp/server.ts:17` |
