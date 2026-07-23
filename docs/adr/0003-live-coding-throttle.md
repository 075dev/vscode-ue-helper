# ADR 0003: Live Coding 5s 节流 —— 放弃完美单文件 UHT

- **状态**: Accepted
- **阶段**: H1 扩展(`src/clangd/ueLinkManager.ts`)
- **影响范围**: 5 万行 + UE5 项目用户的保存体验

## 背景

UE5 C++ 工作流的核心痛点:用户保存 `.h` 后,UnrealHeaderTool (UHT) 需要重新 codegen `*.generated.h` 文件,clangd 才能正确解析宏(UCLASS / UPROPERTY / GENERATED_BODY 等)。Rider 通过 IPC 让 UE Editor 进程内嵌 UHT 实现"瞬时"响应,VSCodeUEHelper 做不到(我们 fork 独立 dotnet 进程,启动 + 10206 文件 hash 校验就要 3-4s)。

2026-07 XianDreamwalking 项目(10206 源文件)实测数据:

- 纯 UHT 启动: 3-4s(dotnet + UnrealBuildTool.dll + 10206 文件 hash 校验的物理下界)
- 加 InputCache 优化: 反而慢 3-7 倍(实测 revert InputCache)
- 什么都不做: 每个保存 3-4s 卡顿,体感像 IDE 死锁

## 决策

放弃"完美单文件 UHT"(每个保存 → 实时 codegen),改用 **5s 全局节流 + mtime 跳过**:

具体策略(`src/clangd/ueLinkManager.ts` 实现):

1. **mtime 跳过**: 每次保存前 `vscode.workspace.fs.stat` 拿 mtime,未变 → 0ms 跳过(Ctrl+S 触发但内容未变场景)
2. **5s 全局节流**: 5s 内多次保存合并成 1 次 UHT(避免连续保存 fork 多个 dotnet)
3. **内容预过滤**: 读文件内容,正则匹配 `UCLASS|UPROPERTY|UFUNCTION|USTRUCT|UINTERFACE|UENUM` 才触发 UHT(普通 .h 不触发)
4. **状态栏反馈**: 跑时显 `$(sync~spin) UE Sync`,让用户知道在等(不是卡住)
5. **文件级 debounce**: 同文件 200ms 内多次保存合并

5s 这个值是经验值:用户在 Rider 下手动连续保存(Ctrl+S)通常 1-2s 间隔,5s 覆盖"快速连击保存"场景,仍在用户感知"暂停"时立即触发。

## 被证伪的方案

**方案 A: 完美单文件 UHT(每个保存 → 实时 codegen)** —— 拒。物理下界 3-4s,即使 InputCache 也无法突破(实测反而更慢,2026-07)。用户保存 1 个 .h 等 4s,IDE 体感死锁。

**方案 B: 写 stub .generated.h 跳过 UHT(stub 模式)** —— 暂搁。P-C 路径,可能成功但风险大: stub 内容与真实 codegen 不一致时,clangd 给的"假"补全会误导用户。需独立 phase 验证,不在本 ADR 范围。

**方案 C: 调小 UHT 子进程的 hash 范围(只 hash 变更文件)** —— 拒。UHT 内部 hash 是全工程,跨插件修改风险大,且 10206 文件的 hash 也只占启动时间 30% 左右,主因仍是 dotnet + UnrealBuildTool.dll 加载。

**方案 D: 不用 UHT,让 clangd 直接忽略 UE 反射宏** —— 拒。clangd 不知 UCLASS() 展开后是 GENERATED_BODY 类,智能提示会缺失大量 UE 反射字段。

## 后果

**正面**:

- 5 万行 + 项目常见保存场景压缩到 ~0ms 体感(mtime 跳过 + 节流)
- 状态栏反馈消除"IDE 卡住"误解
- `mtimeSkippedCount` / `throttledMergedCount` 两个性能指标可视化(状态栏 tooltip)

**负面**:

- 用户保存到 UHT 跑的最大延迟: 5s
- 极端场景(连击保存 6 次 + 改不同文件): 第 6 次保存仍需等 5s 才有 UHT 结果,期间 clangd 索引滞后
- 5s 是经验值,未来更快的机器可能可以缩到 3s(后续 phase 重新评估)

## 参考

- `src/clangd/ueLinkManager.ts` 实现 + 顶部 docstring(实测数据记录)
- `src/clangd/uhtGeneration.ts` 顶部 REVERTED 注释(InputCache 反例)
- `test/unit/clangd/ueLinkManager.test.ts` 11 个 test case(mtime 跳过 / 节流 / 状态机)
- Pre-plan 0 SUMMARY.md(ueLinkManager 收尾记录)
