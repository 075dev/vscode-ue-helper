---
bugfix: 007
slug: clangd-keepalive-memory
status: fixed
fixed_at: 2026-11-20T14:30:00+08:00
severity: high
review: pending
---

# bugfix-007:clangd 持续占用内存——keepalive 放大 AST 驻留 + TTL 空闲不失效 + 无法关闭

## 现象

用户反馈 "clangd 持续占用内存",任务管理器截图证据(2026-11-20):

| PID | 工作集 | 提交大小 |
|-----|--------|----------|
| 10652 | **2,667,404 K (2.6 GB)** | **9,184,896 K (9.1 GB)** |
| 26164 | 168 K | 11,617,936 K (11.6 GB) |
| 16012 | 180 K | 7,408,948 K (7.4 GB) |
| 22668 | 184 K | 6,043,760 K (6.0 GB) |
| 40708 | 168 K | 5,072,912 K (5.1 GB) |
| 30736 | 144 K | 3,568,908 K (3.6 GB) |
| 30804 | 152 K | 3,521,136 K (3.5 GB) |
| 6764 | 172 K | 2,537,096 K (2.5 GB) |
| 40072 | 144 K | 1,112,604 K (1.1 GB) |
| 9076 | 216 K | 18,768,460 K (18.8 GB) |
| 10562 | 168 K | — |

系统 16 GB 内存已用 11.8 GB,提交 82.5/87.9 GB —— **大量页面文件交换**。

两个独立异常:
1. **单进程 2.6 GB 工作集**(PID 10652)—— 内存实占
2. **10 个 clangd 实例 + 每个 1~19 GB 提交大小** —— 虚拟地址/提交量膨胀

## 归因

### 一、keepalive 是内存放大器(本插件责任,已确认)

`src/clangd/proxy/keepalive.ts:18-19` 默认 `max=20`、`ttlSec=900`。
机制:拦截 `textDocument/didClose` **不转发**给 clangd,让 clangd 认为文档仍打开。

放大条件(用户环境全部命中):
- `SharedPCH.UnrealEd...Cpp20.h.pch` = **2.4 GB × 2 个**(实测 `Intermediate/Build/Win64/x64/XianDreamwalkingEditor/Development/UnrealEd/`)
- `compile_commands.json` 131 个 TU,`command` 用 `@"....obj.rsp"` 响应文件间接引用
- `.clangd` 含 `Index: Background: Build`(由 `src/clangd/clangdConfig.ts:83-87` 写入)
- `--background-index-priority=normal` 由 `src/clangd/proxyManager.ts:487-493` 强制注入

UE 头文件单份 AST + preamble 通常 100~300 MB,20 份保活即 2~6 GB,与 PID 10652 的 2.6 GB 工作集吻合。

### 二、TTL 空闲不失效(本插件缺陷,已修复)

`Keepalive.tick()`(`keepalive.ts:165`)仅在收到 LSP 消息时被调用:
- `bridge.ts` `processClientMessage` 开头
- `bridge.ts` `checkTtlExpiry`(由上面及 `handleServerData` 调)
- `bridge.ts` `handleServerData` 开头

**旧实现无定时器**。用户关掉文件后离开 IDE,保活条目永不失效,实际驻留时间远超配置的 15 分钟。

修复前实测(`npx tsx` 直接跑 `keepalive.ts` 源码,TTL 设 1s):

```
关闭 5 个文件后 keepalive.size = 5
等待 3 秒(超过 TTL=1s)...
3 秒后、未收到任何 LSP 消息时 keepalive.size = 5   ← 未失效
手动 tick() 后 size = 0,过期转发数 = 5
```

### 三、keepalive 无法关闭(本插件缺陷,已修复)

`src/core/config.ts:209-215`(修复前):

```ts
get clangdProxyKeepaliveMax(): number {
  const raw = this.root.get<unknown>('clangdProxy.keepaliveMax');
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_KEEPALIVE_MAX;   // 用户设 0 → 被 clamp 回 20
}
```

`clangdProxyKeepaliveTtlSec`(`config.ts:218-224`)同样 `raw > 0`。

而底层能力是存在的:
- `keepalive.ts` 测试 `'max=0 时每次 didClose 立即淘汰(无保活)'` 明确支持 0
- `cliArgs.ts` 的 `--keepalive-ttl-sec` 用 `num >= 0`(与 config 的 `> 0` 不一致)

结论:**用户想关掉保活无路可走**,配置层把 0 堵死了。

### 四、10 个 clangd 实例 —— 已排除是本插件产生的

搭建复现环境(真 bundle `out/clangdProxy.js` + 假 clangd 子进程),三种场景实测:

| 场景 | proxy | clangd |
|------|-------|--------|
| 宿主优雅关闭 stdin(`stdin.end()`) | 退出 | 退出 |
| 宿主进程 `taskkill /F` 强杀 | 退出 | 退出 |
| proxy 自身被强杀 | — | 退出(管道断开) |

架构上本插件每个 proxy 只 `spawn` 一个 clangd(`processBridge.ts:83`),且 clangd 不脱离管道 —— **不会残留孤儿,也不会一个 proxy 起多个 clangd**。

10 个实例更可能来自:双宿主(JoyCode + VS Code 同开)、多窗口、`clangd.restartAfterCrash` 重启堆积。需现场数据确认(见"遗留")。

## 修复

| 文件 | 位置 | 变更 |
|------|------|------|
| src/clangd/proxy/keepalive.ts | `ttlMs` 私有字段 → `ttlMs_` + 新增 `ttlMs` / `maxEntries` getter | 暴露配置供调用方决定是否启定时器;原字段与 getter 同名冲突故重命名 |
| src/clangd/proxy/bridge.ts | 新增 `ttlTimer` 字段 + `startTtlTimer()` / `stopTtlTimer()` | 构造末尾启动空闲检查定时器,间隔 `clamp(ttlMs/4, 1s, 60s)`;`close()` 中停止。`maxEntries=0` 或 `ttlMs=0` 时不启动。`unref()` 避免阻止进程退出 |
| src/core/config.ts | `clangdProxyKeepaliveMax` / `clangdProxyKeepaliveTtlSec` | `raw > 0` → `raw >= 0`,并 `Math.floor()`;`0` 成为合法值(关闭保活 / 立即过期)。无效值(负数/非数值/null)仍回退默认 |
| src/clangd/proxy/cliArgs.ts | `--keepalive-max` 解析 | `num > 0` → `num >= 0`,与 config 层对齐;`--keepalive-ttl-sec` 本就是 `>= 0` |
| package.nls.json / package.nls.zh-cn.json | keepalive 两项描述 | 说明 `0` 的语义(关闭保活 / 立即过期) |
| README.md | 配置表 | 同上 |
| doc/02-modules.md | `keepalive.ts` 行 | 补充 `max=0` 可关闭 + TTL 空闲生效 |

**行为影响:** 默认值不变(20 / 900s),既有用户无感。仅新增两条能力:TTL 空闲也生效、`0` 可关闭保活。

## 回归验证(fresh evidence)

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run typecheck` | PASS | 0 错误 |
| `npm run build` | PASS | extension + proxy + MCP 三 bundle 全部产出,launcher 生成 |
| `npm test`(全量) | PASS | **1555/1555**(127 文件) |
| 定向 4 文件 | PASS | 88/88(keepalive 22 / bridge 23 / cli 19 / clangdProxyConfig 24) |

### 反向验证(证明测试真的能抓 bug)

临时回滚三处源码后重跑:

| 回滚内容 | 失败测试 |
|----------|----------|
| 移除 `startTtlTimer()` 调用 | `[bugfix-007] 无任何 LSP 消息时，TTL 到期后自动转发 didClose` ✗ |
| `config.ts` 改回 `raw > 0` | `keepaliveMax 零值是合法配置` ✗ + `keepaliveTtlSec 零值是合法配置` ✗ |
| `cliArgs.ts` 改回 `num > 0` | `[bugfix-007] --keepalive-max 0 被接受` ✗ |

回滚后共 3 个测试失败,恢复后全过 —— 测试有效性已证实。

### 端到端验证(真实 bundle,非单元测试)

用 `out/clangdProxy.js` + 假 clangd(`--keepalive-ttl-sec 4`),只发一次 `didClose` 后**完全不发消息**:

```
--- 2 秒（TTL=4s 未到）clangd 收到的内容 ---
(空，符合预期：仍在保活)
--- 6 秒（TTL=4s 已过）clangd 收到的内容 ---
{"jsonrpc":"2.0","method":"textDocument/didClose","params":{"textDocument":{"uri":"file:///e:/idle.h"}}}
>>> 是否自动转发了 didClose: true
```

修复前该场景永不转发。

## 用户侧建议(UE 大 PCH 项目)

`.code-workspace` 的 `settings` 里加:

```json
"vscodeUEHelper.clangdProxy.keepaliveMax": 0
```

彻底关闭保活。代价是失去 hover 死锁防护(`keepalive` 的原始目的),但对 PCH 2.4 GB 的 UE 项目,内存收益远大于该防护。

折中方案:`keepaliveMax` 设 3~5,`keepaliveTtlSec` 设 120~300。

## 同类检查

- [x] `grep` 扫描同模式(配置 clamp 把合法值当无效值)
- 结论:`clangdProxyKeepaliveMax` / `clangdProxyKeepaliveTtlSec` 是仅有两处;其余 getter(`clangdProxyRealClangdPath` / `clangdProxyLogPath`)用空字符串表示"未设置",无语义冲突。

## 遗留

1. **10 个 clangd 实例的根因未定位** —— 已排除本插件。需用户在复现时执行:

```powershell
Get-CimInstance Win32_Process -Filter "Name='clangd.exe'" |
  Select-Object ProcessId, ParentProcessId, CreationDate,
    @{n='WS_MB';e={[int]($_.WorkingSetSize/1MB)}} |
  Format-Table -AutoSize
```

判读:`ParentProcessId` → `node.exe`(我们的 proxy)= 与本插件相关;→ `cmd.exe` / `Code.exe` = 直连;`CreationDate` 聚集 = 重启循环。

2. **`--log-path` 快照失效** —— 用户 `XianDreamwalking.code-workspace:32` 写死了 `logs\20261113T003028\window1\...`,该会话目录已不存在。`cliRuntime.ts` 的 `appendFileSync` 失败后 fallback stderr,日志不可读。根因是 `proxyManager.ts:104` 在 enable 时快照 `context.logUri`,每次 VS Code 会话目录都会变。建议改为 `enable`/`reapply` 时重新解析路径,或默认不写死绝对路径。**本次未改**,留待单独处理。

3. **内存可观测性缺失** —— 本次排查拿不到 proxy 侧任何 keepalive.size / RSS 数据。建议后续在 proxy 日志中定期输出。**本次未改**。

## 旅程日志(≤5 条)

- 关键转折:最初以为"10 个 clangd 进程"是插件 spawn 泄漏,搭复现环境实测三种崩溃场景后全部排除 —— 每个 proxy 只 spawn 一个 clangd 且不残留孤儿。真正的内存问题在**单个进程**的 AST 驻留,而非进程数量。
- 第二个转折:单元测试(88/88 全绿)通过后仍不放心,用真 bundle 做端到端验证时第一次观测方向搞错了(盯 proxy 的 stdout,而 didClose 是写进 clangd 的 stdin)。修正后拿到决定性证据:空闲 6 秒自动转发 didClose。
- 反向验证是必要步骤:临时回滚源码后必须确认新测试**真的失败**,否则测试可能只是"碰巧通过"。这一步抓出了第一次回滚脚本字符串未匹配的疏漏。
- 配置层 `> 0` 与 CLI 层 `>= 0` 的不一致是"能力存在但被堵死"的典型形态 —— 底层 `Keepalive` 早就有 `max=0` 的测试,用户却无法通过配置触达。
