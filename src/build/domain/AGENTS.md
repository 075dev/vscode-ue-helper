<!-- Parent: ../AGENTS.md -->
# build/domain —— DDD 参考用领域层

> 治理参考：`.specify/memory/constitution.md` §V（Minimal, Traceable, Reversible Evolution）。**本目录当前仅作参考**，业务代码继续从 `src/build/` 顶层 import（`import { runBuild } from '@build'`），不走 `domain/` 路径。

## 当前状态

- **`application/` / `infrastructure/` 空壳已删除**（H3 决策 A，REMEDIATION-PLAN §十二）；DDD 三层未启用
- **业务代码不依赖本目录** —— 全部从 `src/build/` 顶层模块引用
- **`domain/entities/ubt-task.entity.ts` 有完整测试**（`test/unit/build/domain/entities/ubt-task.entity.test.ts`），可作为后续 DDD 迁移的参考实现
- **何时重新引入 DDD 三层** —— 等业务复杂度增长时再评估（宪法 §V：minimal evolution，禁投机抽象）

## 子目录

| 目录               | 用途                                                       |
| ------------------ | ---------------------------------------------------------- |
| `entities/`        | 领域实体（含 `ubt-task.entity.ts` + 对应测试）             |
| `value-objects/`   | 值对象（无 ID 的不可变类型）                                |
| `events/`          | 领域事件                                                   |
| `services/`        | 领域服务（无状态业务规则）                                  |
| `repositories/`    | 仓储接口（具体实现在 `src/build/` 顶层）                   |
| `index.ts`         | barrel re-export（仅供将来 DDD 迁移使用，业务层不要 import）|

## 迁移触发条件

满足以下任一条件时可考虑把 `src/build/` 重构为完整 DDD 三层：

1. `src/build/buildRunner.ts` 行数 > 500
2. 出现 ≥ 3 个独立的 build 子流程（compile / link / cook / stage）需要分别演进
3. 出现需要"事务一致性"边界的复杂业务规则

**当前不满足任何一条**——保留 `@build` 顶层模块即可。
