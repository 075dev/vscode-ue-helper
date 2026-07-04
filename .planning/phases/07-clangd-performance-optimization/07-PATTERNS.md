# Phase 7: clangd 性能优化 - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 21 (12 new + 9 extended/modified)
**Analogs found:** 18 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/clangd/perfLog.ts` (NEW) | service | event-driven (埋点) | `src/core/logger.ts` | exact (结构化日志 + 前缀) |
| `src/clangd/fingerprint.ts` (NEW) | utility | file-I/O + hash | 无现成; 底层复用 `node:crypto` | partial |
| `src/clangd/compileCommandsCache.ts` (NEW) | service | file-I/O (cache) | `src/clangd/compileCommands.ts:linkToWorkspaceRoot` | role-match (JSON 持久化) |
| `src/clangd/headerCache.ts` (NEW) | service | file-I/O (mtime 缓存) | `src/clangd/completionFiles.ts` + `preparseIncludes.ts` | role-match (头文件管理) |
| `src/clangd/perfProxy.ts` (NEW) | service | measurement (READ-ONLY) | `src/clangd/proxyManager.ts:getStatus()` + `proxy/status.ts:buildStatus` | exact (状态查询/测量) |
| `src/clangd/fileWatcher.ts` (NEW) | utility | event-driven (chokidar) | `src/clangd/workspaceBackup.ts:startWatching()` | role-match (但替换为 chokidar) |
| `src/ui/perfStatusBar.ts` (NEW) | UI 组件 | request-response | `src/ui/statusBar.ts:StatusBarManager` | exact (StatusBarItem 创建) |
| `src/ui/statusBar.ts` (EXTEND) | UI 组件 | request-response | 自身扩展 | self-extend |
| `src/core/config.ts` (EXTEND) | config | request-response | 自身 `clangdProxyEnabled` getter | self-extend |
| `src/clangd/clangdConfig.ts` (EXTEND) | service | file-I/O (YAML) | 自身 `defaultClangdConfig` 函数 | self-extend |
| `src/clangd/compileCommands.ts` (EXTEND) | service | request-response | 自身 `generateCompileCommands` 入口 | self-extend |
| `src/clangd/preparseIncludes.ts` (EXTEND) | service | request-response | 自身 `getPrepareIncludesList` | self-extend |
| `src/clangd/index.ts` (EXTEND) | module 入口 | activation | 自身 `activateClangd` | self-extend |
| `src/extension.ts` (EXTEND) | module 入口 | activation | 自身 activate 函数 | self-extend (不变) |
| `package.json` (CONFIG) | config | — | `contributes.configuration.properties` 区域 | self-extend |
| `.gitignore` (CONFIG) | config | — | 现有排除规则 | self-extend |
| `src/i18n/locales/{zh,en}.json` (EXTEND) | i18n | — | 现有翻译 key 命名规范 | self-extend |
| `test/unit/clangd/fingerprint.test.ts` (NEW) | test | — | `test/unit/clangd/preparseIncludes.test.ts` | exact (vitest pattern) |
| `test/unit/clangd/compileCommandsCache.test.ts` (NEW) | test | — | `test/unit/clangd/compileCommands.test.ts` | exact (vitest + tmpdir) |
| `test/unit/clangd/perfLog.test.ts` (NEW) | test | — | `preparseIncludes.test.ts` + `compileCommands.test.ts` | exact |
| `test/unit/clangd/fileWatcher.test.ts` (NEW) | test | — | `compileCommands.test.ts` (mock chokidar) | exact |
| `scripts/measure-proxy-overhead.mjs` (NEW) | script | measurement | `esbuild.config.mjs` (ESM 脚本) | role-match |

---

## Module-by-Module Patterns

### 1. `src/clangd/perfLog.ts` (NEW, service, event-driven)

**Analog:** `src/core/logger.ts` — 共享的 OutputChannel 包装器,提供结构化日志。

**核心契约** (来自 RESEARCH §Feature 2):
```typescript
export interface PerfEvent {
  event: string;        // 'compileCommands.cacheHit' | 'preparse.listBuilt' | 'incremental.scanComplete'
  elapsedMs: number;
  timestamp: string;
  meta?: Record<string, unknown>;
}
export interface PerfSession {
  record(ev: Omit<PerfEvent, 'timestamp'>): void;
  getCompileCommandsLastMs(): number;
  getPreparseHitRate(): { hits: number; misses: number; rate: number };
  getLastIncrementalScanMs(): number;
  flushToDisk(): Promise<void>;  // D-07: 仅 dev 模式写盘
}
export const perfLog: PerfSession;
export function isDevMode(): boolean;
```

**Imports pattern** — 复用 `src/core/logger.ts` 第 40 行:
```typescript
// src/core/logger.ts:40
import * as vscode from 'vscode';
```
新文件应该:
```typescript
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
```

**结构化日志格式** (Logger 第 85-91 行):
```typescript
private format(level: LogLevel, args: unknown[]): string {
  const ts = new Date().toISOString().slice(11, 23);
  const tail = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ');
  return `${ts} [${level.toUpperCase()}] ${this.prefix} ${tail}`;
}
```
perfLog 应该直接使用 `Logger` 实例(注入 prefix `[perf]`),而不是新建 OutputChannel。

**D-02 双载体实现模式** (Logger 第 94-99 行 info):
```typescript
info(...args: unknown[]): void {
  if (!this.shouldLog('info')) return;
  const line = this.format('info', args);
  this.channel.appendLine(line);   // Output 面板
  console.log(line);                // console.log
}
```
perfLog.record 应该: (a) 调 `logger.info('[perf] ${event} ${elapsedMs}ms')`,(b) 入内存队列,后台 `setImmediate`/`setInterval` 批量 flush 到 `.vscode/clangd-perf-cache/perf-log.json`。

**D-07 模式自适应** — 参考 `test/unit/setup.ts` 第 150 行:
```typescript
ExtensionMode: { Production: 1, Development: 2, Test: 3 },
```
perfLog 启动时检查 `vscode.ExtensionMode.Development`,非开发模式下 `flushToDisk()` 变 no-op。

**EventEmitter 订阅模式** (setup.ts 第 135-143 行):
```typescript
EventEmitter: class {
  private listeners: Array<(e: unknown) => void> = [];
  event = (listener: (e: unknown) => void) => {
    this.listeners.push(listener);
    return { dispose: () => {} };
  };
  fire = (e: unknown) => this.listeners.forEach((l) => l(e));
  dispose = () => { this.listeners = []; };
},
```
perfLog.onMetricUpdate() 应返回 `vscode.Disposable`,调用方 `context.subscriptions.push(...)`。

**Atomic 写入模式** (来自 compileCommands.ts §Security 防御 3):
```typescript
const tmpPath = `${cachePath}.tmp`;
await fs.writeFile(tmpPath, json, 'utf-8');
await fs.rename(tmpPath, cachePath);
```
perf-log.json 也应使用 temp + rename 模式避免半写入文件。

---

### 2. `src/clangd/fingerprint.ts` (NEW, utility, file-I/O + hash)

**Analog:** 无现成 hash 工具。底层用 `node:crypto` (RESEARCH §Stack 明确)。最接近的 file-I/O utility 是 `src/clangd/compileCommands.ts:findClangToolchain()` (第 281-292 行)。

**Glob 扫描模式** (从 `compileCommands.ts:discoverSourceRoots` 第 594-628 行):
```typescript
async function discoverSourceRoots(projectDir: string, logger?: Logger): Promise<string[]> {
  const roots: string[] = [];
  const projectSource = path.join(projectDir, 'Source');
  roots.push(projectSource);

  const pluginsDir = path.join(projectDir, 'Plugins');
  try {
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const entry of pluginEntries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const pluginSource = path.join(pluginsDir, entry.name, 'Source');
        try {
          const stat = await fs.stat(pluginSource);
          if (stat.isDirectory()) {
            roots.push(pluginSource);
            logger?.debug(`[fillMissingCompileCommands] discovered plugin source root: ${pluginSource}`);
          }
        } catch { /* plugin has no Source dir, skip */ }
      }
    }
  } catch { /* plugins dir not found, skip */ }
  return roots;
}
```
fingerprint 应该用同样模式枚举 `.uproject` + `Source/**/*.Build.cs` + `Source/*.Target.cs`。

**Node 内置 SHA256 模板** (RESEARCH §Code Examples):
```typescript
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';

export async function computeFingerprint(projectDir: string): Promise<FingerprintResult> {
  const hash = createHash('sha256');
  const sources: string[] = [];
  // ... enumerate files via glob pattern (like discoverSourceRoots) ...
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
    computedMs: performance.now() - startMs,
  };
}
```

**空目录安全处理** — 参考 `preparseIncludes.ts:loadBundledList` 第 25-41 行 try/catch 返回 `[]`:
```typescript
export async function loadBundledList(mode: CompletionMode): Promise<string[]> {
  const resourcePath = path.join(__dirname, '..', '..', 'resources', 'preparse-includes', `ue5-${mode}.json`);
  try {
    const text = await fs.readFile(resourcePath, 'utf-8');
    const parsed = JSON.parse(text) as PrepareIncludesList;
    return parsed.headers ?? [];
  } catch {
    return [];
  }
}
```
fingerprint 在空 Source/ 时也应返回稳定空 fingerprint (不抛错)。

**D-09 排序保证确定性** — 字典序排序:
```typescript
const sortedSources = sources.sort();   // 路径字典序固定
for (const filePath of sortedSources) { /* hash */ }
```

---

### 3. `src/clangd/compileCommandsCache.ts` (NEW, service, file-I/O cache)

**Analog:** `src/clangd/compileCommands.ts:linkToWorkspaceRoot` (第 446-539 行) — 同样的「本地 JSON 文件 + 原子写入 + 失败回退」模式。

**LinkToWorkspaceRoot 关键模式** (compileCommands.ts 第 466-491 行):
```typescript
await fs.mkdir(ccDir, { recursive: true });
logger?.info(`[linkToWorkspaceRoot] ensured ccDir exists: ${ccDir}`);

try {
  const stat = await fs.lstat(target);
  if (stat.isSymbolicLink() || stat.isFile()) {
    const existing = await fs.readlink(target).catch(() => null);
    if (existing === jsonPath) { return target; }
    await fs.unlink(target);
  }
} catch (err) {
  logger?.info(`[linkToWorkspaceRoot] no existing target (lstat failed: ${err instanceof Error ? err.message : String(err)})`);
}
```

**Symlink → Copy 回退** (compileCommands.ts 第 493-536 行) — 同样模式可应用于 cache:
```typescript
try {
  await fs.symlink(jsonPath, target, 'file');
  logger?.info(`[linkToWorkspaceRoot] fs.symlink SUCCEEDED → ${target}`);
} catch (symlinkErr) {
  logger?.info(`[linkToWorkspaceRoot] fs.symlink FAILED errno=${errno}; falling back to fs.copyFile`);
  try {
    await fs.copyFile(jsonPath, target);
  } catch (copyErr) {
    logger?.error(`[linkToWorkspaceRoot] fs.copyFile FAILED ...; giving up`);
    throw new Error(...);
  }
}
```

**D-08 缓存层接口** (RESEARCH §Feature 1):
```typescript
class CompileCommandsCache {
  static cachePath(projectDir: string): string;  // .vscode/clangd-perf-cache/compile-commands-cache.json
  async tryRead(projectDir: string): Promise<CachedCompileCommands | undefined>;
  async write(projectDir: string, entry: CachedCompileCommands): Promise<void>;
  async invalidate(projectDir: string, reason: string): Promise<void>;
}
```

**JSON 序列化 + 错误日志模式** (compileCommands.ts 第 727-732 行):
```typescript
try {
  const content = await fs.readFile(jsonPath, 'utf-8');
  entries = JSON.parse(content) as ...;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger?.error(`[fillMissingCompileCommands] failed to read existing JSON: ${msg}`);
  return undefined;
}
```
cache.tryRead() 应该 try/catch + logger.error + 返回 undefined (= cache miss)。

**Security 防御 1**: projectDir 必须在工作区内:
```typescript
const workspaceRoot = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir));
if (!workspaceRoot) throw new Error('projectDir not in workspace');
```

**Security 防御 2**: 写盘大小限制 (5MB 软上限):
```typescript
const json = JSON.stringify(entry, null, 2);
if (json.length > 5 * 1024 * 1024) {
  throw new Error('cache entry too large, refusing to write');
}
```

**Security 防御 3**: 原子写入 (temp + rename):
```typescript
const tmpPath = `${cachePath}.tmp`;
await fs.writeFile(tmpPath, json, 'utf-8');
await fs.rename(tmpPath, cachePath);
```

---

### 4. `src/clangd/headerCache.ts` (NEW, service, file-I/O mtime cache)

**Analog:** `src/clangd/completionFiles.ts` (MANAGED/USER 区域机制) + `src/clangd/preparseIncludes.ts` (头文件列表管理)。

**MANAGED/USER 区域模式** (completionFiles.ts 第 63-72 行):
```typescript
export const MANAGED_BEGIN_MARKER = '/* ==== VSCodeUEHelper MANAGED BEGIN (DO NOT EDIT) ==== */';
export const MANAGED_END_MARKER = '/* ==== VSCodeUEHelper MANAGED END ==== */';
export const USER_BEGIN_MARKER = '/* ==== VSCodeUEHelper USER BEGIN ==== */';
export const USER_END_MARKER = '/* ==== VSCodeUEHelper USER END ==== */';
```
headerCache 不需要 markers,但可参考其「区域命名空间隔离」思想: `.vscode/clangd-perf-cache/headers/<ueVersion>/<headerName>.sha256` (RESEARCH §Feature 2)。

**mtime 增量判断** (从 `compileCommands.ts:scanDirRecursive` 第 633-653 行模式反推):
```typescript
async function scanDirRecursive(dir: string, logger?: Logger): Promise<string[]> {
  const files: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await scanDirRecursive(fullPath, logger);
        files.push(...subFiles);
      } else if (entry.isFile() && /\.(cpp|c)$/i.test(entry.name)) {
        files.push(path.normalize(fullPath));
      }
    }
  } catch (err) {
    logger?.warn(`[fillMissingCompileCommands] scan failed for ${dir}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return files;
}
```
headerCache 应该用同样的递归扫描 (D-13 限定 `.h/.hpp/.inl`),然后 `fs.stat(path).mtimeMs` 增量判断。

**D-11 调研结论** (RESEARCH §Feature 2 表格): preparse 列表来自打包 JSON,没有运行时 hit/miss 计数。headerCache 不需要重设计 preparse 缓存,只补充 mtime 索引层。

**getPrepareIncludesList 模式** (preparseIncludes.ts 第 70-76 行):
```typescript
export async function getPrepareIncludesList(
  mode: CompletionMode,
  projectPath: string,
): Promise<string[]> {
  const base = await loadBundledList(mode);
  return mergeUserCustomizations(projectPath, base);
}
```
headerCache 应该提供类似接口: `getCachedHeaders(mode, engineRoot)` 返回 mtime 缓存的 header 清单。

---

### 5. `src/clangd/perfProxy.ts` (NEW, service, measurement)

**Analog:** `src/clangd/proxyManager.ts:ClangdProxyManager.getStatus()` (第 81-93 行) + `src/clangd/proxy/status.ts:buildStatus` — 纯数据查询,不修改任何状态。

**getStatus 纯数据查询模式** (proxyManager.ts 第 81-93 行):
```typescript
/**
 * 构建当前代理状态。
 *
 * 纯数据查询,不修改任何设置,不连接运行中的代理进程。
 */
getStatus(): ClangdProxyStatus {
  return buildStatus({
    enabled: this.enabled,
    launcherPath: this.launcherPath,
    realClangdPath: this.config.clangdProxyRealClangdPath,
    keepaliveMax: this.config.clangdProxyKeepaliveMax,
    keepaliveTtlSec: this.config.clangdProxyKeepaliveTtlSec,
    localizationEnabled: this.config.clangdProxyLocalizationEnabled,
    localizationMode: this.config.clangdProxyLocalizationMode,
    logPath: this.logPath,
    hasBackup: this.hasBackup,
  });
}
```

**Logger 注入模式** (proxyManager.ts 第 38-52 行):
```typescript
constructor(
  private readonly context: vscode.ExtensionContext,
  private readonly config: Config,
  private readonly logger: Logger,
  private readonly deps: ClangdProxyManagerDependencies = {},
) {
  this.launcherPath = this.context.asAbsolutePath(`out/launcher/proxy-launcher${isWin ? '.bat' : '.sh'}`);
  this.settingsManager = new ClangdSettingsManager(this.context, this.launcherPath);
  this.logger.info(`[proxyManager] launcher path: ${this.launcherPath}`);
}
```
perfProxy 也应使用 `Logger` 注入 + 前缀 `[perfProxy]`。

**CLANGD-01-04 测量零开销** (RESEARCH §Feature 4):
- 记录 `process.resourceUsage()` (CPU/内存基线)
- 测量单条 `textDocument/definition` 请求延迟
- 100 次连续 `textDocument/completion` P95 延迟
- PLAN A 注入前后对比偏差 < 1% 即认为零开销达成

**processBridge 测量点** (来自 `src/clangd/proxy/processBridge.ts`) — 用于在 LSP 帧通道插入时间戳,但不修改消息内容。

---

### 6. `src/clangd/fileWatcher.ts` (NEW, utility, event-driven)

**Analog:** `src/clangd/workspaceBackup.ts:startWatching()` (第 74-88 行) — VS Code `FileSystemWatcher` 模式。

**现有 FileSystemWatcher 模式** (workspaceBackup.ts 第 74-88 行):
```typescript
startWatching(): vscode.Disposable {
  const dir = path.dirname(this.projectPath);
  const pattern = new vscode.RelativePattern(dir, '*.code-workspace');
  this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const onChange = async () => {
    await this.restore();
  };
  this.watcher.onDidChange(onChange);
  this.watcher.onDidCreate(onChange);

  return new vscode.Disposable(() => {
    this.watcher?.dispose();
  });
}
```

**RESEARCH 推荐替换为 chokidar** (D-15 + Pitfall 6 — chokidar 内置 `awaitWriteFinish` 防抖,避免手写 debounce):
```typescript
import chokidar, { FSWatcher } from 'chokidar';

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

**UE 特定陷阱防御** (RESEARCH §Implementation Considerations):
- `ignored`: 强制排除 `**/Intermediate/**` / `**/Binaries/**` / `**/DerivedDataCache/**` / `**/Saved/**` / `**/.git/**`
- `patterns` 用 `path.join(projectDir, ...)` 限定项目内路径
- chokidar v3 默认 `usePolling: false` (Win 句柄限制场景下可降级)

**D-16 头/源分级**:
```typescript
const isHeader = /\.(h|hpp|inl)$/i.test(filePath);
const isSource = /\.(cpp|cc|c)$/i.test(filePath);
// 埋点时按扩展名分级:headerCount vs sourceCount
```

---

### 7. `src/ui/perfStatusBar.ts` (NEW, UI, request-response)

**Analog:** `src/ui/statusBar.ts:StatusBarManager` (第 61-127 行) — 11 个 StatusBarItem 的聚合管理器。

**StatusBarItem 创建模式** (statusBar.ts 第 79-127 行):
```typescript
constructor() {
  // Higher priority = further left. Actions on left, info on right.
  this.buildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 300);
  this.buildBtn.command = 'vscodeUEHelper.build';
  this.buildBtn.name = 'UE Helper: Build';

  this.rebuildBtn = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 299);
  this.rebuildBtn.command = 'vscodeUEHelper.rebuild';
  // ...
}
```

**ThemeColor 三色背景** (statusBar.ts 第 140-141, 175-178, 254-255 行):
```typescript
this.buildBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.prominentBackground');
this.projectBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
// build failed:
this.buildBtn.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
```

**D-04/D-05 三段性能项设计** (RESEARCH §Architecture Recommendation):
```typescript
export class PerfStatusBar {
  private clangdGenItem: vscode.StatusBarItem;
  private preparseCacheItem: vscode.StatusBarItem;
  private incrementalScanItem: vscode.StatusBarItem;

  constructor() {
    // priority 198-200: 位于 CompletionModeController priority=99 之上但低于现有 11 个按钮 (291-300)
    this.clangdGenItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 200);
    this.preparseCacheItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 199);
    this.incrementalScanItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 198);
  }

  update(metrics: { genMs?: number; hitRate?: number; incrMs?: number }): void {
    if (metrics.genMs !== undefined) {
      const { icon, color } = this.thresholdFor(metrics.genMs, 5000, 10000);  // D-05
      this.clangdGenItem.text = `${icon} Clangd: ${(metrics.genMs / 1000).toFixed(1)}s`;
      this.clangdGenItem.backgroundColor = color;
    }
    // ... 命中率 (inverted) + 增量扫描
  }

  private thresholdFor(value: number, greenThreshold: number, yellowThreshold: number, inverted = false):
      { icon: string; color: vscode.ThemeColor | undefined } {
    const isGreen = inverted ? value >= greenThreshold : value <= greenThreshold;
    const isYellow = inverted ? value >= yellowThreshold : value <= yellowThreshold;
    if (isGreen) return { icon: '🟢', color: undefined };
    if (isYellow) return { icon: '🟡', color: new vscode.ThemeColor('statusBarItem.warningBackground') };
    return { icon: '🔴', color: new vscode.ThemeColor('statusBarItem.errorBackground') };
  }

  dispose(): void {
    this.clangdGenItem.dispose();
    this.preparseCacheItem.dispose();
    this.incrementalScanItem.dispose();
  }
}
```

**completionMode 状态栏参照** (completionMode.ts 第 52-61 行) — 单 StatusBarItem + command:
```typescript
export class CompletionModeController {
  private statusBarItem: vscode.StatusBarItem;
  constructor(private readonly config: Config) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.statusBarItem.command = 'vscodeUEHelper.toggleCompletionMode';
  }
  // ...
  show(): void { this.render(); this.statusBarItem.show(); }
  hide(): void { this.statusBarItem.hide(); }
  dispose(): void { this.statusBarItem.dispose(); }
}
```

**点击行为 (agent 决定)** — 推荐跳转 Output Channel:
```typescript
this.clangdGenItem.command = {
  title: 'Show Performance Log',
  command: 'workbench.action.output.showOutput',
  arguments: ['VSCodeUEHelper'],
};
```

---

### 8. EXTEND `src/core/config.ts` (self-extend)

**Analog:** 现有 `clangdProxyEnabled` getter (第 132-135 行):
```typescript
/** 是否启用 clangd LSP Proxy,默认 false */
get clangdProxyEnabled(): boolean {
  return this.root.get<boolean>("clangdProxy.enabled") ?? false;
}
```

**D-06 新 getter 模板**:
```typescript
/** 是否在状态栏显示性能指标,默认 true (Phase 7) */
get showPerfInStatusBar(): boolean {
  return this.root.get<boolean>("showPerfInStatusBar") ?? true;
}
```

**onDidChange 监听模式** (config.ts 第 215-221 行):
```typescript
onDidChange(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('vscodeUEHelper')) { listener(e); }
  });
}
```

---

### 9. EXTEND `src/clangd/clangdConfig.ts` (self-extend)

**Analog:** 现有 `defaultClangdConfig()` 函数 (第 63-194 行) — 模板风格配置生成器。

**defaultClangdConfig 注入点** (clangdConfig.ts 第 174-191 行):
```typescript
const result: ClangdConfig = {
  ...(pathMatch.length > 0 ? { If: { PathMatch: pathMatch } as IfBlock } : {}),
  CompileFlags: {
    CompilationDatabase: '.vscode/vscodeuehelper',
    Compiler: opts.compilerPath,
    Add: addFlags,
  },
  InlayHints: { Enabled: 'Yes', ParameterNames: 'Yes', DeducedTypes: 'Yes', Designators: 'Yes' },
  Diagnostics: { UnusedIncludes: 'None', MissingIncludes: 'None' },
};
```

**D-12 追加 Index 配置** (在 result 中追加,types.ts 已定义 `Index` 字段,见第 89-96 行):
```typescript
// types.ts 第 89-96 行已定义:
Index?: {
  Background?: 'Build' | 'Skip';
  StandardIndexCapacity?: number;
};

// clangdConfig.ts 应追加:
Index: {
  Background: 'Build',  // D-12: 启用 Background Index
  // StandardIndexCapacity: 5000000,  // 可选,大型项目降低内存占用
},
```

**renderClangdConfig 序列化** (clangdConfig.ts 第 199-202 行):
```typescript
export function renderClangdConfig(config: ClangdConfig): string {
  const doc = new yaml.Document(config);
  return doc.toString({ lineWidth: 0 });  // lineWidth=0 禁止自动折行
}
```

---

### 10. EXTEND `src/clangd/compileCommands.ts` (self-extend)

**Analog:** 自身 `generateCompileCommands()` (第 307-434 行) — UBT Task 入口。

**D-08 指纹快路径叠加位置** (compileCommands.ts 第 307-322 行):
```typescript
export async function generateCompileCommands(opts: GenerateOptions): Promise<string> {
  optsSignal = opts.signal;
  const log = opts.logger ?? new Logger('compileCommands');
  const projectName = path.basename(opts.project, '.uproject');
  const engineUri = vscode.Uri.file(opts.engineRoot);

  log.info(`[generateCompileCommands] ENTRY project=${opts.project}, ...`);

  // 1. 查找 UBT 路径（RunUBT.bat/sh 优先）
  const ubtAbsPath = await getUbtPath(engineUri);
  // ...
```

**D-08 在 UBT 调用前叠加指纹检查** (新插入位置):
```typescript
// 在 generateCompileCommands 内, optsSignal 赋值之后立即插入（不改 UBT 调用内部）:
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
await cache.write(projectDir, { fingerprint: fingerprint.fingerprint, ... });
```

**D-03 UBT 调用细化阶段插桩** (compileCommands.ts 第 384-434 行 — 5 个阶段):
- 阶段 1: `optsSignal` 设置
- 阶段 2: UBT 启动 (executeShellTask)
- 阶段 3: Task 完成
- 阶段 4: 文件查找 (candidates 循环)
- 阶段 5: linkToWorkspaceRoot

```typescript
// 包裹每个阶段:
const stageStart = performance.now();
await executeShellTask(ubtRelPath, args, opts.engineRoot, log, taskEnv);
perfLog.record({ event: 'ubt.taskCompleted', elapsedMs: performance.now() - stageStart });
```

---

### 11. EXTEND `src/clangd/preparseIncludes.ts` (self-extend)

**Analog:** 自身 `getPrepareIncludesList()` (第 70-76 行)。

**D-03 埋点 + D-13 性能注入**:
```typescript
let preparseStats = { hit: 0, miss: 0, lastReset: Date.now() };

export async function getPrepareIncludesList(
  mode: CompletionMode,
  projectPath: string,
  options?: { engineRoot?: string; perfSession?: PerfSession },
): Promise<string[]> {
  const base = await loadBundledList(mode);
  const merged = await mergeUserCustomizations(projectPath, base);

  // 在返回前调用 perfLog.record (埋点开销 ~0)
  const session = options?.perfSession;
  if (session) {
    session.recordPreparseResult(mode, base.length, merged.length - base.length);
  }
  return merged;
}

export function getPreparseStats(): { hit: number; miss: number; hitRate: number } {
  const total = preparseStats.hit + preparseStats.miss;
  return { ...preparseStats, hitRate: total === 0 ? 0 : preparseStats.hit / total };
}

export function resetPreparseStats(): void {
  preparseStats = { hit: 0, miss: 0, lastReset: Date.now() };
}
```

**向后兼容** — `options` 为可选参数,旧调用点 (completionMode.ts 第 126-129 行) 无需修改:
```typescript
const preparseHeaders = await getPrepareIncludesList(currentMode, projectPath);  // 不传 perfSession
```

---

### 12. EXTEND `src/clangd/index.ts` (self-extend)

**Analog:** 自身 `activateClangd()` (第 93-139 行) — 模块入口。

**现有激活流程** (index.ts 第 93-139 行):
```typescript
export function activateClangd(
  context: vscode.ExtensionContext,
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): ClangdHandles {
  const completionMode = new CompletionModeController(config);
  const backup = new WorkspaceBackup(...);
  const proxyManager = new ClangdProxyManager(context, config, logger);
  // ...

  void detection.ready.then((result) => {
    const project = result.projects[0];
    const engine = result.engines[0];
    if (project?.path) {
      completionMode.setProjectContext({ projectPath: project.path, ... });
    }
  });

  completionMode.show();
  context.subscriptions.push(config.onDidChange(...));
  // ...
  return { completionMode, backup, proxyManager };
}
```

**Phase 7 注入点** (在 existing code 之后、return 之前):
```typescript
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

logger.info('[clangd] activated (status bar + perf ready)');
return { completionMode, backup, proxyManager };
```

**Activation Order 影响** — 不需要改变:
```
1. initI18n
2. Logger + Config
3. activateDetection     ← projectDir 来源
4. activateBuild
5. activateClangd        ← Phase 7 修改点（新增 perfBar + watcher）
6. activateUI
7. activateCommands
```

---

### 13. EXTEND `src/extension.ts` (self-extend)

**无修改** — Phase 7 不需要改变 extension.ts。所有 perf 模块在 activateClangd 内部启动。`detection.ready` 已在 activateClangd 内 await 过。

---

### 14. EXTEND `package.json` (CONFIG)

**Analog:** 现有 `vscodeUEHelper.clangdProxy.enabled` 配置 (第 318-323 行):
```json
"vscodeUEHelper.clangdProxy.enabled": {
  "type": "boolean",
  "default": false,
  "description": "Enable clangd LSP proxy with didClose keepalive and localization.",
  "description@zh": "启用 clangd LSP 代理（didClose 保活和汉化支持）。"
},
```

**D-06 新配置 schema** (追加到 `contributes.configuration.properties`,约第 369 行后):
```json
"vscodeUEHelper.showPerfInStatusBar": {
  "type": "boolean",
  "default": true,
  "description": "Show performance metrics (compile_commands gen time, preparse cache hit rate, incremental scan latency) in status bar.",
  "description@zh": "在状态栏显示性能指标（compile_commands 生成耗时、preparse 缓存命中率、增量扫描延迟）。"
}
```

---

### 15. EXTEND `.gitignore` (CONFIG)

**Analog:** 现有排除规则 (第 39-43 行):
```
# Generated by extension (don't commit user workspace files)
compile_commands.json
.clangd
.vscode/.code-workspace.backup
.omo
```

**D-14 追加**:
```
# Generated by extension (don't commit user workspace files)
compile_commands.json
.clangd
.vscode/.code-workspace.backup
.vscode/clangd-perf-cache/    ← D-14
.omo
```

---

### 16. EXTEND `src/i18n/locales/{zh,en}.json`

**Analog:** 现有 `completion.fast` 命名 (zh.json 第 86 行):
```json
"completion.fast": "UE Clangd: 快速补全(精选宏)— 点击切换到慢速",
"completion.slow": "UE Clangd: 慢速补全(所有宏)— 点击切换到快速",
```

**D-04/D-05 新增 keys** (按命名空间 `perf.*`):
```json
{
  "perf.clangdGen.tooltip": "compile_commands.json 生成耗时 {ms}ms / Generated in {ms}ms",
  "perf.clangdGen.text": "Clangd: {seconds}s",
  "perf.preparseCache.tooltip": "preparse-includes 缓存命中率 {pct}% / Hit rate: {pct}%",
  "perf.preparseCache.text": "PI cache: {pct}%",
  "perf.incrementalScan.tooltip": "增量扫描延迟 {ms}ms (chokidar debounce) / Incremental scan: {ms}ms",
  "perf.incrementalScan.text": "Incr: {ms}ms",
  "perf.cacheHit": "缓存命中，跳过 UBT / Cache hit, skip UBT",
  "perf.cacheMiss": "缓存未命中，运行 UBT / Cache miss, running UBT",
  "perf.showInStatusBar": "在状态栏显示性能指标 / Show performance metrics in status bar"
}
```

---

## Integration Wiring (extension.ts activation sequence additions)

Phase 7 **不需要修改 `src/extension.ts`**,所有新模块在 `activateClangd()` 内部启动。

### `activateClangd` 集成顺序

```typescript
// src/clangd/index.ts:activateClangd
export function activateClangd(context, config, logger, detection): ClangdHandles {
  // 1. 现有初始化
  const completionMode = new CompletionModeController(config);
  const backup = new WorkspaceBackup(...);
  const proxyManager = new ClangdProxyManager(context, config, logger);
  const ueMacroCompletionProvider = registerUeMacroCompletionProvider();

  // 2. detection.ready → setProjectContext (现有)
  void detection.ready.then((result) => {
    // ...existing completionMode setup...
  });

  completionMode.show();
  context.subscriptions.push(/* existing onDidChange */);

  // ===== Phase 7 新增 ① =====

  // 3. perfBar 启动 (D-06 respect)
  if (config.showPerfInStatusBar) {
    const perfBar = new PerfStatusBar();
    context.subscriptions.push(perfBar);
    perfBar.show();
    context.subscriptions.push(
      perfLog.onMetricUpdate((metrics) => perfBar.update(metrics))
    );
  }

  // 4. IncrementalFileWatcher (D-15/D-16) — 在 detection.ready 后启动
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
      debounceMs: 100,
    });
    context.subscriptions.push(handle);
  });

  // 5. perfLog 初始化 (D-07 模式检测)
  if (isDevMode()) {
    logger.info(`[perf] dev mode detected, perf-log.json will be persisted`);
  } else {
    logger.info(`[perf] production mode, perf-log.json session-only`);
  }

  context.subscriptions.push({ dispose: () => completionMode.dispose() });
  context.subscriptions.push(ueMacroCompletionProvider);

  logger.info('[clangd] activated (status bar + perf ready)');
  return { completionMode, backup, proxyManager };
}
```

### `generateCompileCommands` 入口叠加 (D-08)

```typescript
// src/clangd/compileCommands.ts:generateCompileCommands
export async function generateCompileCommands(opts: GenerateOptions): Promise<string> {
  optsSignal = opts.signal;
  const log = opts.logger ?? new Logger('compileCommands');
  const projectDir = path.dirname(opts.project);

  // ===== Phase 7 新增 ① 指纹快路径 (D-08/D-09) =====
  const fpStart = performance.now();
  const fingerprint = await computeFingerprint(projectDir);
  const cache = new CompileCommandsCache();
  const cached = await cache.tryRead(projectDir);
  const fpMs = performance.now() - fpStart;

  if (cached && cached.fingerprint === fingerprint.fingerprint) {
    const ccStillExists = await fs.access(cached.ccPath).then(() => true).catch(() => false);
    if (ccStillExists) {
      perfLog.record({ event: 'compileCommands.cacheHit', elapsedMs: fpMs });
      log.info(`[perf] compileCommands cache HIT (fp ${fpMs.toFixed(1)}ms), skip UBT`);
      return cached.ccPath;
    }
  }
  perfLog.record({ event: 'compileCommands.cacheMiss', elapsedMs: fpMs });
  log.info(`[perf] compileCommands cache MISS (fp ${fpMs.toFixed(1)}ms), running UBT`);

  // ===== 原有逻辑不变 =====
  const engineUri = vscode.Uri.file(opts.engineRoot);
  log.info(`[generateCompileCommands] ENTRY project=${opts.project}, ...`);

  // ... 原有 UBT 执行 + 文件查找 + linkToWorkspaceRoot ...

  // ===== Phase 7 新增 ② 缓存写入 (D-08) =====
  await cache.write(projectDir, {
    fingerprint: fingerprint.fingerprint,
    ccPath: resultPath,           // 来自原有 candidates 循环返回的路径
    linkTarget: ...,              // 来自 linkToWorkspaceRoot 返回
    savedAt: new Date().toISOString(),
    fileCount: ...,               // 来自 fillMissingCompileCommands
  });
}
```

### Activation Order (不变)

```
1. initI18n
2. Logger + Config
3. activateDetection     ← projectDir 来源
4. activateBuild
5. activateClangd        ← Phase 7 修改点（perfBar + watcher 内部）
6. activateUI
7. activateCommands
```

`extension.ts` 不变 — 新模块都在 `activateClangd` 内部。

---

## Test Patterns (vitest)

### 测试文件结构模板 (来自 `test/unit/clangd/preparseIncludes.test.ts`)

**简单函数测试** — vitest describe/it/expect:
```typescript
// test/unit/clangd/preparseIncludes.test.ts:1-22
import { describe, it, expect } from 'vitest';
import { resolvePreparseHeaders, toIncludeFlags } from '@clangd/preparseIncludes';

describe('resolvePreparseHeaders', () => {
  it('将 $(EngineRoot) 占位符替换为实际 engineRoot 路径', () => {
    const headers = [
      '$(EngineRoot)/Source/Runtime/Core/Public/CoreSharedPCH.h',
      '$(EngineRoot)/Source/Runtime/Engine/Public/EngineSharedPCH.h',
    ];
    const result = resolvePreparseHeaders(headers, 'E:/UE_5.8');
    expect(result).toHaveLength(2);
    expect(result[0]).toBe('E:/UE_5.8/Source/Runtime/Core/Public/CoreSharedPCH.h');
  });
});
```

### File-I/O Fixture 模板 (来自 `test/unit/clangd/compileCommands.test.ts:1-74`)

**临时目录 + beforeEach/afterEach 清理**:
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { fillMissingCompileCommands } from '@clangd/compileCommands';

async function createFixture(): Promise<{
  tmpDir: string;
  projectPath: string;
  jsonPath: string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'compile-commands-test-'));
  const projectPath = path.join(tmpDir, 'MassTest.uproject');
  await fs.writeFile(projectPath, '{}', 'utf-8');

  const gameCppDir = path.join(tmpDir, 'Source', 'Game');
  await fs.mkdir(gameCppDir, { recursive: true });
  await fs.writeFile(path.join(gameCppDir, 'Game.cpp'), '// game code', 'utf-8');

  // ... 其他 fixture 文件 ...

  return { tmpDir, projectPath, jsonPath };
}

describe('fillMissingCompileCommands (插件源码补齐)', () => {
  let fixture: Awaited<ReturnType<typeof createFixture>>;

  beforeEach(async () => {
    fixture = await createFixture();
  });

  afterEach(async () => {
    await fs.rm(fixture.tmpDir, { recursive: true, force: true });
  });

  it('roots 包含 project Source 和 plugin Source', async () => {
    const result = await fillMissingCompileCommands(fixture.jsonPath, fixture.projectPath);
    // ...
  });
});
```

### `fingerprint.test.ts` 测试大纲

```typescript
import { describe, it, expect } from 'vitest';
import { computeFingerprint } from '@clangd/fingerprint';

describe('computeFingerprint', () => {
  // CLANGD-01-01.a: 相同输入 → 相同 fingerprint
  it('相同文件集合产出相同 fingerprint (确定性)', async () => {
    // 1. 准备 fixture: .uproject + Build.cs + Target.cs
    // 2. 调两次 computeFingerprint,断言 hex 相同
  });

  // CLANGD-01-01.b: Build.cs 注释改动 → fingerprint 变化
  it('Build.cs 内容变化触发 fingerprint 变化', async () => {
    // 1. fp1 = computeFingerprint(dir)
    // 2. 修改 Build.cs 加注释
    // 3. fp2 = computeFingerprint(dir)
    // 4. assert fp1 !== fp2
  });

  // 边界: mtime 变化但内容相同 → 同 fingerprint
  it('mtime 变化但内容相同, fingerprint 保持稳定', async () => {
    // 1. fp1 = computeFingerprint(dir)
    // 2. fs.utimes 改 mtime
    // 3. fp2 = computeFingerprint(dir)
    // 4. assert fp1 === fp2 (SHA256 是内容哈希,不是 mtime 哈希)
  });

  // 边界: 空 Source/ 目录
  it('空 Source/ 目录返回稳定空 fingerprint', async () => {
    // 1. fixture: 只有 .uproject
    // 2. fp = computeFingerprint(dir)
    // 3. assert fp.fingerprint 是 64 字符 hex
    // 4. 不抛错
  });
});
```

### `compileCommandsCache.test.ts` 测试大纲

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { CompileCommandsCache } from '@clangd/compileCommandsCache';

describe('CompileCommandsCache', () => {
  let tmpDir: string;
  beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'cc-cache-test-')); });
  afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

  it('tryRead 返回 undefined 当 cache 文件不存在', async () => {
    const cache = new CompileCommandsCache();
    const result = await cache.tryRead(tmpDir);
    expect(result).toBeUndefined();
  });

  it('write 后 tryRead 能读回相同数据', async () => {
    const cache = new CompileCommandsCache();
    const entry = {
      fingerprint: 'abc123...',
      ccPath: path.join(tmpDir, 'compile_commands.json'),
      linkTarget: path.join(tmpDir, '.vscode', 'vscodeuehelper', 'compile_commands.json'),
      savedAt: new Date().toISOString(),
      fileCount: 100,
    };
    await cache.write(tmpDir, entry);
    const result = await cache.tryRead(tmpDir);
    expect(result).toEqual(entry);
  });

  // CLANGD-01-01.d: 缓存失效 (fingerprint 不匹配)
  it('不同 fingerprint 视为 cache miss (不返回缓存数据)', async () => {
    // 1. write cache with fp = 'A'
    // 2. tryRead 后, caller 比较 fingerprint 不匹配
    // 3. 实际场景由 compileCommands.ts 实现, 单测只验证 cache.tryRead 总是返回最新 entry
  });

  // Security: 写盘大小限制
  it('写入超大 entry 拒绝 (5MB 软上限)', async () => {
    // 1. entry.fingerprint 重复到 > 5MB
    // 2. await expect(cache.write(tmpDir, huge)).rejects.toThrow('too large');
  });

  // Security: 原子写入
  it('write 使用 temp + rename 避免半写入', async () => {
    // 1. write cache
    // 2. 验证 .tmp 文件不存在 (已被 rename)
    // 3. 验证 cache.json 存在且内容完整
  });
});
```

### `perfLog.test.ts` 测试大纲

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { perfLog, isDevMode } from '@clangd/perfLog';

describe('perfLog', () => {
  beforeEach(() => {
    // 重置 in-memory 状态
  });

  it('record 同步入内存, 不阻塞', () => {
    const t0 = performance.now();
    perfLog.record({ event: 'test.event', elapsedMs: 42 });
    const t1 = performance.now();
    expect(t1 - t0).toBeLessThan(1);  // 同步开销 < 1ms
  });

  it('getPreparseHitRate 计算正确', () => {
    // 1. record({event: 'preparse.hit', ...}) x3
    // 2. record({event: 'preparse.miss', ...}) x1
    // 3. expect getPreparseHitRate().rate === 0.75
  });

  // D-18.a: 模式自适应
  it('dev 模式 flushToDisk 写盘', async () => {
    // vi.mock vscode.ExtensionMode.Development
    // 1. record({event: 'test', elapsedMs: 1})
    // 2. await perfLog.flushToDisk()
    // 3. expect fs.access(cachePath) 存在
  });

  it('prod 模式 flushToDisk 是 no-op', async () => {
    // vi.mock vscode.ExtensionMode.Production
    // 1. record(...)
    // 2. await perfLog.flushToDisk()
    // 3. expect cache 文件不存在
  });

  // D-18.b: 轮转压缩
  it('100MB 阈值触发轮转', async () => {
    // 1. 模拟 perf-log.json > 100MB
    // 2. await flushToDisk()
    // 3. expect 原文件被重命名为 perf-log.<timestamp>.jsonl.gz
    // 4. expect 新建空 perf-log.json
  });
});
```

### `fileWatcher.test.ts` 测试大纲 + chokidar mock

**必须在 `test/unit/setup.ts` 追加 chokidar mock** (Pitfall 6 防御):
```typescript
// test/unit/setup.ts 追加（在现有 vi.mock('vscode', ...) 之后）
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    })),
  },
}));
```

```typescript
// test/unit/clangd/fileWatcher.test.ts
import { describe, it, expect, vi } from 'vitest';
import chokidar from 'chokidar';
import { IncrementalFileWatcher } from '@clangd/fileWatcher';

describe('IncrementalFileWatcher', () => {
  // CLANGD-01-03.a: debounce flush 耗时 < 200ms
  it('chokidar 事件经 100ms debounce 后 flush', async () => {
    const watcher = new IncrementalFileWatcher();
    const batches: unknown[] = [];
    watcher.onBatch = (b) => batches.push(b);

    const start = performance.now();
    const handle = watcher.start({
      patterns: ['/test/**/*.h'],
      debounceMs: 100,
    });

    // 模拟 chokidar emit 'change' 事件
    const mockWatcher = (chokidar.watch as ReturnType<typeof vi.fn>).mock.results[0].value;
    mockWatcher.on.mock.calls
      .filter(([event]: [string]) => event === 'change')
      .forEach(([, handler]: [(...args: unknown[]) => unknown, (path: string) => void]) => {
        handler('/test/foo.h');
        handler('/test/bar.h');
      });

    // 等待 debounce flush
    await new Promise((r) => setTimeout(r, 150));
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);  // CLANGD-01-03.a
    expect(batches.length).toBeGreaterThan(0);

    handle.dispose();
  });

  // CLANGD-01-03.b: 头文件 vs 源文件分级
  it('按扩展名分级 headerCount vs sourceCount', async () => {
    // emit change /test/foo.h (header) + /test/foo.cpp (source)
    // assert IncrementalBatch.headerCount === 1
    // assert IncrementalBatch.sourceCount === 1
  });

  // dispose 清理 chokidar watcher
  it('dispose() 关闭 chokidar watcher', () => {
    const watcher = new IncrementalFileWatcher();
    const handle = watcher.start({ patterns: ['/test'], debounceMs: 100 });
    handle.dispose();
    // assert mockWatcher.close 被调用
  });
});
```

### `scripts/measure-proxy-overhead.mjs` 模式 (ESM 脚本)

**Analog:** 现有 `esbuild.config.mjs` / `test/integration/runTests.js` (ESM `.mjs` 格式)。

```javascript
// scripts/measure-proxy-overhead.mjs
#!/usr/bin/env node
/**
 * measure-proxy-overhead.mjs —— 测量 LSP proxy 协同开销
 *
 * CLANGD-01-04 验证：PLAN A 注入前后基线偏差 < 1% 即认为零开销达成。
 *
 * 使用方法：
 *   1. 关闭所有 VSCode 实例
 *   2. node scripts/measure-proxy-overhead.mjs --baseline > baseline.json
 *   3. 编译 + 加载 PLAN A 代码
 *   4. node scripts/measure-proxy-overhead.mjs --after > after.json
 *   5. node scripts/measure-proxy-overhead.mjs --diff baseline.json after.json
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';

const MODE = process.argv.includes('--baseline') ? 'baseline'
           : process.argv.includes('--after') ? 'after'
           : process.argv.includes('--diff') ? 'diff'
           : 'help';

if (MODE === 'help') {
  console.log('Usage: node scripts/measure-proxy-overhead.mjs [--baseline|--after|--diff a.json b.json]');
  process.exit(0);
}

async function measureOnce() {
  const samples = [];
  for (let i = 0; i < 100; i++) {
    const t0 = performance.now();
    // 模拟单条 LSP textDocument/completion 请求
    // (实际通过 child_process 启动 clangd LSP proxy 测试)
    await sendLspRequest('textDocument/completion', { ... });
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  return {
    p50: samples[50],
    p95: samples[95],
    p99: samples[99],
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    mem: process.resourceUsage(),
  };
}

if (MODE === 'baseline' || MODE === 'after') {
  const result = await measureOnce();
  const json = JSON.stringify(result, null, 2);
  if (MODE === 'baseline') writeFileSync('baseline.json', json);
  else if (MODE === 'after') writeFileSync('after.json', json);
  console.log(json);
}

if (MODE === 'diff') {
  const a = JSON.parse(await readFile(process.argv[3]));
  const b = JSON.parse(await readFile(process.argv[4]));
  const p95Delta = Math.abs(b.p95 - a.p95) / a.p95;
  const memDelta = Math.abs(b.mem.maxRSS - a.mem.maxRSS) / a.mem.maxRSS;
  console.log(`p95 delta: ${(p95Delta * 100).toFixed(2)}%`);
  console.log(`mem delta: ${(memDelta * 100).toFixed(2)}%`);
  if (p95Delta < 0.01 && memDelta < 0.01) {
    console.log('✅ Zero-overhead achieved');
    process.exit(0);
  } else {
    console.error('❌ Overhead exceeds 1% threshold');
    process.exit(1);
  }
}
```

---

## Shared Patterns (cross-cutting concerns)

### 1. Logger 注入 + 前缀模式 (适用于所有新模块)

**Source:** `src/core/logger.ts` 整个 Logger 类
**Apply to:** `perfLog.ts`, `fingerprint.ts`, `compileCommandsCache.ts`, `headerCache.ts`, `perfProxy.ts`, `fileWatcher.ts`, `perfStatusBar.ts`

```typescript
// 所有新模块接受 logger: Logger 参数 (DI 模式)
export class XxxService {
  constructor(private readonly logger: Logger) {}
  // 内部使用 this.logger.info('[xxx] message')
}
```

**Logger 构造调用** (从 extension.ts 第 22 行):
```typescript
logger = new Logger('VSCodeUEHelper');
// 各模块按需 new Logger('perfLog') / new Logger('fingerprint') 等
```

### 2. Disposable 注册模式 (所有持有 VS Code 资源的模块)

**Source:** `src/clangd/index.ts` 第 122-131 行 + `src/clangd/workspaceBackup.ts` 第 85-87 行
**Apply to:** 所有 startXxx() / watchXxx() 方法

```typescript
// 模式 1: context.subscriptions.push (推荐)
context.subscriptions.push({ dispose: () => this.cleanup() });

// 模式 2: 返回 vscode.Disposable (推荐用于 sub-resources)
startWatching(): vscode.Disposable {
  this.watcher = ...;
  return new vscode.Disposable(() => {
    this.watcher?.dispose();
  });
}
```

### 3. i18n 双语模式 (适用于所有用户可见字符串)

**Source:** `src/i18n/index.ts:initI18n()` + `t()` 函数
**Apply to:** 状态栏 tooltip、perfBar 文本、错误消息

```typescript
import { t } from '@i18n';
this.statusBarItem.tooltip = t('perf.clangdGen.tooltip', { ms: String(elapsedMs) });
```

**locale 文件追加** (zh.json 第 86-87 行风格):
```json
"perf.clangdGen.tooltip": "compile_commands.json 生成耗时 {ms}ms / Generated in {ms}ms"
```
中英文案用 `/` 分隔 — i18n 模块直接返回原文,不解析。

### 4. 路径别名导入 (适用于所有新模块)

**Source:** `vitest.config.ts` 第 27-41 行 alias 配置 + `tsconfig.json`
**Apply to:** 所有 import 路径

```typescript
import { Logger } from '@core/logger';           // ✅ 别名
import { Config } from '@core/config';           // ✅ 别名
import { computeFingerprint } from './fingerprint';  // ✅ 同目录相对路径
import { computeFingerprint } from '../clangd/fingerprint';  // ❌ 禁止
```

### 5. try/catch + logger.error 错误处理 (适用于所有 IO 路径)

**Source:** `src/clangd/compileCommands.ts:fillMissingCompileCommands` 第 727-733 行
**Apply to:** 所有 fs.readFile / fs.writeFile / fs.stat 调用

```typescript
try {
  const content = await fs.readFile(jsonPath, 'utf-8');
  return JSON.parse(content) as CachedEntry;
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error(`[cache] failed to read ${jsonPath}: ${msg}`);
  return undefined;  // cache miss = 不抛错,降级到原始路径
}
```

### 6. Detection 等待 + projectPath 注入模式

**Source:** `src/clangd/index.ts` 第 106-118 行
**Apply to:** `perfStatusBar`, `fileWatcher` (需要 projectDir)

```typescript
void detection.ready.then((result) => {
  const project = result.projects[0];
  if (!project?.path) {
    logger.warn('[xxx] no projectPath available: skip');
    return;
  }
  const projectDir = path.dirname(project.path);
  // ... 用 projectDir 启动服务
});
```

### 7. atomic write + temp file (适用于所有持久化)

**Source:** `src/clangd/compileCommands.ts:linkToWorkspaceRoot` 第 513-516 行
**Apply to:** `compileCommandsCache.write`, `perfLog.flushToDisk`, `headerCache`

```typescript
const tmpPath = `${targetPath}.tmp`;
await fs.writeFile(tmpPath, json, 'utf-8');
await fs.rename(tmpPath, targetPath);
```

### 8. chokidar mock (测试文件必备)

**Source:** Pitfall 6 防御 (RESEARCH §Common Pitfalls)
**Apply to:** `test/unit/setup.ts` 一次性追加 + 所有 fileWatcher.test.ts

```typescript
// test/unit/setup.ts 末尾追加
vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      close: vi.fn(),
    })),
  },
}));
```

---

## No Analog Found

文件无现成匹配,planner 应使用 RESEARCH.md 模式:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/clangd/fingerprint.ts` | utility | file-I/O + hash | 项目无现成 hash 工具; 仅 `node:crypto` 内置可用 |
| `src/clangd/perfProxy.ts` | service | measurement | 项目无现成 perf measurement 模式; 需手工注入 LSP 帧时间戳 |
| `src/clangd/fileWatcher.ts` | utility | event-driven | 项目仅用 `vscode.workspace.createFileSystemWatcher`,不熟 chokidar 模式; RESEARCH §Feature 3 推荐用 chokidar 替代 |
| `scripts/measure-proxy-overhead.mjs` | script | measurement | 项目无现成 perf baseline 脚本; 需手工实现 |

---

## Metadata

**Analog search scope:** `src/clangd/`, `src/core/`, `src/ui/`, `src/commands/`, `test/unit/clangd/`, `package.json`, `.gitignore`, `vitest.config.ts`
**Files scanned:** 35+
**Pattern extraction date:** 2026-07-04
**Phase 7 ANALOG 覆盖率:** 18 / 21 = 86% (3 个全新模块无现成 analog,需遵循 RESEARCH.md 推荐方案)