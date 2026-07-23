# Phase 6 Design: 6 个汉化 TODO 决断

**Phase 编号**: 6
**REQ-IDs**: (无 —— 是僵尸承诺清理,不是新需求)
**估算**: 4-6h(选 A) / 8-12h(选 B)

## 为什么做

仓库有 6 个"汉化 TODO"僵尸承诺(per `.planning/codebase/CONCERNS.md` + AGENTS.md 仓库陷阱 #13):

- `src/clangd/proxy/localization.ts:79 / 91 / 103` 各 1 处
- `src/clangd/proxy/bridge.ts:676 / 685 / 694` 各 1 处

每处都写 "后续实现" 但**未排进任何 phase**,在 `src/clangd/proxy/AGENTS.md` 也明确"当前不生效(TODO)"。

问题:

- **历史欠账**: 仓库 README 与 marketplace 描述曾暗示"汉化生效",但实际 no-op,用户期待落差
- **代码噪音**: TODO 注释 + 死代码路径增加 cognitive load,新人看到"汉化"会尝试启用
- **Phase 5 决策未决**: Phase 5 Live Coding AI 设计提到"汉化"做 AI 上下文,如果汉化 no-op 则 Phase 5 的"汉化上下文增强"无意义

## 二选一

### 选项 A: 下架汉化承诺(推荐)

**做法**:

1. 删除 6 处 TODO 标记 + 死代码(if `ueDocLookup` 命中时插入汉化的逻辑)
2. 从 `src/clangd/proxy/AGENTS.md` 删除"汉化(TODO)"段
3. README + Marketplace 描述移除"汉化"卖点
4. 后续 phase 真正要做时,作为新 phase(独立 RFC)

**优点**:

- 与现状一致,不再"骗用户"
- 减少代码量 ~100 行(死代码 + TODO 注释)
- Phase 5 可以重新评估是否需要"汉化上下文"作为前置(很可能不需要,Cursor/Claude Code 自身已处理)
- 4-6h 完成,低风险

**缺点**:

- 历史 README 描述变 false,需更新
- 若用户已在依赖汉化(no-op 但不报错),撤销后会看到 no-op 显式化(可能更糟)

### 选项 B: 填充汉化实现

**做法**:

1. 实现 `localization.ts` 3 处 + `bridge.ts` 3 处的汉化逻辑
2. 真实从 `ueDocLookup.ts` 拉 UE 文档注释 + 汉化词典(需 `scripts/extract-ue-docs.ts` 数据)
3. 5 万行 + 项目测试汉化命中率 ≥ 30%
4. 状态栏 + Hover + Completion 全部支持

**优点**:

- 完成历史承诺,仓库卖点"汉化"真实可用
- 5 万行项目体感提升(Cursor/Claude Code 也做不到的 LSP 层汉化)

**缺点**:

- 8-12h 投入,需要 UE 源码注释解析(中等到大型工作量)
- 词典维护成本高(UE 每个版本 API 都在变)
- Phase 5 不再需要,反而成为依赖项,Block Phase 5 完成

## 决策依据

**选 A** 的核心理由:

1. **零承诺原则**: Phase 3 god 文件拆 + Phase 4 中型 god 拆 + Phase 5 Live Coding AI 已经有 18-22h 工作量,8-12h 汉化是"沉没成本高 + 收益不确切"
2. **不阻塞主线**: 选 A 让 Phase 5 立刻可启动;选 B 让 Phase 5 等待
3. **现状 no-op 的真相**: UE 5.2+ 已经有官方简中翻译(引擎层),仓库 LSP 层汉化边际收益有限
4. **可逆性**: 选 A 后,真正要做汉化是独立 phase;选 B 后撤销更费劲

**选 B 的核心理由**(被拒):

- 历史承诺需兑现
- 但 `extract-ue-docs.ts` 输出覆盖率未知,实际可能 30% 都做不到

## 验收 (选项 A 路径)

- 6 处 TODO 标记 + 死代码删除
- `localization.ts` / `bridge.ts` 改后 ≤ 当前行数(代码净减少)
- `proxy/AGENTS.md` 删除"汉化(TODO)"段
- README / Marketplace 描述无"汉化"卖点
- `npm run test:unit` 全绿(6 处相关测试 0 改动或更新)
- 0 个新 runtime 依赖

## 风险

- **R1 (Low)**: 用户已习惯 no-op 汉化,撤销后看到显式 "no translation" 提示会不安 —— Mitigation: README 更新明示"汉化下架,依赖 Cursor/Claude Code 自带翻译"
- **R2 (Low)**: Phase 5 设计依赖"汉化上下文",选项 A 撤销后 Phase 5 需重新评估 —— Mitigation: 已在 Phase 5 design doc §"决策依据" 标注"汉化依赖可选"
- **R3 (Low)**: 历史 commit 提到汉化,git blame 看起来回退 —— Mitigation: commit message 明示"Phase 6 决断:下架汉化(TODO)承诺,记录在 ADR"
