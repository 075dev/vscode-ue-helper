# Phase 7: clangd 性能优化 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-04
**Phase:** 7-clangd-performance-optimization
**Areas discussed:** 性能瓶颈识别, compile_commands.json 生成, preparse-includes 缓存, 增量扫描机制, 用户可见度量面板, 验证策略, 持久化模式自适应, Phase 7 拆分

---

## Area 1: 性能瓶颈识别

| Option | Description | Selected |
|--------|-------------|----------|
| 加插桩计时器 | 关键函数 mtime/perf_hooks，Output 报告 | |
| 独立 benchmark 脚本 | 控制项目上跑出三指标基线 | |
| 两者都要 | 先插桩后 benchmark | ✓ |

**User's choice:** 两者都要，先插桩后 benchmark
**Notes:** 用户倾向"实测优先"——避免凭直觉过度设计

### 1.2 — 插桩数据输出载体

| Option | Description | Selected |
|--------|-------------|----------|
| 仅 Output 面板 | 实时输出，session 内可见 | |
| 仅持久 .vscode/perf-log.json | 跨会话持久 | |
| 两者都要 | 实时 Output + 持久 json | ✓ |

### 1.3 — 插桩位置深度

| Option | Description | Selected |
|--------|-------------|----------|
| 仅功能入口探针 | 4 个外部命令入口 | |
| 入口 + UBT 调用细化 | 加 UBT/preparse IO/缓存查询 | ✓ |

### 1.4 — 性能面板位置

| Option | Description | Selected |
|--------|-------------|----------|
| Status Tab 加 Performance 折叠区 | 在现有控制面板追加 | |
| 新增独立 Performance Tab | 重量级新增 | |
| 用状态栏展示 | 状态栏三段轻量 | ✓ |

**User's choice:** 状态栏展示
**Notes:** 用户主动避免新建 Tab，保持 Phase 7 简洁

---

## Area 2: compile_commands.json 生成策略

| Option | Description | Selected |
|--------|-------------|----------|
| 增量修复路径 | 指纹命中跳过 UBT | ✓ |
| UBT 缓存复用 | mtime 对比 | |
| 并发生成 | 子模块并发 + JSON merge | |
| 外部缓存覆写 | 编译产物推导 | |

**User's choice:** 增量修复路径（推荐）

### 2.2 — 增量指纹依据

| Option | Description | Selected |
|--------|-------------|----------|
| 内容哈希指纹（SHA256） | 拼接 .uproject + Build.cs + Target.cs | ✓ |
| mtime + 大小指纹 | 省 IO，漏 body 变化 | |
| UBT 版本号指纹 | 保守安全但命中率低 | |

### 2.3 — Phase 7 拆分

| Option | Description | Selected |
|--------|-------------|----------|
| 在 Phase 7 整体交付 | 同时上指纹 + 并发 | |
| Phase 7 仅交指纹缓存 | 并发推下阶段 | |
| 需拆分两个计划 | PLAN A 指纹 + PLAN B 并发 | ✓ |

**User's choice:** 需拆分两个计划

---

## Area 3: preparse-includes 缓存

| Option | Description | Selected |
|--------|-------------|----------|
| 重看现有缓存逻辑 | 调研 completionFiles.ts / preparseIncludes.ts | ✓ |
| UE 头指纹缓存 | UE 版本作为 key | ✓ |
| 动态识别热路径 | 识别 .Build.cs 依赖子集 | ✓ |
| 跨会话持久缓存 | .vscode 目录 | ✓ |

**User's choice:** 全选
**Notes:** 重点是「先调研，避免重复设计」作为 PLAN A 前置

### 3.2 — 缓存粒度

| Option | Description | Selected |
|--------|-------------|----------|
| 按需增量 | 头文件 + mtime/hash 按需填充 | ✓ |
| 全量缓存 | 一次缓存全部 2000+ 头 | |
| Module 粒度 | 按 Module 划分 | |

### 3.3 — 缓存存储位置

| Option | Description | Selected |
|--------|-------------|----------|
| .vscode 缓存目录 | 项目本地，不提交 git | ✓ |
| 全局缓存目录 | OS 缓存 | |
| workspaceStorage | VS Code 管理 | |

---

## Area 4: 增量扫描机制

| Option | Description | Selected |
|--------|-------------|----------|
| VS Code FileSystemWatcher | 全量监控 | |
| 依赖 clangd didChangeWatchedFiles | 上游事件驱动 | |
| LSP Proxy pubsub | 代理参与 | |
| 手动触发 + debounce | 手动 debounce | |

**User's choice:** 由你自行抉择，我不太懂
**Notes:** 完全由 agent 决定（D-15 已记入 discretion）

### 4.2 — 扫描粒度

| Option | Description | Selected |
|--------|-------------|----------|
| 头为主，源次优先 | 头变化触发重算 | ✓ |
| 全部同等 | 无优先级区分 | |
| 边界外不触发 | 不动 clangd PCH | |

### 4.3 — 延迟验证

| Option | Description | Selected |
|--------|-------------|----------|
| 集成测试 + 状态栏 | 必须 < 200ms | ✓ |
| 仅插桩 | 不严格 | |
| 手动边调试运行 | 推迟测试 | |

---

## Area 5: 状态栏 Performance 项细节

### 5.1 — 三段 vs 单点 vs 警告式

| Option | Description | Selected |
|--------|-------------|----------|
| 三段状态栏项 | ready / cache / incr | ✓ |
| 单点 + 折叠 | 点击展开 Output | |
| 警告式 | 仅警告时才出现 | |

### 5.2 — 阈值可视化

| Option | Description | Selected |
|--------|-------------|----------|
| 三色阈值（绿/黄/红） | 图标/色块区分 | ✓ |
| 纯数字 | 无可视化 | |
| 纯文本 | 不需 | |

### 5.3 — 可重置/可关闭

| Option | Description | Selected |
|--------|-------------|----------|
| 加 setting 控扭 | 用户可关闭 | ✓ |
| 不需控扭 | 始终显示 | |

---

## 持久化方案（area 杂项）

| Option | Description | Selected |
|--------|-------------|----------|
| 保留轮转压缩归档 | 100MB / 7 天 / 5 文件 | (开发模式) |
| 仅 session 内存 | 不持久 | (打包后) |

**User's choice:** 开发模式保留轮转压缩归档，打包后仅内存，不持久化
**Notes:** 「我希望它在我编写插件的时候，可以保留...打包后就仅内存」

---

## 验证策略

| Option | Description | Selected |
|--------|-------------|----------|
| 单测+集成+手测 | 三层覆盖 | ✓ |
| 仅单测 | 中等 | |
| 跳过测试靠手测 | 弱 | |

---

## the agent's Discretion

- **增量扫描路径 (D-15)** — 用户明确「由你自行抉择，我不太懂」，agent 在 PLAN 中给出选定理由
- **LSP shared cache 协议 (D-12)** — 仅描述意图，具体协议由 agent 在 PLAN B 中细化
- **状态栏交互行为 (D-04)** — 点击进入详细面板 / drop-down / 跳转 Output 由 agent 决定

---

## Deferred Ideas

- **诊断增强（Phase 10）**：UE 编译错误 code action、Module 依赖建议 — 已记
- **代码理解增强（Phase 8）**：类型补全、跳转定义穿透 — 已记
- **工具链集成（Phase 9）**：UE 编辑器双向通信、Hot Reload 联动 — 已记
- **状态栏趋势曲线面板**：未来控制面板 Status Tab 追加 — 已记
- **跨平台性能上报**：不在 Phase 7 范畴
