# Phase 7: clangd 性能优化 - Context

**Gathered:** 2026-07-04
**Status:** Ready for planning

<domain>
## Phase Boundary

提升 clangd 在大型 UE C++ 工程（>5000 文件）中的运行效率：compile_commands.json 生成加速、
preparse-includes 缓存命中、文件变更增量扫描、与 LSP Proxy 协同无额外开销。

阶段仅交付**性能优化 + 用户可见度量**（状态栏 + 输出通道），不涉及面板 UI 扩展、不动 Phase 8
之后的代码理解/工具链逻辑。

</domain>

<decisions>
## Implementation Decisions

### 性能瓶颈识别与度量
- **D-01:** 性能度量采用「先插桩后 benchmark」双轨方案，先实现阶段用插桩定位热点，
  同一代码路径后期补充独立 benchmark 脚本产出基线数字
- **D-02:** 插桩数据双载体：实时输出到 Output 面板（前缀 `[perf]`）+ 持久化到 `.vscode/clangd-perf-cache/perf-log.json`
- **D-03:** 插桩粒度：入口（4 个外部命令入口）+ UBT 调用细化阶段（UBT 调用、preparse 文件 IO、缓存查询点）
- **D-04:** 性能可视化用状态栏三段：`[Clangd: 🟢 3.2s]`（生成耗时）+ `[PI cache: 82%]`（命中率）+ `[Incr: 120ms]`（增量扫描延迟）
- **D-05:** 阈值三色可视化：以 Phase 7 成功标准设定阈值（<5s 绿、<10s 黄、>10s 红），状态栏以图标/色块区分
- **D-06:** 新增 `vscodeUEHelper.showPerfInStatusBar` setting 控扭，用户可手动关闭状态栏性能项
- **D-07:** `perf-log.json` 模式自适应：开发模式（`vsce` 调试 / `extensionMode === Development`）保留轮转
  压缩归档（100MB / 7 天 / 5 文件）；打包后（生产模式）仅 session 内存，不持久化

### compile_commands.json 生成
- **D-08:** 生成策略 = 增量修复路径：本地有缓存且指纹命中时跳过 UBT，直接复用历史 compile_commands.json
- **D-09:** 增量指纹依据 = 内容哈希指纹（`.uproject` + `*.Build.cs` + `Target.cs` 的 SHA256 拼接）
- **D-10:** Phase 7 拆分 2 个 PLAN：
  - **PLAN A** = 内容哈希指纹 + 增量缓存层（不含 UBT 并发）
  - **PLAN B** = UBT 调用细化阶段插桩 + 与 LSP proxy 协同优化（按需启动并发合并）

### preparse-includes 缓存
- **D-11:** 先调研 `src/clangd/completionFiles.ts` 与 `src/clangd/preparseIncludes.ts` 已存在的缓存机制，
  避免重复设计；调研结论作为 PLAN A 前置依赖
- **D-12:** 缓存策略 = UE 头指纹缓存 + 动态识别热路径 + 与 clangd 共享 `.cache` 目录
- **D-13:** 缓存粒度 = 按需增量：按「头文件路径 + mtime/content hash」填充，避免一次缓存 2000+ 头
- **D-14:** 缓存存储位置 = `.vscode/clangd-perf-cache/`（项目本地，由 `.gitignore` 排除）

### 增量扫描机制
- **D-15:** 实现路径由 agent 决定，建议优先级：VS Code `FileSystemWatcher` + debounced 批处理
  （100ms）为基础，与 `clangd didChangeWatchedFiles` LSP 联动（去重）
- **D-16:** 扫描粒度 = 头文件为主（`.h`/`.hpp`/`.inl`，高优先级触发重算）+ 源文件次优先
- **D-17:** 增量扫描延迟 < 200ms 的验证方式 = 单元测试（事件触发延迟）+ 集成测试（`onDidChange`
  到完成耗时）+ 状态栏三段指标实时可视

### 阶段验证
- **D-18:** 三层验证 = 单元测试（指纹计算 + 缓存命中逻辑）+ 集成测试（模拟激活流和文件变更事件）+
  手动测试（>5000 文件项目验证 < 5s / >80% / < 200ms 三个阈值）

### the agent's Discretion
以下事项未深度讨论，由 agent 在规划时根据代码上下文决定：
- 增量扫描具体的 watcher/debounce 策略与 LSP 联动方式（D-15 仅给优先级，不锁实现）
- 与 clangd 共享 `.cache` 目录的具体协议（D-12，仅描述意图）
- 状态栏按钮点击的交互行为（跳转到 Output 面板或展开详细悬停 — agent 决定）

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### 项目规划层
- `.planning/ROADMAP.md` § Phase 7 — 阶段目标 + 成功标准（v1.2 clangd 性能优化的总览）
- `.planning/STATE.md` § Current Position — 当前 v1.2 re-scoped 后的状态
- `.planning/REQUIREMENTS.md` § CLANGD-01 — 4 个 success criteria 子项
- `.planning/PROJECT.md` § Constraints — LSP 3.17 协议 / 不修改 upstream clangd 的约束

### 代码库现状
- `.planning/codebase/STRUCTURE.md` — `src/clangd/` 目录布局
- `.planning/codebase/ARCHITECTURE.md` § 81-88 — `compileCommands.ts` / `completionFiles.ts` / `preparseIncludes.ts` 三件套定位
- `.planning/codebase/INTEGRATIONS.md` § 4 — clangd LSP 集成（直连 vs 代理两条路径）

### 现有相关代码（必须先读，再设计）
- `src/clangd/compileCommands.ts` — 现行 compile_commands.json 生成入口（D-08 增量修复的对接点）
- `src/clangd/completionFiles.ts` — UE preparse 头文件清单（D-11 调研对象）
- `src/clangd/preparseIncludes.ts` — preparse 缓存处理（D-11 调研对象）
- `src/clangd/clangdConfig.ts` — `.clangd` 配置文件注入（D-12 与 clangd 共享 cache 的对接点）
- `src/clangd/proxy/` — LSP proxy 子目录（D-10 PLAN B 中与 proxy 协同优化相关）

### 配置文件
- `package.json` § `contributes.configuration` — setting 注册位置（D-06 新增 `vscodeUEHelper.showPerfInStatusBar` 的登记处）
- `.gitignore` — 排除 `.vscode/clangd-perf-cache/`（D-14 配套）

### 验证目标（vscode-clangd 行为）
- 官方 clangd 文档：`--limit-results` / `--pch-storage` / `BackgroundIndex` —
  通过 `.clangd` 配置文件间接控制的开关（不直接调参数，通过 clangdConfig.ts 注入）

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/logger.ts` — 结构化日志输出，可注入 `[perf]` 前缀（D-02 Output 输出直接复用）
- `src/ui/statusBar.ts` — 已有 11 个状态栏按钮（D-04 / D-05 三段性能项追加，沿用相同 disposable 模式）
- `src/core/config.ts` — 配置强类型封装（D-06 `showPerfInStatusBar` setting 包装）
- `src/clangd/compileCommands.ts` 已有生成函数，PLAN A 仅在此函数上叠加指纹缓存层（D-08）

### Established Patterns
- **i18n 优先**：状态栏文案必须通过 `t()` 双语化（与 Phase 6 控制面板标签同等约束）
- **Disposable 模式**：所有 VS Code 资源推入 `context.subscriptions`，性能状态栏项 dispose 清理
- **Promise-based**：所有异步插桩计时用 `performance.now()` 包裹，不阻塞主流程
- **globalState 持久化**：状态栏显隐偏好用 `context.globalState` 备份（用户跨 session 期望保持）

### Integration Points
- 性能输出 → `src/core/logger.ts` 的 outputChannel.appendLine（D-02 实时输出）
- 性能持久化 → 新建 `src/clangd/perfLog.ts` 模块（D-02 / D-07 / D-14 三件套配套）
- 状态栏按钮 → `src/ui/statusBar.ts` 扩展（D-04 / D-05）
- UBT 调用细化 → `src/clangd/compileCommands.ts` 内部插桩（D-03 入口之一）
- FileSystemWatcher → `src/clangd/` 下新建 `fileWatcher.ts`，与 watch 调度对齐

</code_context>

<specifics>
## Specific Ideas

- 用户期望 Phase 7 「**实测优先**」：先有插桩数据，再决定是否需要并发/缓存层优化，避免凭直觉过度设计
- 用户偏好**模式自适应持久化**：开发者环境保留历史数据，便于复现和调优；生产环境（用户机器）不污染磁盘
- Phase 7 状态栏可点击进入详细面板（drop-down 或跳到 Output Channel）；具体交互 agent 决定（D-15 已记入 discretion）
- 缓存失效要严格（D-09 SHA256 内容哈希避免漏 body-only 变化）

用户对「Agent 自主决策」在增量扫描路径上明确表态：
> 「由你自行抉择，我不太懂」 — D-15 完全由 agent 选定，但需在下个阶段 PLAN 中给出选定理由

</specifics>

<deferred>
## Deferred Ideas

- **诊断增强（Phase 10 主题）**：UE 编译错误 code action、Module 依赖建议 — 不在 Phase 7 范畴
- **代码理解增强（Phase 8）**：类型补全、跳转定义穿透 — 不动
- **工具链集成（Phase 9）**：UE 编辑器双向通信、Hot Reload 联动 — 不动
- **状态栏性能数据的曲线趋势面板**：未来考虑在控制面板的 Status Tab 追加，不在 Phase 7（用户明确选择「状态栏够用」，不新建 Performance Tab）
- **集成 XCode/MSVC 流式性能上报**：跨平台测试打通不属本阶段

</deferred>

---

*Phase: 7-clangd 性能优化*
*Context gathered: 2026-07-04*
