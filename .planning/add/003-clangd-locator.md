---
add: 003
slug: clangd-locator
status: reviewed
created_at: 2026-10-03T12:00:00+08:00
at: chapter-01
placement: auto(唯一重合)
review: approved(第 2 轮;第 1 轮 1 critical[override 键变更不失效缓存]已修 + 4 minor[2 同批处理、2 登记不修],回归钉锁定;详见 .planning/build/review-add003.md)
---

# add-003:ClangdLocator——统一 clangd 路径解析

## 需求

> 插件现有两条互相独立、来源高度重合的 clangd 路径解析链路,统一为一个懒探测 + 缓存的单服务,
> 消除重复实现漂移,初始化时零 IO,按用途暴露两个视图。

## 勘察与定位(add 步骤 0-2)

**现状两条链路(2026-10-03 盘点):**

| | 链路 A:proxy 解析 | 链路 B:SDK 探测 |
|---|---|---|
| 实现 | `src/clangd/proxy/realClangdResolver.ts`(6 级候选,同步纯函数) | `src/clangd/windowsSdk.ts` `findClangdExecutable`(4 级候选,async) |
| 调用者 | 仅 `proxyManager.enable()/reapply()` | 仅 `setSystemIncludes` 命令(经 `discoverSystemIncludes`) |
| 独有行为 | 排除本扩展 proxy launcher;备份值候选 | `where clangd`;`clangd --version` InstalledDir 推导 clang 驱动器 |

**已漂移证据:** 默认 LLVM 目录列表硬编码两份(`proxyManager.ts` `buildDefaultClangdSearchRoots` /
`windowsSdk.ts` `findClangdExecutable` 兜底段);`where` 仅 B 链路使用。

**落点判定:** 并入 **chapter-01**——自动判断(唯一重合):clangd 域(enableClangdProxy /
setSystemIncludes 等端点)全部位于 chapter-01。不新建章节。

**契约面:空。** 本次是内部基础设施统一,无新端点/事件/schema,36 端点对外行为不变;
`openapi.yaml` 与 `event-flow.md` 不动,契约版本不递增。架构取舍登记 `decisions.md` D8。

**范围边界(本记录即边界):**

- ✅ 新建 `ClangdLocator` 单服务:候选源收敛一份(插件 `vscodeUEHelper.clangdPath`、第三方
  `clangd.path` 当前值与备份值、`where clangd`、PATH 遍历、默认 LLVM 目录),懒探测 + 缓存 +
  失效,保留来源标签与 checkedCandidates 诊断结构
- ✅ 两个视图:`resolveRealClangd()`(排除 launcher,供 proxyManager)与 `locateClangDriver()`
  (clangd + InstalledDir 推导的 clang 驱动器,供 windowsSdk)
- ✅ proxyManager 与 windowsSdk 接线改造:删除两处重复的 PATH 遍历/默认目录列表
- ✅ 缓存失效:监听 `vscodeUEHelper.clangdPath` 配置变更 + proxy enable/disable 钩子
- ✅ 行为统一点:`where clangd` 进入统一候选链(proxy 链路自此也受益,新增行为)
- ❌ 不改 openapi.yaml / event-flow.md(契约面为空)
- ❌ 不新增命令/MCP 端点,36 端点 envelope 形状与错误码语义不变
- ❌ 不动 ueClangdCompat / compileCommands / fileWatcher 等其它 clangd 机制
- ❌ 不做诊断 UI(checkedCandidates 暴露给 diagnoseProject 留后续)

## 验收清单(构建 + 评审逐条断言)

1. `npm run typecheck` 通过;`npm test` 全绿(存量不回归,含既有 realClangdResolver 测试迁移后等价)。
2. 懒探测:创建 locator 到首次 resolve 之间无子进程/文件 IO;同输入二次 resolve 命中缓存
   (探测注入函数只被调用一次);失效后(reserve/配置变更模拟)重新探测。
3. `resolveRealClangd()` 视图:候选优先级 override > 插件 clangdPath > clangd.path 当前值 >
   备份值 > where/PATH > 默认 LLVM;launcher 路径候选被拒(reason=proxyLauncher)且不递归自启;
   notFound 返回 checkedCandidates 供调用方阻断写入(现 proxyManager 行为保持)。
4. `locateClangDriver()` 视图:返回 clangd 路径 + 由 `clangd --version` InstalledDir 推导的
   clang++/clang;任一环节缺失返回结构化 null(现 windowsSdk 行为保持)。
5. `proxyManager.enable()/reapply()` 消费 locator,`buildDefaultClangdSearchRoots` 与私有
   resolve 重复实现删除;proxy 行为语义不变(notFound 仍阻断写入并报错)。
6. `windowsSdk.findClangdExecutable` 消费 locator,重复 PATH 遍历/默认目录兜底删除;
   `discoverSystemIncludes` 对外签名不变,`setSystemIncludes.ts` 零改动。
7. 默认 LLVM 目录列表在 src 下仅存在一份(grep 可断言)。
8. `where clangd` 在统一候选链中(带 5s 超时),位于备份值之后、PATH 遍历之前。
