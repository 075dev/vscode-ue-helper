# fill-report —— add-002 ue_build 单模块编译

> 构建方式:内联模式(协调器上下文无 worker 派发工具,经门控规则降级由主会话实现)
> 契约基线:openapi.yaml 0.2.0;定位记录:.planning/add/002-module-build.md;决策:D7

## 改动文件清单

### 源码(5)

| 文件 | 改动 |
|------|------|
| `src/build/types.ts` | `UBTArgs` 加可选 `module?: string` |
| `src/build/ubt.ts` | `buildUBTCommand` 在 module 非空时追加 `-Module="<名>"`;注释说明 Live Coding 复用不受影响 |
| `src/commands/build.ts` | `executeBuild`/`executeBuildInner` 加可选 `module` 参数;`effectiveModule`(mode≠build 丢弃,评审 minor 防线);`moduleFields` 条件展开贯穿 envelope data 与 3 处 `rememberBuildSnapshot`;成功/失败文案 `Module build (X)`;Output 通道 module 日志 |
| `src/build/lastBuild.ts` | `LastBuildSnapshot`/`BuildErrorsSummary` 加可选 `module`;`summarizeBuildErrorsForAgent` 缺省不出现键 |
| `src/mcp/tools.ts` | `ue_build` inputSchema 加 module;callTool 解析 + 字符白名单 `/^[\w.+-]+$/u`(评审 major,防 cmd.exe verbatim 注入);rebuild/clean 携带时忽略 + 响应 `warning` |

### 测试(5)

| 文件 | 改动 |
|------|------|
| `test/unit/build/ubt.test.ts`(新) | -Module 拼接、不带 module 五段式逐项一致、空串不拼、LiveCoding 不受影响(5 例) |
| `test/unit/commands/build.test.ts` | module 贯穿(成功/失败快照)、不带 module 全链路现状一致(toStrictEqual)、rebuild 函数层防线、异常路径快照带 module(4 例) |
| `test/unit/mcp/tools.test.ts` | schema module 属性、第 8 参透传、rebuild/clean 忽略+warning、空白串、注入样本白名单拒绝、快照 module 透出/缺省(8 例) |
| `test/unit/mcp/tools.envelope.test.ts` | ue_build dispatch 断言 6→8 参(statusBar/module 占位)适配 |
| `test/unit/build/lastBuild.test.ts` | summarize module 缺省不出现键/透传(1 例) |

### 契约与记录(4,主会话维护)

`openapi.yaml`(0.1.0→0.2.0,module/warning/BuildResult.module/BuildSummary.module)、`event-flow.md`(场景 2 payload + 边缘场景 2 行)、`decisions.md`(D7)、`chapter-01`(§1.4 + 变更日志)

## 验收清单逐条证据(验收 6 条)

| # | 验收项 | 状态 | 证据 |
|---|--------|------|------|
| 1 | typecheck + 全量测试 | ✅ | `tsc --noEmit` 0 错;vitest **110 文件/1330 用例全绿**(修复后 fresh 复跑) |
| 2 | `-Module="<名>"` 产出;不带 module 逐字节一致 | ✅ | ubt.test.ts toEqual 精确断言两形态 |
| 3 | callTool 透传第 8 参 + inputSchema 描述 | ✅ | tools.test.ts:277-290、:199-204 |
| 4 | rebuild/clean 忽略 + warning | ✅ | tools.ts 白名单/模式守卫;tools.test.ts rebuild/clean/空白/注入 4 例 |
| 5 | executeBuild 全路径 module 贯穿 | ✅ | build.test.ts 成功/失败/异常路径 3 例 + 快照断言 |
| 6 | 不带 module 全链路与现状一致 | ✅ | build.test.ts toStrictEqual + `'module' in` 负断言 |

## 评审闭环

ql-reviewer 第 1 轮:**approved**(critical 0 / major 1 / minor 2),三项问题当场修复并补测试:

1. [major→fixed] module 经 cmd.exe verbatim 命令行拼接存在注入面 → MCP 入口字符白名单,注入样本测试钉死
2. [minor→fixed] executeBuild 函数层缺 rebuild/clean+module 防线 → `effectiveModule` 丢弃 + 测试
3. [minor→fixed] 异常路径快照 module 缺断言 → withProgress reject 用例补齐

## NOT_RUN / 遗留

- UBT `-Module=` 真实引擎行为(只编译不链接、obj 复用、Live Coding 拒绝)未在 vitest 内验证——采信 add 记录的 UE 5.8 源码实证与本机对照实验(1 vs 21 动作);单元测试只断言 args 形态与贯穿逻辑。
- `scripts/docsmap.mjs` 在仓内不存在(README 引用),索引 README.md 未增量更新;契约增量已录入 chapter-01 §1.4。
- VS Code UI 命令面不暴露 module(定位记录明确裁剪),模块选择器 UI 留待后续批次。
