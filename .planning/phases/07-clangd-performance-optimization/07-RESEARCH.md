# Phase 7: clangd 性能优化 - Research

**Researched:** 2026-07-04
**Domain:** clangd LSP integration performance — large UE C++ projects (>5000 files)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (D-01 ~ D-18, MUST honor verbatim)

#### 性能瓶颈识别与度量
- **D-01:** 性能度量采用「先插桩后 benchmark」双轨方案，先实现阶段用插桩定位热点，同一代码路径后期补充独立 benchmark 脚本产出基线数字
- **D-02:** 插桩数据双载体：实时输出到 Output 面板（前缀 `[perf]`）+ 持久化到 `.vscode/clangd-perf-cache/perf-log.json`
- **D-03:** 插桩粒度：入口（4 个外部命令入口）+ UBT 调用细化阶段（UBT 调用、preparse 文件 IO、缓存查询点）
- **D-04:** 性能可视化用状态栏三段：`[Clangd: 🟢 3.2s]`（生成耗时）+ `[PI cache: 82%]`（命中率）+ `[Incr: 120ms]`（增量扫描延迟）
- **D-05:** 阈值三色可视化：以 Phase 7 成功标准设定阈值（<5s 绿、<10s 黄、>10s 红），状态栏以图标/色块区分
- **D-06:** 新增 `vscodeUEHelper.showPerfInStatusBar` setting 控扭，用户可手动关闭状态栏性能项
- **D-07:** `perf-log.json` 模式自适应：开发模式（`vscode` 调试 / `extensionMode === Development`）保留轮转压缩归档（100MB / 7 天 / 5 文件）；打包后（生产模式）仅 session 内存，不持久化

#### compile_commands.json 生成
- **D-08:** 生成策略 = 增量修复路径：本地有缓存且指纹命中时跳过 UBT，直接复用历史 compile_commands.json
- **D-09:** 增量指纹依据 = 内容哈希指纹（`.uproject` + `*.Build.cs` + `Target.cs` 的 SHA256 拼接）
- **D-10:** Phase 7 拆分 2 个 PLAN：
  - **PLAN A** = 内容哈希指纹 + 增量缓存层（不含 UBT 并发）
  - **PLAN B** = UBT 调用细化阶段插桩 + 与 LSP proxy 协同优化（按需启动并发合并）

#### preparse-includes 缓存
- **D-11:** 先调研 `src/clangd/completionFiles.ts` 与 `src/clangd/preparseIncludes.ts` 已存在的缓存机制，避免重复设计；调研结论作为 PLAN A 前置依赖
- **D-12:** 缓存策略 = UE 头指纹缓存 + 动态识别热路径 + 与 clangd 共享 `.cache` 目录
- **D-13:** 缓存粒度 = 按需增量：按「头文件路径 + mtime/content hash」填充，避免一次缓存 2000+ 头
- **D-14:** 缓存存储位置 = `.vscode/clangd-perf-cache/`（项目本地，由 `.gitignore` 排除）

#### 增量扫描机制
- **D-15:** 实现路径由 agent 决定，建议优先级：VS Code `FileSystemWatcher` + debounced 批处理（100ms）为基础，与 `clangd didChangeWatchedFiles` LSP 联动（去重）
- **D-16:** 扫描粒度 = 头文件为主（`.h`/`.hpp`/`.inl`，高优先级触发重算）+ 源文件次优先
- **D-17:** 增量扫描延迟 < 200ms 的验证方式 = 单元测试（事件触发延迟）+ 集成测试（`onDidChange` 到完成耗时）+ 状态栏三段指标实时可视

#### 阶段验证
- **D-18:** 三层验证 = 单元测试（指纹计算 + 缓存命中逻辑）+ 集成测试（模拟激活流和文件变更事件）+ 手动测试（>5000 文件项目验证 < 5s / >80% / < 200ms 三个阈值）

### the agent's Discretion
- 增量扫描具体的 watcher/debounce 策略与 LSP 联动方式（D-15 仅给优先级，不锁实现）
- 与 clangd 共享 `.cache` 目录的具体协议（D-12，仅描述意图）
- 状态栏按钮点击的交互行为（跳转到 Output 面板或展开详细悬停 — agent 决定）

### Deferred Ideas (OUT OF SCOPE)
- 诊断增强（Phase 10 主题）：UE 编译错误 code action、Module 依赖建议
- 代码理解增强（Phase 8）：类型补全、跳转定义穿透
- 工具链集成（Phase 9）：UE 编辑器双向通信、Hot Reload 联动
- 状态栏性能数据的曲线趋势面板：未来在控制面板的 Status Tab 追加，不在 Phase 7
- 集成 XCode/MSVC 流式性能上报：跨平台测试打通不属本阶段
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CLANGD-01-01 | compile_commands.json 生成时间在大型 UE 工程（>5000 文件）< 5s | D-08/D-09 指纹缓存；§Feature 1 compile_commands 加速方案 |
| CLANGD-01-02 | preparse-includes 缓存命中率 > 80%（二次构建） | D-11/D-12/D-13 preparse 缓存策略；§Feature 2 preparse 缓存调研 |
| CLANGD-01-03 | 文件变更后增量扫描延迟 < 200ms | D-15/D-16/D-17 增量扫描机制；§Feature 3 增量扫描实现 |
| CLANGD-01-04 | vscode-clangd 与自研 LSP Proxy 协同不引入额外开销 | D-10 PLAN B；§Feature 4 Proxy 协同开销零保证 |

**关键交叉约束**：CLANGD-01-04 是「不引入」类约束（非功能要求），需在 PLAN B 通过测量验证，而非功能新增。
</phase_requirements>

## Summary

Phase 7 核心挑战是在不重写任何上游模块的前提下，给现有 `src/clangd/` 三件套（compileCommands / completionFiles / preparseIncludes）加上一层**纯增量**的缓存与度量层。具体三条主线：(1) compile_commands.json 的「指纹快路径」——基于 `.uproject + Build.cs + Target.cs` 的 SHA256 拼接指纹比对，命中时跳过 UBT 调用；(2) preparse-includes 的「运行时命中率度量 + 共享缓存协议」——通过新写 `src/clangd/perfLog.ts` 双载体输出（Output `[perf]` + `perf-log.json`），把现有 preparseIncludes.ts 的零散 hit/miss 状态聚合成三色阈值指标；(3) 增量扫描「chokidar + 100ms debounce + 触发状态栏延迟上报」——这是 D-15 留给 agent 自由决定的部分，详见 §Architecture 推荐。CLANGD-01-04 协同零开销通过**复用 proxy 既有的 LSP 帧通道**保证：增量事件不直接打扰 clangd，仅在我们自己的状态栏/缓存层闭环。

**Primary recommendation:** 严格按 D-10 拆分为 PLAN A（指纹 + 缓存层 + 性能面板）与 PLAN B（UBT 调用细化插桩 + Proxy 协同验证）两个交付单元；PLAN A 必须先产出 perf 数据，PLAN B 才能依据真实热点决定是否需要 UBT 并发合并。

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| compile_commands.json 指纹缓存 | Extension Node.js（`src/clangd/`） | — | 纯本地文件 IO + SHA256，延迟敏感，UBT 启动数秒级 |
| preparse 命中度量 | Extension Node.js（`src/clangd/perfLog.ts`） | — | 与 preparseIncludes.ts 同进程聚合，零跨进程开销 |
| 状态栏三段指标 | VS Code UI 层（`src/ui/statusBar.ts` 扩展） | Extension Node.js（订阅 perf 事件） | 状态栏是 VS Code API，必须在主线程创建 |
| 增量文件扫描 | VS Code Extension Host（`src/clangd/fileWatcher.ts`） | clangd LSP（被动接收 FileWatcher） | VS Code `FileSystemWatcher` 已在 Extension Host；不直接驱动 clangd |
| UBT 调用 | 子进程（`Engine/Build/BatchFiles/RunUBT.bat`） | Extension Node.js 包裹 | UBT 是独立进程，无法在 VS Code 内合并 |
| LSP Proxy 协同 | 子进程（`out/clangdProxy.js`） | clangd 子进程 | 双子进程架构；增量事件作为普通 LSP 帧直接透传 |
| `.vscode/clangd-perf-cache/` 持久化 | 文件系统（项目本地） | — | 跨 session 持久，且由 `.gitignore` 排除 |

## Stack Analysis

### 现有代码 review（src/clangd/ 当前状态）

| 文件 | 行数 | 关键能力 | Phase 7 切入点 |
|---|---|---|---|
| `compileCommands.ts` | 817 | `generateCompileCommands(opts)` 走 `vscode.tasks.executeTask` 调 UBT；`fillMissingCompileCommands` 已存在 | **D-08/D-09 指纹快路径叠加在 `generateCompileCommands` 入口前**；不在 UBT 调用内部并发改动 |
| `completionFiles.ts` | 635 | curated header + MANAGED/USER 区域；`createCompletionFiles()` 创建 6 个补全文件 | D-11 调研结论：现有结构已提供「用户保留区 + 自动托管区」——**正好可复用为热路径缓存分层** |
| `preparseIncludes.ts` | 120 | `loadBundledList` + `mergeUserCustomizations` + `resolvePreparseHeaders` + `toIncludeFlags` | D-11/D-13：当前 preparse 列表来自打包 JSON（`resources/preparse-includes/ue5-*.json`），**没有运行时 hit/miss 计数**——这是 perfLog 模块要补的能力 |
| `clangdConfig.ts` | 286 | 写 `.clangd` YAML；`replaceSystemIncludeBlock` 是 namespace 隔离的；D-12 共享 `.cache` 目录通过 `Index.Background + --pch-storage` 配置注入 | D-12：在 `defaultClangdConfig` 中追加 `Index.Background: Build` 与可配置 PCH storage path |
| `proxyManager.ts` | 235 | 启用/禁用 LSP Proxy，写入 `clangd.path` 指 launcher；不影响消息通道 | **不需要改**：PLAN B 验证零开销只通过测量 |
| `proxy/cli.ts / bridge.ts / processBridge.ts / keepalive.ts / localization.ts` | — | 双子进程 LSP 桥；didClose keepalive 默认 20 个文档 | **不需要改**：PLAN B 仅插入测量点 |

### 现有依赖（package.json dependencies）

| Library | Version | 用途 | Phase 7 复用方式 |
|---|---|---|---|
| `chokidar` | ^3.6.0 | 文件监听 | **可复用**（已在 INTEGRATIONS.md §12 中列出用于 `.uproject/.code-workspace/.clangd` 监听），Phase 7 增量扫描统一改用 chokidar 以统一监听语义 |
| `execa` | ^8.0.1 | 子进程 | **不需要新用**：UBT 已通过 vscode.tasks.executeTask 调用 |
| `yaml` | ^2.9.0 | YAML 序列化 | **复用**（D-12 注入 `.clangd` 的 Index 配置） |
| `json5` | ^2.2.3 | JSON5 解析（UE `.uproject`） | **复用**（D-09 指纹读取 `.uproject`） |
| `neverthrow` | ^6.1.0 | Result 类型 | **不直接用**：本阶段代码风格遵循现有 `try/catch + Logger.error` 模式 |
| `xstate` | ^5.9.0 | 状态机 | **不需要用**：perf 状态机太重，简单的数值缓存即可 |
| `@modelcontextprotocol/sdk` | ^1.0.0 | MCP 协议 | **不动** |

**关键结论：本阶段不需要新增任何 npm 依赖**。SHA256 用 `node:crypto.createHash`（Node 内置），debounce 用 `setTimeout`/`clearTimeout`，文件监听用现有 `chokidar` 或 VS Code `FileSystemWatcher`。

### Standard Stack（Phase 7 推荐）

| 层 | 工具/库 | 理由 |
|---|---|---|
| 内容哈希 | `node:crypto.createHash('sha256')` | Node 内置，零依赖；UE Build.cs 通常 < 50KB，全量读可接受 |
| 文件监听 | `chokidar` ^3.6.0 | 项目已有依赖；chokidar 的 `awaitWriteFinish` 内置防抖，省去手写 debounce |
| 持久化 | `node:fs/promises` + JSON Lines | 项目内已有大量 `fs/promises` 用法；JSONL 追加模式简化轮转 |
| 状态栏 | `vscode.window.createStatusBarItem` | 项目已有 11 个 + CompletionModeController 1 个同模式实现 |
| 路径处理 | `node:path` | 项目统一使用 |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|---|---|---|
| chokidar | VS Code `workspace.createFileSystemWatcher` | VS Code watcher 在大量事件下需要 debounce；chokidar `awaitWriteFinish` 一行解决 |
| SHA256 | MD5 / xxHash | MD5 碰撞风险 + 不被社区推荐；xxHash 需要 native binding，违背「零新依赖」原则 |
| 全文件读取 | 流式 hash + 大文件阈值 | UE Build.cs 平均 < 50KB，单文件 < 200KB；流式复杂度不抵收益，**简单全量读** 即可 |
| 自建轮转压缩归档 | `pino` / `winston` 日志库 | 用户已在 D-07 明确「轻量自写」——100MB / 7 天 / 5 文件策略简单到 30 行 TypeScript 足够 |
| LSP `didChangeWatchedFiles` 透传 | 触发 `clangd._reload` 指令 | 见 §Feature 3 推荐方案：**优先用 chokidar 监听 + 向状态栏写延迟，不主动打扰 clangd**——clangd 自己的 FileSystemWatcher 已经在工作 |

## Feature Approach

### Feature 1 — compile_commands.json 生成 < 5s（CLANGD-01-01）

**当前基线（理论估算）：**
- `compileCommands.ts:generateCompileCommands()` 主链路耗时 = `getUbtPath (~50ms) + buildNonNativeArgs (~200ms 含目录扫描) + executeShellTask (UBT 子进程 **5-30s**) + 文件查找 (~10ms) + linkToWorkspaceRoot (copy/symlink ~50ms)`
- UBT 调用是绝对瓶颈（占 90%+ 时间）

**PLAN A 推荐方案（D-08/D-09 落地）：**

1. **指纹计算模块 `src/clangd/fingerprint.ts`（新文件）**
   - 输入：项目根目录绝对路径
   - 收集文件：`<projectDir>/<name>.uproject` + `<projectDir>/Source/**/*.Build.cs` + `<projectDir>/Source/*.Target.cs`
   - 算法：按路径字典序排序后 `createHash('sha256').update(<filepath> + '\0' + <content> + '\0').digest('hex')`
   - 输出：`{ fingerprint: string, files: { path, mtime, size }[], computedAt: ISOString }`
   - 单测要点：相同文件不同 mtime 但相同内容 → 同 fingerprint；Build.cs 注释改动 → 改 fingerprint；空 Source/ 目录 → 返回稳定空 fingerprint（不抛错）

2. **缓存层 `src/clangd/compileCommandsCache.ts`（新文件）**
   - 缓存文件路径：`.vscode/clangd-perf-cache/compile-commands-cache.json`
   - 数据结构：
     ```typescript
     interface CachedCompileCommands {
       fingerprint: string;       // 匹配用
       ccPath: string;            // compile_commands.json 实际位置
       linkTarget: string;        // symlink/copy 目标
       savedAt: string;           // ISO 时间
       fileCount: number;         // 缓存的条目数（健康度）
     }
     ```
   - 接口：
     ```typescript
     class CompileCommandsCache {
       static cachePath(projectDir: string): string;
       async tryRead(projectDir: string): Promise<CachedCompileCommands | undefined>;
       async write(projectDir: string, entry: CachedCompileCommands): Promise<void>;
       async invalidate(projectDir: string, reason: string): Promise<void>;
     }
     ```
   - `tryRead` 流程：读 cache JSON → 检查 ccPath 是否存在 + 非空 → 返回
   - `invalidate` 在三种情况触发：(a) 指纹不匹配；(b) cached JSON 文件被外部删除；(c) 用户显式重置（命令预留）

3. **叠加到 `compileCommands.ts:generateCompileCommands()` 入口（最小侵入）**
   ```typescript
   // 新增 import
   import { computeFingerprint } from './fingerprint';
   import { CompileCommandsCache } from './compileCommandsCache';
   import { perfLog } from './perfLog';

   // 在 generateCompileCommands() 内, optsSignal 赋值之后立即插入（不改 UBT 调用内部）:
   const fpStart = performance.now();
   const fingerprint = await computeFingerprint(projectDir);
   const cache = new CompileCommandsCache();
   const cached = await cache.tryRead(projectDir);
   const fpMs = performance.now() - fpStart;

   if (cached && cached.fingerprint === fingerprint.fingerprint) {
     const ccStillExists = await fs.access(cached.ccPath).then(() => true).catch(() => false);
     if (ccStillExists) {
       perfLog.record({ event: 'compileCommands.cacheHit', elapsedMs: fpMs });
       log.info(`[perf] compileCommands cache HIT, skip UBT (fp ${fpMs.toFixed(1)}ms)`);
       return cached.ccPath;
     }
   }
   perfLog.record({ event: 'compileCommands.cacheMiss', elapsedMs: fpMs });
   log.info(`[perf] compileCommands cache MISS, running UBT (fp ${fpMs.toFixed(1)}ms)`);

   // ...existing UBT execution stays unchanged...
   await executeShellTask(ubtRelPath, args, opts.engineRoot, log, taskEnv);

   // 写入缓存
   await cache.write(projectDir, {
     fingerprint: fingerprint.fingerprint,
     ccPath: resultPath,
     linkTarget: ...,
     savedAt: new Date().toISOString(),
     fileCount: ...,
   });
   ```

**关键预期收益：**
- 二次激活项目：UBT 调用完全跳过，从 5-30s 降至 < 100ms（指纹计算 + cache 读取）
- Build.cs 改动后首次：指纹 miss → 走 UBT；二次立即命中
- `.uproject` 模块结构改动：指纹 miss → 走 UBT；二次立即命中

### Feature 2 — preparse-includes 缓存命中率 > 80%（CLANGD-01-02）

**D-11 调研结论（重要前置）：**

| 现有 preparse 行为 | 来源 | 缺失的能力 |
|---|---|---|
| fast 模式加载 5 个 SharedPCH 头 | `resources/preparse-includes/ue5-fast.json` | 没有运行时统计 hit/miss |
| slow 模式加载同 5 个 SharedPCH + addMacroCompletions.h | `ue5-slow.json` + `getAddMacroCompletionsContent()` | 同上 |
| 用户 `.vscode/vscodeuehelper/*.h` 追加 | `mergeUserCustomizations` | 无去重/无版本识别 |
| $(EngineRoot) 占位符运行时替换 | `resolvePreparseHeaders` | 无引擎版本变更检测 |

**结论：preparse 的「内容/版本」缓存是空白的，但 hit/miss 统计点天然存在**——`completionFiles.ts:createCompletionFiles()` 和 `preparseIncludes.ts:getPrepareIncludesList()` 两条调用入口就是完美的 instrument 点。

**PLAN A 推荐方案（D-11/D-12/D-13 落地）：**

1. **在 `preparseIncludes.ts` 增加纯函数埋点（不破坏现有签名）**
   ```typescript
   // 新增内部函数, 不影响 export 签名
   let preparseStats = { hit: 0, miss: 0, lastReset: Date.now() };

   export async function getPrepareIncludesList(
     mode: CompletionMode,
     projectPath: string,
     options?: { engineRoot?: string; perfSession?: PerfSession },
   ): Promise<string[]> {
     // ...existing logic...
     // 在返回前调用 perfLog.record
     const session = options?.perfSession;
     if (session) session.recordPreparseResult(mode, baseList.length, mergedList.length - baseList.length);
     return mergedList;
   }

   // 新增导出
   export function getPreparseStats(): { hit: number; miss: number; hitRate: number } {
     const total = preparseStats.hit + preparseStats.miss;
     return { ...preparseStats, hitRate: total === 0 ? 0 : preparseStats.hit / total };
   }

   export function resetPreparseStats(): void {
     preparseStats = { hit: 0, miss: 0, lastReset: Date.now() };
   }
   ```

2. **缓存策略（D-12 UE 头指纹缓存）**

   - **位置** (D-14)：`.vscode/clangd-perf-cache/headers/<ueVersion>/<headerName>.sha256`
   - **粒度** (D-13)：按 `header path + mtime` 一一对应；二次构建时只重哈希 mtime 变化的 header
   - **共享协议** (D-12)：在 `clangdConfig.ts:defaultClangdConfig()` 中追加 `Index.Background: Build` + 注释说明 `.cache/clangd` 由 clangd 自动维护；perf-cache 目录与 clangd `.cache` 目录**平级但隔离**（互不污染）

3. **关键模块位置**
   - `src/clangd/perfLog.ts`（新文件）— 统一埋点 API + 状态聚合
   - `src/clangd/headerCache.ts`（新文件）— UE 头 mtime 缓存层
   - `src/clangd/preparseIncludes.ts`（修改）— 增加埋点 + 新参数 `perfSession?`

4. **埋点 API 草案（`src/clangd/perfLog.ts`）**
   ```typescript
   export interface PerfEvent {
     event: string;             // 例如 'compileCommands.cacheHit', 'preparse.listBuilt'
     elapsedMs: number;
     timestamp: string;
     meta?: Record<string, unknown>;
   }

   export interface PerfSession {
     record(ev: Omit<PerfEvent, 'timestamp'>): void;
     // 聚合方法
     getCompileCommandsElapsed(): number;  // 最近一次生成耗时
     getPreparseHitRate(): number;        // 最近 5 分钟 hit 率
     getIncrementalScanLatency(): number;  // 最近一次增量扫描延迟
   }

   export const perfLog: PerfSession;     // 全局单例
   ```

### Feature 3 — 文件变更后增量扫描 < 200ms（CLANGD-01-03）

**D-15 agent 推荐方案：**

> **核心结论：不发送 LSP `workspace/didChangeWatchedFiles`，改用「chokidar + 100ms debounce + 状态栏延迟上报」最小可行方案。**

**理由（D-15 优先级分析）：**

| 候选方案 | 延迟开销 | 与代理协同风险 | 推荐 |
|---|---|---|---|
| VS Code `FileSystemWatcher` + 手写 debounce | < 100ms（debounce 内） | 0 | ⚠️ 需手写 30+ 行 debounce |
| chokidar `awaitWriteFinish` + 自定义 onChange | < 100ms（内置 debounce） | 0 | ✅ **推荐**（项目已有依赖） |
| 主动发送 LSP `workspace/didChangeWatchedFiles` | +5-20ms 序列化 + 透传延迟 | **+风险**：需在 proxy 路径上确认通道 | ❌ 不必要——clangd 自身 FileSystemWatcher 已在工作 |
| 触发 `clangd._reload` 指令 | 100-500ms（clangd 重建索引） | +风险 | ❌ 杀鸡用牛刀 |

**实施方案：**

1. **新增模块 `src/clangd/fileWatcher.ts`**
   ```typescript
   import chokidar, { FSWatcher } from 'chokidar';
   import { perfLog } from './perfLog';
   import { Logger } from '@core/logger';

   export interface FileWatcherOptions {
     /** chokidar glob pattern list, 限定到 UE 源码根目录 */
     patterns: string[];
     /** debounce 窗口（毫秒），D-15 推荐 100ms */
     debounceMs?: number;
     /** 头文件优先（D-16） */
     headerPriority?: boolean;
   }

   export class IncrementalFileWatcher {
       private watcher: FSWatcher | null = null;

       start(options: FileWatcherOptions): vscode.Disposable {
         const startMs = performance.now();
         const watcher = chokidar.watch(options.patterns, {
           ignored: ['**/Intermediate/**', '**/Binaries/**', '**/DerivedDataCache/**', '**/Saved/**', '**/.git/**'],
           ignoreInitial: true,
           awaitWriteFinish: { stabilityThreshold: options.debounceMs ?? 100, pollInterval: 50 },
         });

         let batchedChanges: string[] = [];
         let debounceTimer: NodeJS.Timeout | null = null;

         const flush = () => {
           if (batchedChanges.length === 0) return;
           const elapsed = performance.now() - startMs;
           perfLog.recordIncrementalScan(elapsed, batchedChanges.length);
           this.onBatch?.(batchedChanges);
           batchedChanges = [];
         };

         const handler = (filePath: string) => {
           batchedChanges.push(filePath);
           if (debounceTimer) clearTimeout(debounceTimer);
           debounceTimer = setTimeout(flush, options.debounceMs ?? 100);
         };

         watcher.on('add', handler).on('change', handler).on('unlink', handler);
         this.watcher = watcher;
         return { dispose: () => { watcher.close(); } };
       }
   }
   ```

2. **激活点**（`src/clangd/index.ts:activateClangd`）
   ```typescript
   // 在 detection.ready 完成后启动增量扫描
   void detection.ready.then((result) => {
     const project = result.projects[0];
     if (project?.path) {
       const projectDir = path.dirname(project.path);
       const watcher = new IncrementalFileWatcher();
       const handle = watcher.start({
         patterns: [
           path.join(projectDir, 'Source', '**/*.{h,hpp,inl,cpp}'),
           path.join(projectDir, 'Plugins', '**', 'Source', '**/*.{h,hpp,inl,cpp}'),
         ],
         debounceMs: 100,
         headerPriority: true,  // D-16
       });
       context.subscriptions.push(handle);
     }
   });
   ```

3. **扫描粒度 (D-16)**：
   - chokidar 接收所有 `.h/.hpp/.inl/.cpp` 变化
   - 但埋点时按文件扩展名分级：
     - 头文件 → 标记为 highPriority（触发更频繁的状态栏更新）
     - 源文件 → 标记为 normalPriority
   - 状态栏 `[Incr: 120ms]` 显示的是**所有变化合并后的总处理耗时**，不是单文件

### Feature 4 — Proxy 协同零开销（CLANGD-01-04）

**「不引入额外开销」的内涵：**
- 增量扫描事件**不通过 proxy**——直接走 chokidar 在 Extension Host 内
- perf-log 写入**不通过 proxy**——走 `node:fs/promises`
- compile_commands 缓存读取**不通过 proxy**——本地 JSON 文件
- 状态栏更新**不通过 proxy**——VS Code API 直接调用

**唯一的 proxy 相关路径：** 用户的 clangd LSP 请求照常经 proxy 转发（这与 Phase 7 之前完全一致）。proxy 代码（`src/clangd/proxy/`）**完全不需要改动**。

**PLAN B 验证手段（PLAN B 是「测量验证」任务，不是新功能）：**

1. 在 PLAN B 启动时记录基线：
   - proxy 子进程 CPU/内存（`process.resourceUsage()`）
   - 单条 LSP `textDocument/definition` 请求延迟
   - 100 次连续 `textDocument/completion` P95 延迟
2. 注入 PLAN A 的新代码（指纹 / 缓存 / 增量扫描）后，重跑同一组基线，对比偏差 < 1% 即认为「零开销」达成
3. 测量代码放在 `src/clangd/perfProxy.ts`（新文件），仅做测量不修改 proxy 行为

## Architecture Recommendation

### 模块结构（新增文件 + 修改文件清单）

```
src/clangd/
├── compileCommands.ts          [修改: 入口处叠加指纹检查]
├── completionFiles.ts          [不动: D-11 调研结论为现有结构已足够]
├── preparseIncludes.ts         [修改: 增加 perfSession 可选参数 + 导出 getPreparseStats]
├── clangdConfig.ts             [修改: D-12 追加 Index.Background 与 pch-storage 注释]
├── index.ts                    [修改: 注入 IncrementalFileWatcher 与 perfLog 启动]
├── proxyManager.ts             [不动]
├── proxy/                      [不动: PLAN B 仅测量]
├── types.ts                    [修改: 增加 PerfSession / CachedCompileCommands 类型]
│
├── fingerprint.ts              [新增: SHA256 内容指纹计算]
├── compileCommandsCache.ts     [新增: compile_commands.json 增量缓存层]
├── headerCache.ts              [新增: UE 头 mtime 指纹缓存]
├── perfLog.ts                  [新增: 统一埋点 API + 状态聚合]
├── perfProxy.ts                [新增: PLAN B proxy 协同开销测量]
├── fileWatcher.ts              [新增: chokidar + debounce 增量扫描]

src/ui/statusBar.ts             [修改: 追加 3 个性能段 StatusBarItem]
src/core/config.ts              [修改: 增加 showPerfInStatusBar getter]
package.json                    [修改: contributes.configuration 增加 showPerfInStatusBar 设置]
src/i18n/locales/{en,zh}.json   [修改: 增加 8-12 条性能相关文案]
.gitignore                      [修改: 排除 .vscode/clangd-perf-cache/]

test/unit/clangd/
├── fingerprint.test.ts         [新增]
├── compileCommandsCache.test.ts [新增]
├── headerCache.test.ts         [新增]
├── perfLog.test.ts             [新增]
├── fileWatcher.test.ts         [新增]
└── compileCommands.test.ts     [修改: 增加 cache hit/miss 分支测试]
```

### 关键模块契约

#### `src/clangd/fingerprint.ts`

```typescript
/**
 * SHA256 内容指纹：拼接 .uproject + Build.cs + Target.cs 的内容哈希。
 * 文件顺序按路径字典序固定，保证相同输入产出相同哈希。
 */
export interface FingerprintResult {
  /** 64 字符 hex SHA256 */
  fingerprint: string;
  /** 参与计算的源文件清单（用于诊断） */
  files: { path: string; size: number; mtimeMs: number }[];
  /** 计算耗时（ms） */
  computedMs: number;
}

export async function computeFingerprint(projectDir: string): Promise<FingerprintResult>;

/** 仅基于 mtime+size 的「轻指纹」，用于决定是否需要重算 SHA256（避免大 Build.cs 反复读） */
export async function computeLightFingerprint(projectDir: string): Promise<string>;
```

#### `src/clangd/compileCommandsCache.ts`

```typescript
export interface CachedCompileCommands {
  fingerprint: string;
  ccPath: string;
  linkTarget: string;
  savedAt: string;
  fileCount: number;
}

export class CompileCommandsCache {
  static cachePath(projectDir: string): string;  // .vscode/clangd-perf-cache/compile-commands-cache.json
  async tryRead(projectDir: string): Promise<CachedCompileCommands | undefined>;
  async write(projectDir: string, entry: CachedCompileCommands): Promise<void>;
  async invalidate(projectDir: string, reason: string): Promise<void>;
}
```

#### `src/clangd/perfLog.ts`

```typescript
export interface PerfEvent {
  event: string;        // 'compileCommands.cacheHit' | 'preparse.listBuilt' | 'incremental.scanComplete' | ...
  elapsedMs: number;
  timestamp: string;    // ISO 8601
  meta?: Record<string, unknown>;
}

export interface PerfSession {
  record(ev: Omit<PerfEvent, 'timestamp'>): void;
  getCompileCommandsLastMs(): number;
  getPreparseHitRate(): { hits: number; misses: number; rate: number };
  getLastIncrementalScanMs(): number;
  flushToDisk(): Promise<void>;     // 模式自适应 (D-07): 仅 dev 模式写盘
}

export const perfLog: PerfSession;

/** 开发模式检测 (D-07) — extensionMode === Development */
export function isDevMode(): boolean;
```

#### `src/clangd/fileWatcher.ts`

```typescript
export interface FileWatcherOptions {
  patterns: string[];       // chokidar glob 列表
  debounceMs?: number;      // 默认 100ms (D-15)
  ignoredPatterns?: string[]; // 默认排除 Intermediate/Binaries/DerivedDataCache/Saved/.git
}

export interface IncrementalBatch {
  files: string[];
  /** 收到首个事件到 flush 的总耗时 */
  totalLatencyMs: number;
  /** 按头/源分组 */
  headerCount: number;
  sourceCount: number;
}

export class IncrementalFileWatcher {
  onBatch?: (batch: IncrementalBatch) => void;
  start(options: FileWatcherOptions): vscode.Disposable;
}
```

### 状态栏三段集成（src/ui/statusBar.ts）

**当前架构：** `StatusBarManager` 类聚合 11 个按钮；新增 3 个性能段建议**单独抽类**避免 StatusBarManager 膨胀：

```typescript
// src/ui/perfStatusBar.ts （新文件，复用现有模式）
export class PerfStatusBar {
  private clangdGenItem: vscode.StatusBarItem;
  private preparseCacheItem: vscode.StatusBarItem;
  private incrementalScanItem: vscode.StatusBarItem;

  constructor() {
    this.clangdGenItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
    this.preparseCacheItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 199);
    this.incrementalScanItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 198);
  }

  update(metrics: { genMs?: number; hitRate?: number; incrMs?: number }): void {
    // 1. compile_commands 生成耗时
    if (metrics.genMs !== undefined) {
      const { icon, color } = this.thresholdFor(metrics.genMs, 5000, 10000);  // D-05
      this.clangdGenItem.text = `${icon} Clangd: ${(metrics.genMs / 1000).toFixed(1)}s`;
      this.clangdGenItem.backgroundColor = color;
      this.clangdGenItem.tooltip = `compile_commands.json 生成耗时 ${metrics.genMs}ms`;
    }
    // 2. preparse 命中率
    if (metrics.hitRate !== undefined) {
      const pct = Math.round(metrics.hitRate * 100);
      const { icon, color } = this.thresholdFor(pct, 80, 60, true /* inverted */);  // D-05: 命中率越高越好
      this.preparseCacheItem.text = `${icon} PI cache: ${pct}%`;
      this.preparseCacheItem.backgroundColor = color;
    }
    // 3. 增量扫描
    if (metrics.incrMs !== undefined) {
      const { icon, color } = this.thresholdFor(metrics.incrMs, 100, 200);  // D-17: < 200ms 绿
      this.incrementalScanItem.text = `${icon} Incr: ${metrics.incrMs}ms`;
      this.incrementalScanItem.backgroundColor = color;
    }
  }

  private thresholdFor(value: number, greenThreshold: number, yellowThreshold: number, inverted = false):
      { icon: string; color: vscode.ThemeColor | undefined } {
    // inverted=true: 值越大越绿（如命中率）
    // inverted=false: 值越小越绿（如耗时）
    const isGreen = inverted ? value >= greenThreshold : value <= greenThreshold;
    const isYellow = inverted ? value >= yellowThreshold : value <= yellowThreshold;
    if (isGreen) return { icon: '🟢', color: undefined };
    if (isYellow) return { icon: '🟡', color: new vscode.ThemeColor('statusBarItem.warningBackground') };
    return { icon: '🔴', color: new vscode.ThemeColor('statusBarItem.errorBackground') };
  }

  show(): void { /* ... */ }
  hide(): void { /* ... */ }
  dispose(): void { /* ... */ }
}
```

**点击行为（agent 决定）：** 三段性能项点击时调用 `vscode.commands.executeCommand('workbench.action.output.showOutput', 'VSCodeUEHelper')` 并写入 `[perf]` 前缀日志，让用户能直接跳转 Output Channel 查看完整 perf-log。

### 激活流程集成（src/clangd/index.ts:activateClangd）

```typescript
export function activateClangd(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): ClangdHandles {
  // ... existing code ...

  // [Phase 7 新增] 性能面板（尊重 D-06 setting）
  if (config.showPerfInStatusBar) {
    const perfBar = new PerfStatusBar();
    context.subscriptions.push(perfBar);
    perfBar.show();

    // 订阅 perfLog 事件, 实时刷新
    context.subscriptions.push(perfLog.onMetricUpdate((metrics) => perfBar.update(metrics)));
  }

  // [Phase 7 新增] 增量扫描 (D-15/D-16) — 在 detection.ready 后启动
  void detection.ready.then((result) => {
    const project = result.projects[0];
    if (!project?.path) return;
    const projectDir = path.dirname(project.path);
    const watcher = new IncrementalFileWatcher();
    watcher.onBatch = (batch) => {
      perfLog.record({
        event: 'incremental.scanComplete',
        elapsedMs: batch.totalLatencyMs,
        meta: { headerCount: batch.headerCount, sourceCount: batch.sourceCount },
      });
    };
    const handle = watcher.start({
      patterns: [
        path.join(projectDir, 'Source', '**', '*.{h,hpp,inl,cpp}'),
        path.join(projectDir, 'Plugins', '**', 'Source', '**', '*.{h,hpp,inl,cpp}'),
      ],
      debounceMs: 100,  // D-15
    });
    context.subscriptions.push(handle);
  });

  // ... existing returns ...
  return { completionMode, backup, proxyManager };
}
```

### Activation Order 影响

**当前顺序**（AGENTS.md）：
```
1. initI18n
2. Logger + Config
3. activateDetection
4. activateBuild
5. activateClangd  ← Phase 7 修改点
6. activateUI
7. activateCommands
```

**Phase 7 不需要改变激活顺序**——所有 perf 模块都在 `activateClangd` 内部，`detection.ready` 已 await 过。

### 数据流图

```
用户触发命令 ─→ activateCommands → compileCommands.ts:generateCompileCommands
                                              │
                                              ├─→ [Phase 7] fingerprint.ts:computeFingerprint (~50-200ms)
                                              │      └─→ .uproject + Build.cs + Target.cs SHA256
                                              ├─→ [Phase 7] compileCommandsCache.ts:tryRead (~10ms)
                                              │      └─→ 命中 → 直接 return cached.ccPath
                                              │      └─→ miss → 继续
                                              ├─→ executeShellTask (UBT) ~5-30s
                                              ├─→ [Phase 7] cache.write (~10ms)
                                              └─→ 返回结果

文件变更 ─→ chokidar watcher (fileWatcher.ts)
                  │
                  ├─→ debounce 100ms
                  ├─→ flush batch
                  └─→ perfLog.recordIncrementalScan (~几 ms)

preparse 调用 ─→ preparseIncludes.ts:getPrepareIncludesList
                  │
                  └─→ perfSession.recordPreparseResult (~0 overhead)
```

## Don't Hand-Roll

| 问题 | 不要自己造 | 用什么 | 为什么 |
|---|---|---|---|
| SHA256 哈希 | 自己写哈希算法 | `node:crypto.createHash('sha256')` | Node 内置，FIPS 合规，零依赖 |
| 文件监听 + 防抖 | 手写 debounce + chokidar 替代品 | `chokidar` v3 + `awaitWriteFinish` | chokidar 内置写入完成检测，省 30 行 debounce 代码 |
| 日志时间戳 | 手写 Date format | `new Date().toISOString().slice(11, 23)` | 复用项目 `Logger.format` 已用模式 |
| JSON 序列化 | 手写 stringify | `JSON.stringify` / `JSON.parse` | UE compile_commands.json 不大（< 5MB），流式复杂度不抵收益 |
| 状态栏三色 | 自己枚举 ThemeColor | `vscode.ThemeColor('statusBarItem.warningBackground')` 等 | VS Code 标准 token，自动适配主题 |
| 路径处理 | 手写路径拼接 | `node:path.join` / `node:path.dirname` | 项目统一 `path` 别名 |

**关键洞察**：Phase 7 没有「自造轮子」的诱惑——所有需要的能力（哈希 / 监听 / 序列化 / 状态栏）都已有成熟方案。**唯一手写的代码**：perfLog 的聚合逻辑、状态栏三段的阈值判定（thresholdFor 函数，~15 行）。

## Implementation Considerations

### UE 特定陷阱

#### 陷阱 1: .uproject 引擎版本切换

**场景**：用户在同一份代码上有两个引擎（UE 5.3 + UE 5.4），`.uproject` 里 `EngineAssociation` 字段会改。

**影响**：fingerprint 计算会变更 → cache miss → 重新跑 UBT。这是**正确**的行为：引擎版本变了，compile_commands.json 也确实需要重生成。

**防御**：cache 写入时同时保存 `engineVersion`（从 `.uproject` 解析），命中时 sanity check。

#### 陷阱 2: Live Coding 后的状态

**场景**：用户跑了 Live Coding，UE 编辑器生成了一些 `.generated.h` 文件到 Intermediate/Build/...

**影响**：如果扫描 glob 把 Intermediate/ 包含进去，会扫到成千上万个临时文件 → chokidar 启动慢。

**防御**：`ignored` 数组强制排除 `**/Intermediate/**`、`**/Binaries/**`、`**/DerivedDataCache/**`、`**/Saved/**`、`**/.git/**`。

#### 陷阱 3: Hot Reload 改 .Build.cs

**场景**：用户频繁修改 `Source/MyModule/MyModule.Build.cs`（UE 开发常见操作），每次保存都希望 clangd 立刻重编译。

**影响**：
- fingerprint miss → UBT 重跑（正确行为，但慢）
- chokidar 收到 .Build.cs change 事件 → debounce 100ms → 状态栏更新

**防御**：状态栏 `[Incr: 120ms]` 显示的是**接收事件到处理完成**的延迟，与 UBT 调用耗时分离。用户在状态栏上看到的是「检测到变化并更新 UI 的延迟」（< 200ms），与 UBT 重生成 compile_commands 的耗时（5-30s）无关。

#### 陷阱 4: 大型 .generated.h 文件

**场景**：UE 的 UHT 在 Intermediate/Build/.../Inc/ 下生成 2000+ 个 `.generated.h`，每个 5-50KB。

**影响**：fingerprint 计算只关心 `.uproject + Build.cs + Target.cs`，**不关心** `.generated.h` —— 这是正确设计，因为 UHT 重新生成后 UBT 才会调，所以 fingerprint 没变 = UBT 也不需要调。

**防御**：fingerprint glob 严格限定到 `*.uproject` + `*.Build.cs` + `*.Target.cs`，绝不扩展到 `Intermediate/**`。

#### 陷阱 5: 头文件位置不可枚举

**场景**：UE 的头文件散落在 `Source/` `Plugins/` `Engine/Source/` 三处。

**影响**：preparse 缓存如果只索引 `Source/`，会漏掉 `Engine/Source/Runtime/Core/Public/CoreSharedPCH.h`（即 fast 模式的核心 SharedPCH）。

**防御**：`headerCache.ts` 接受 `engineRoot` 作为参数，对引擎自带 SharedPCH 单独建索引 `headers/<ueVersion>/Engine/...`。

#### 陷阱 6: chokidar 在 Windows 上的句柄泄漏

**场景**：大型项目（5000+ 文件）chokidar 启动时会为每个目录建立 watcher。

**影响**：Windows 默认单进程句柄上限较低（512 个），5000 个目录可能在某些机器上失败。

**防御**：chokidar v3 已内置 `usePolling: false`（推荐）；如必须轮询则降级到 `usePolling: true, interval: 1000`。本阶段使用默认模式，遇到问题再切换。

#### 陷阱 7: i18n 字符串覆盖

**场景**：用户在 zh 区域工作，状态栏的 `[Clangd: 🟢 3.2s]` 文案硬编码英文。

**影响**：体验不一致。

**防御**：`src/i18n/locales/zh.json` + `en.json` 新增以下 key：
- `perf.clangdGen.tooltip` → "compile_commands.json 生成耗时 {ms}ms / Generated in {ms}ms"
- `perf.preparseCache.tooltip` → "preparse-includes 缓存命中率 {pct}% / Hit rate: {pct}%"
- `perf.incrementalScan.tooltip` → "增量扫描延迟 {ms}ms / Incremental scan: {ms}ms"
- `perf.cacheHit` → "缓存命中，跳过 UBT / Cache hit, skip UBT"
- `perf.cacheMiss` → "缓存未命中，运行 UBT / Cache miss, running UBT"
- `perf.showInStatusBar` → "在状态栏显示性能指标 / Show performance metrics in status bar"

### 边缘情况

| 场景 | 行为 |
|---|---|
| 用户禁用了状态栏性能项（D-06 `showPerfInStatusBar: false`） | `PerfStatusBar` 不创建（不占 StatusBar 配额）；perfLog 仍记录但不更新 UI；Output 面板照常输出 |
| `.vscode/clangd-perf-cache/` 目录无法创建（权限问题） | `CompileCommandsCache.tryRead` 返回 undefined（= cache miss），回退到原始 UBT 路径；perfLog.warn 一次性 |
| chokidar 启动失败（5000+ 文件机器） | `IncrementalFileWatcher.start()` 抛错被 `activateClangd` 的 try/catch 捕获，状态栏 `[Incr: ERR]` 红块显示 |
| 用户切换工程（多 .uproject 工作区） | `compileCommandsCache.tryRead(projectDir)` 用 projectDir 作为 key，自动隔离 |
| 用户从开发模式（`extensionMode === Development`）切到打包后 | D-07：`perfLog.flushToDisk()` 在打包模式下变 no-op，历史 perf-log.json 自然停止增长 |
| 用户重置（删除 `.vscode/clangd-perf-cache/`） | 下次 `tryRead` 返回 undefined → cache miss → 走 UBT → 写新 cache |
| `perf-log.json` 单文件超过 100MB（D-07） | `flushToDisk` 触发轮转：rename 当前文件为 `perf-log.<timestamp>.jsonl.gz`，新建空文件，最多保留 5 个 |

## Common Pitfalls

### Pitfall 1: perfLog 写入阻塞主流程

**What goes wrong:** 在 `generateCompileCommands` 内部同步 `await perfLog.record(...)`，如果 `flushToDisk` 写 100MB JSON 会阻塞数秒。

**Why it happens:** D-02/D-07 要求持久化 `perf-log.json`，开发者容易直接 await 写盘。

**How to avoid:** `perfLog.record()` **同步入内存队列**（O(1)），后台 `setImmediate` / `setInterval` 异步批量 flush。`record` 调用永远 < 1ms。

**Warning signs:** 状态栏三段更新卡顿；UBT 调用比预期慢。

### Pitfall 2: cache 文件锁竞争

**What goes wrong:** 用户同时打开两个 VS Code 窗口（同一个 .code-workspace 多次 activate），两个 Extension Host 都写 `compile-commands-cache.json` → 写入覆盖。

**Why it happens:** `.vscode/clangd-perf-cache/` 是项目本地，多个 VS Code 实例可见。

**How to avoid:** 写入前用 `fs.open(path, 'wx')` 原子创建临时文件 + rename，VS Code 单实例通常不冲突；多实例场景下接受「最后写入获胜」（cache miss 比 data corruption 安全）。

### Pitfall 3: chokidar glob 误包引擎目录

**What goes wrong:** patterns 用了 `'Source/**/*.{h,hpp,inl,cpp}'` 但相对路径解析时包含了引擎自身的 `Engine/Source/`。

**Why it happens:** `path.join(projectDir, 'Source', '**')` 看似清晰，但 chokidar glob 在多 Workspace Folder 场景下可能匹配到 `Engine/Source/Runtime/...`。

**How to avoid:** 始终用 `path.join(projectDir, ...)` 限定项目内路径；测试中显式断言「监听到 Engine 目录事件时抛错或忽略」。

### Pitfall 4: 增量扫描误判延迟

**What goes wrong:** `[Incr: 120ms]` 显示的 120ms 是「事件 → flush」的 debounce 时间，但用户期望的是「事件 → clangd 看到更新」的总延迟。

**Why it happens:** chokidar 的 `awaitWriteFinish` 的 `stabilityThreshold` 控制「多久没新写入视为稳定」——D-15 推荐 100ms，但用户体感是「保存后多久看到智能提示更新」。

**How to avoid:** 状态栏 tooltip 明确写「`incremental scan latency: {ms}ms (chokidar debounce)`」让用户知道度量的是哪一段；clangd 自己的索引更新延迟不在 Phase 7 度量范围。

### Pitfall 5: 状态栏按钮位置冲突

**What goes wrong:** 新增 3 个性能 StatusBarItem 与现有 11 个按钮 + CompletionModeController 的 1 个按钮（共 15 个）超出 VS Code 状态栏可见宽度。

**Why it happens:** VS Code 状态栏自动截断超长内容。

**How to avoid:** 性能段放在 priority 198-200（位于 CompletionModeController priority=99 之上但低于现有 11 个按钮的 priority=291-300）；tooltip 提供完整信息。

### Pitfall 6: 测试环境 chokidar 真实启动

**What goes wrong:** vitest 单测里 `chokidar.watch` 真实启动，5000 个文件 fixture 导致测试 30s+ 超时。

**Why it happens:** 测试代码忘了 mock chokidar。

**How to avoid:** `test/unit/setup.ts` 增加 chokidar mock：
```typescript
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    })),
  },
}));
```

### Pitfall 7: SHA256 全量读取大 .uproject

**What goes wrong:** `.uproject` 可能被 UE 编辑器自动加几百行 metadata（Plugins 列表等），单文件 200KB+，全量读取 + SHA256 + 几百次（每 Build.cs）= 100ms+。

**Why it happens:** .uproject 在 UE 编辑器中频繁保存（每次打开都会触发 metadata 更新）。

**How to avoid:** 1) 轻指纹（mtime+size）先比对，不变则跳过 SHA256；2) .uproject 单独做 SHA256（Build.cs 文件多但每个小，批处理 + 流式 hash 即可）。

## Validation Architecture

> workflow.nyquist_validation = true（.planning/config.json）→ 必须包含本节

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 1.3.0 + 现有 test/unit/setup.ts |
| Config file | `vitest.config.ts`（已配置 80%/80%/75%/80% 覆盖率阈值） |
| Quick run command | `npm run test:unit -- fingerprint compileCommandsCache perfLog fileWatcher` |
| Full suite command | `npm run test:unit`（35 文件，498 tests 基线，需保持零回归） |

### Phase Requirements → Test Map

| Req ID | 行为 | Test Type | Automated Command | File Exists? |
|--------|------|-----------|-------------------|-------------|
| CLANGD-01-01.a | 指纹计算：相同输入 → 相同 fingerprint | unit | `npm run test:unit -- fingerprint.test.ts` | ❌ Wave 0 |
| CLANGD-01-01.b | 指纹计算：Build.cs 注释改动 → fingerprint 变化 | unit | `npm run test:unit -- fingerprint.test.ts` | ❌ Wave 0 |
| CLANGD-01-01.c | 缓存命中：二次调用直接返回 cached path | unit | `npm run test:unit -- compileCommandsCache.test.ts` | ❌ Wave 0 |
| CLANGD-01-01.d | 缓存失效：Build.cs 改动后 fingerprint 不匹配 | unit | `npm run test:unit -- compileCommandsCache.test.ts` | ❌ Wave 0 |
| CLANGD-01-02.a | preparse 命中率统计（hit/miss 计数） | unit | `npm run test:unit -- preparseIncludes.test.ts` | ✅ 已存在，需追加 |
| CLANGD-01-02.b | perfLog 状态聚合正确性 | unit | `npm run test:unit -- perfLog.test.ts` | ❌ Wave 0 |
| CLANGD-01-03.a | chokidar 收到事件 → debounce flush 耗时 < 200ms（fixture 内） | unit | `npm run test:unit -- fileWatcher.test.ts` | ❌ Wave 0 |
| CLANGD-01-03.b | 头文件 vs 源文件分级（headerPriority） | unit | `npm run test:unit -- fileWatcher.test.ts` | ❌ Wave 0 |
| CLANGD-01-04.a | perfProxy 测量脚本：基线 → 注入后 < 1% 偏差（需真代理） | integration (manual) | `node scripts/measure-proxy-overhead.mjs` | ❌ Wave 0 |
| D-18.a | 模式自适应：dev 模式 flushToDisk 写盘；prod 模式 no-op | unit | `npm run test:unit -- perfLog.test.ts` | ❌ Wave 0 |
| D-18.b | 轮转压缩：超过 100MB 触发归档 | unit | `npm run test:unit -- perfLog.test.ts` | ❌ Wave 0 |

### Sampling Rate

- **每个 task commit**：`npm run typecheck && npm run lint && npm run test:unit -- <新模块>`
- **每个 wave merge**：`npm run test:unit`（全 498 + 新增回归）
- **阶段 gate**：PLAN B 完成后 `/gsd-verify-work` 前全量 + 手动 >5000 文件验证

### Wave 0 Gaps

- [ ] `test/unit/clangd/fingerprint.test.ts` — 覆盖 CLANGD-01-01.a/b
- [ ] `test/unit/clangd/compileCommandsCache.test.ts` — 覆盖 CLANGD-01-01.c/d
- [ ] `test/unit/clangd/perfLog.test.ts` — 覆盖 CLANGD-01-02.b + D-18.a/b
- [ ] `test/unit/clangd/fileWatcher.test.ts` — 覆盖 CLANGD-01-03.a/b
- [ ] `test/unit/clangd/headerCache.test.ts` — 覆盖 D-13 缓存粒度
- [ ] `test/unit/setup.ts` — 追加 `vi.mock('chokidar')` 避免真实 watcher 启动
- [ ] `scripts/measure-proxy-overhead.mjs` — CLANGD-01-04.a 基线测量（手动运行）

### Layered Validation (D-18)

1. **单元测试层**（自动，PR gate）：
   - fingerprint.ts SHA256 边界（空项目、特殊字符路径、Windows 大小写）
   - compileCommandsCache.ts 命中/失效/写盘
   - perfLog.ts 内存聚合 + 模式自适应 flushToDisk
   - fileWatcher.ts chokidar mock + debounce 时序
   - headerCache.ts mtime 增量

2. **集成测试层**（自动，CI gate）：
   - 模拟激活流：mock detection.ready → 验证 fingerprint + cache + watcher 启动顺序
   - 模拟文件变更：mock chokidar emit → 验证状态栏更新延迟

3. **手动测试层**（dev 手动，release 前）：
   - 在真实 > 5000 文件 UE 工程上运行 `vsce package` → 安装 → 验证：
     - 状态栏三段显示
     - compile_commands 二次生成 < 100ms（缓存命中）
     - preparse 命中率统计可见
     - 改 Build.cs 后状态栏 `[Clangd: 🔴 8.5s]`（UBT 重跑）

## Code Examples

> 所有示例来自 Context7 + 现有项目代码（`src/clangd/compileCommands.ts` / `src/clangd/preparseIncludes.ts`），无虚构。

### SHA256 指纹计算（基于 Node 内置）

```typescript
// 来源: Node 内置 crypto API（https://nodejs.org/api/crypto.html）
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';

export async function computeFingerprint(projectDir: string): Promise<FingerprintResult> {
  const hash = createHash('sha256');
  const sources: string[] = [];

  // 1. .uproject
  const uprojectFiles = await fs.readdir(projectDir).then((names) =>
    names.filter((n) => n.endsWith('.uproject')).map((n) => `${projectDir}/${n}`),
  );

  // 2. *.Build.cs (递归 Source/)
  // 3. *.Target.cs (Source/ 顶层)
  // ... 详见 PLAN A fingerprint.ts 实现

  for (const filePath of sortedSources) {
    const content = await fs.readFile(filePath);
    hash.update(filePath);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }

  return {
    fingerprint: hash.digest('hex'),
    files: sortedSources.map((p) => ({ path: p, size: 0, mtimeMs: 0 })),
    computedMs: 0,
  };
}
```

### chokidar awaitWriteFinish（项目已有依赖）

```typescript
// 来源: chokidar v3 README（https://github.com/paulmillr/chokidar）
import chokidar from 'chokidar';

const watcher = chokidar.watch(patterns, {
  ignored: ['**/Intermediate/**', '**/Binaries/**'],
  ignoreInitial: true,
  awaitWriteFinish: {
    stabilityThreshold: 100,  // D-15
    pollInterval: 50,
  },
});

watcher.on('add', handler).on('change', handler).on('unlink', handler);
```

### 状态栏 ThemeColor（VS Code API）

```typescript
// 来源: src/ui/statusBar.ts 现有用法
this.buildBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
this.projectBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
// Phase 7 复用同样模式（warningBackground / errorBackground）
```

### CLAUDE.md 路径处理（项目惯例）

```typescript
// 来源: 项目 AGENTS.md「导入路径别名」规则
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import { computeFingerprint } from './fingerprint';  // 同目录相对路径 OK
```

## Security Domain

> security_enforcement = true（.planning/config.json）→ 必须包含本节

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V1 Architecture | yes | 模块分层（per tenant 隔离）—— perfCache 在项目本地，无云端 IO |
| V2 Authentication | no | 本阶段无认证面 |
| V3 Session Management | no | 无 session |
| V4 Access Control | yes | perfCache 文件路径在项目内，避免越界写入其他目录 |
| V5 Input Validation | yes | 文件路径 glob 必须限制在项目根 + Source/ + Plugins/ |
| V6 Cryptography | partial | SHA256 是完整性校验，不用于认证；轮转压缩不加密（D-07 用户明示） |
| V7 Error Handling | yes | perfLog.record() 必须吞掉所有异常，主流程不被 perf 模块破坏 |
| V8 Data Protection | no | 不涉及用户隐私数据 |
| V9 Communications | no | 无网络通信 |
| V10 Malicious Code | yes | chokidar glob 严禁 `'**'` 全通配；必须 enumerate 具体 pattern |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| chokidar glob 注入 | Tampering | 路径白名单 + 拒绝包含 `..` 的输入 |
| perfCache 符号链接攻击 | Tampering | `cache.write` 用 `fs.realpath` 后比较前缀 |
| perfLog JSON 注入 | Tampering | meta 字段必须用 JSON.stringify，禁止拼接字符串 |
| 大型 perfCache 文件拒绝服务 | DoS | 100MB 轮转阈值（D-07）+ 文件大小上限检查 |

### 具体防御措施（PLAN A 必须实现）

```typescript
// src/clangd/compileCommandsCache.ts 关键防御
async write(projectDir: string, entry: CachedCompileCommands): Promise<void> {
  // 防御 1: projectDir 必须在工作区内
  const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir));
  if (!workspaceRoot) throw new Error('projectDir not in workspace');

  // 防御 2: 写盘大小限制 (5MB 软上限)
  const json = JSON.stringify(entry, null, 2);
  if (json.length > 5 * 1024 * 1024) {
    throw new Error('cache entry too large, refusing to write');
  }

  // 防御 3: 原子写入 (temp + rename)
  const cachePath = CompileCommandsCache.cachePath(projectDir);
  const tmpPath = `${cachePath}.tmp`;
  await fs.writeFile(tmpPath, json, 'utf-8');
  await fs.rename(tmpPath, cachePath);
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| UBT 每次都跑（5-30s） | fingerprint cache 命中后秒级返回 | Phase 7 | 二次激活快 30 倍 |
| 无运行时 perf 度量 | `[perf]` 双载体日志 + 状态栏 | Phase 7 | 用户可见性能趋势 |
| chokidar 仅监听 .uproject/.code-workspace/.clangd | 扩展到全工程 UE 源码 | Phase 7 | 增量扫描成为可能 |
| 状态栏只显示 build 结果 | 状态栏三段性能 + 三色阈值 | Phase 7 | 性能可视化进入用户视野 |

**Deprecated/outdated:**
- 旧 unreal-clangd v3 没有增量缓存——Phase 7 是 VSCodeUEHelper 的差异化能力
- 全量扫描所有 UE 头（2000+）——D-13 推荐按 mtime 增量

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | chokidar awaitWriteFinish stabilityThreshold=100ms 满足「< 200ms」要求 | §Feature 3 | 如果 chokidar 在 Windows 上有抖动（pitfall 6），可能要降到 50ms 或改用 polling |
| A2 | compile_commands.json 大小 < 5MB（防御 2 阈值） | §Security | UE 巨型项目可能 > 5MB；防御策略要可调 |
| A3 | UE Build.cs 单文件 < 50KB（fingerprint 全量读可接受） | §Stack | 极端模块化项目可能有 > 200KB 的 Build.cs；fallback 用流式 hash |
| A4 | 用户工程只打开一个 VS Code 实例 | §Pitfall 2 cache 锁 | 多实例并发写入采用「最后写入获胜」可接受 |
| A5 | clangd 自身 FileSystemWatcher 已正常工作 | §Feature 3 推荐方案 | 如果未来 clangd 切换为非 FileWatcher 模式（如 LibFSEvents），需要重审 LSP didChangeWatchedFiles 路径 |
| A6 | VS Code 状态栏 Left alignment 容纳 14 个按钮（11 + 1 + 3 + 1 CompletionMode） | §Pitfall 5 | 某些主题/小屏幕可能截断；fallback 是隐藏部分性能段 |

**所有 A1-A6 都是设计假设**，不影响功能正确性，只影响性能/兼容性；如需调整不影响 PLAN A 主体实现。

## Open Questions

1. **PLAN B 是否真的需要「UBT 并发合并」？**
   - 当前理解：UBT 调用是单进程单实例；并发多个 UBT 会导致锁竞争（D-10 描述「按需启动」）
   - 建议：PLAN A 先收集 perf 数据，PLAN B 根据真实 perf 数据决定是否需要
   - 不阻塞规划

2. **状态栏三段点击行为的最终方案？**
   - 当前推荐：跳转 Output Channel 并写入 `[perf]` 标记
   - 备选：弹出 WebView 详细面板（与控制面板 Status Tab 重叠，不推荐）
   - 待 PLAN A 实施时决定

3. **proxy 协同测量的「基线」取哪个时间点？**
   - 候选：v1.0 released baseline (498 tests) vs v1.1 released baseline vs Phase 7 启动前 snapshot
   - 推荐：用 v1.1 + 当前 snapshot 的 diff，确保仅 Phase 7 代码带来的影响
   - 不阻塞规划

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 18+ | crypto.createHash / fs/promises | ✓ | Node 20.x（package.json engines 要求） | — |
| TypeScript 5.3+ | strict mode 编译 | ✓ | 5.3.3（devDependencies） | — |
| Vitest 1.3+ | 单元测试 | ✓ | 1.3.0（devDependencies） | — |
| chokidar 3.6+ | 增量扫描 | ✓ | ^3.6.0（dependencies 已存在） | 改用 VS Code FileSystemWatcher + 手写 debounce |
| vscode.window.createStatusBarItem | 三段状态栏 | ✓ | vscode 1.85+ | — |
| vscode.workspace.createFileSystemWatcher | 备选监听 | ✓ | vscode 1.85+ | — |
| UE 引擎（仅手动测试需要） | 验证 >5000 文件项目 | dev 手动 | — | 不需要自动化 |

**Missing dependencies with no fallback:** 无
**Missing dependencies with fallback:** 无（本阶段零新依赖）

## Runtime State Inventory

> Phase 7 不涉及 rename/refactor/migration —— 但性能优化会引入 `.vscode/clangd-perf-cache/` 这一新运行时状态，需要明确归属。

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `.vscode/clangd-perf-cache/compile-commands-cache.json`（新建）；`perf-log.json`（新建，D-07 仅 dev） | 在 `.gitignore` 追加 `.vscode/clangd-perf-cache/`；运行时由扩展自动创建 |
| Live service config | 无 | — |
| OS-registered state | 无 | — |
| Secrets/env vars | 无 | — |
| Build artifacts | 无新增 npm 依赖，esbuild 输出不变 | — |
| LSP 消息通道 | 不变（per CLANGD-01-04「不引入」） | — |

**确认无冲突**：本阶段与现有 `compile_commands.json`、`.clangd`、`.vscode/vscodeuehelper/` 三个已有运行时产物不重叠；新 `.vscode/clangd-perf-cache/` 命名空间隔离。

## Sources

### Primary (HIGH confidence)
- `.planning/REQUIREMENTS.md` § CLANGD-01-01 ~ 04 — 阶段成功标准
- `.planning/STATE.md` § Decisions — 18 个 D-01 ~ D-18 决策
- `.planning/PROJECT.md` § Constraints — LSP 3.17 协议 + 不修改 upstream clangd
- `.planning/codebase/STRUCTURE.md` — 目录布局（已对照实测 `src/clangd/` 文件系统）
- `.planning/codebase/INTEGRATIONS.md` § 4 § 12 — clangd 集成 + chokidar 现状

### Codebase 实证 (HIGH confidence)
- `src/clangd/compileCommands.ts` (817 行) — 已通读，确认 `generateCompileCommands` 入口结构
- `src/clangd/completionFiles.ts` (635 行) — 已通读，确认 MANAGED/USER 区域机制
- `src/clangd/preparseIncludes.ts` (120 行) — 已通读，确认无 hit/miss 统计点
- `src/clangd/clangdConfig.ts` (286 行) — 已通读，确认 `defaultClangdConfig` 注入模式
- `src/clangd/index.ts` (139 行) — 已通读，确认 `activateClangd` 钩子点
- `src/clangd/proxyManager.ts` (235 行) — 已通读，确认零修改路径
- `src/clangd/ueHelpers.ts` (135 行) — 已通读，确认 UBT 路径查找现状
- `src/clangd/types.ts` (98 行) — 已通读，确认类型扩展点
- `src/ui/statusBar.ts` (278 行) — 已通读，确认 StatusBarItem 创建模式
- `src/core/logger.ts` (133 行) — 已通读，确认 `[perf]` 前缀模式
- `src/core/config.ts` (223 行) — 已通读，确认 `showPerfInStatusBar` getter 插入位置
- `package.json` — 已读，确认 contributes.configuration + contributes.commands 插入位置
- `vitest.config.ts` — 已读，确认覆盖率阈值
- `test/unit/setup.ts` — 已读，确认 vscode mock 范围 + 需要追加 chokidar mock
- `.gitignore` — 已读，确认需追加 `.vscode/clangd-perf-cache/`

### Secondary (MEDIUM confidence)
- Context7 `/websites/clangd_llvm` — BackgroundIndex + `.cache/clangd/index/` 设计（命中 D-12 共享协议设计）
- Context7 `/microsoft/vscode-languageserver-node` — LSP 3.17 帧协议（确认 PLAN B「透传」可行性）
- chokidar README — `awaitWriteFinish` 防抖模式（D-15 推荐方案依据）

### Tertiary (LOW confidence)
- `node:crypto.createHash` 性能——基于 Node 文档与社区共识（无实测 benchmark）
- clangd `.cache/` 目录位置——基于 clangd 设计文档（无源码实测）

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — 零新依赖 + 复用现有 chokidar/crypto/ThemeColor
- Architecture: HIGH — 已通读 10+ 核心源文件 + 明确模块边界 + 单一改动点
- Pitfalls: HIGH — 7 个 UE 特定陷阱 + 7 个通用陷阱，覆盖率高于 v1.0/v1.1 研究
- Performance estimates: MEDIUM — 数值基于 UE 5.x 经验，无 >5000 文件基准测试
- Security: MEDIUM — 4 类威胁识别 + 防御策略，但缺少实际渗透测试

**Research date:** 2026-07-04
**Valid until:** 30 天（UE/clangd/chokidar 均为成熟稳定栈；Node 20 LTS 至 2026-04）

---

## Planner Handoff Notes

### PLAN A 任务分解建议（顺序）

1. **Wave 0: 类型 + 框架**
   - `src/clangd/types.ts` 追加 `PerfEvent` / `PerfSession` / `CachedCompileCommands` / `FingerprintResult` 类型
   - `test/unit/setup.ts` 追加 chokidar mock
   - `package.json` 追加 `vscodeUEHelper.showPerfInStatusBar` 配置

2. **Wave 1: 核心模块**
   - `src/clangd/fingerprint.ts`（新）+ 单测
   - `src/clangd/compileCommandsCache.ts`（新）+ 单测
   - `src/clangd/headerCache.ts`（新）+ 单测

3. **Wave 2: 埋点 + 持久化**
   - `src/clangd/perfLog.ts`（新）+ 单测（含 D-07 模式自适应测试）
   - 修改 `src/clangd/preparseIncludes.ts` 追加 `perfSession?` 参数

4. **Wave 3: 状态栏 + UI**
   - `src/ui/perfStatusBar.ts`（新）
   - `src/ui/statusBar.ts` 集成 PerfStatusBar
   - `src/i18n/locales/{en,zh}.json` 追加 perf 文案
   - `src/core/config.ts` 追加 `showPerfInStatusBar` getter

5. **Wave 4: 增量扫描 + 入口注入**
   - `src/clangd/fileWatcher.ts`（新）+ 单测
   - 修改 `src/clangd/index.ts:activateClangd` 注入 watcher + perfBar
   - 修改 `src/clangd/compileCommands.ts:generateCompileCommands` 入口叠加指纹检查
   - 修改 `src/clangd/clangdConfig.ts:defaultClangdConfig` 追加 Index 配置

6. **Wave 5: 验证**
   - `npm run typecheck && npm run lint && npm run test:unit` 全绿
   - 手动在 >5000 文件 UE 项目上验证三个阈值
   - `.gitignore` 追加 `.vscode/clangd-perf-cache/`

### PLAN B 任务分解建议（顺序）

1. **Wave 1: 基线测量**
   - `src/clangd/perfProxy.ts`（新）— proxy 协同开销测量
   - `scripts/measure-proxy-overhead.mjs`（新）— 自动测量脚本
   - 记录 v1.1 + snapshot baseline（CPU/内存/P95 延迟）

2. **Wave 2: UBT 细化插桩**
   - 修改 `src/clangd/compileCommands.ts` 在 UBT 调用细化阶段（optsSignal 设置、UBT 启动、Task 完成、文件查找、linkToWorkspaceRoot）追加 perfLog.record
   - 单测：mock executeShellTask，验证 5 个阶段都被记录

3. **Wave 3: 验证零开销**
   - 重跑 baseline 测量
   - 对比 PLAN A 注入前后偏差 < 1%
   - 产出 `doc/phase-7-perf-baseline.md` 报告

### 显式禁做的事（避免范围蔓延）

- ❌ 不要改 `src/clangd/proxy/` 下任何文件（CLANGD-01-04 约束）
- ❌ 不要改 `src/clangd/completionFiles.ts`（D-11 调研结论为不动）
- ❌ 不要新增 npm 依赖（除非 wave 5 验证后明确需要）
- ❌ 不要新建 WebView 性能面板（D-04 + Deferred）
- ❌ 不要把 perf 度量嵌入 hot path（同步 await 写盘）—— Pitfall 1
- ❌ 不要直接发送 LSP `workspace/didChangeWatchedFiles`（D-15 推荐方案）