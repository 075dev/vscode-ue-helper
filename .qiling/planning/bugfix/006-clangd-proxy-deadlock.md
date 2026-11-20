---
bugfix: 006
slug: clangd-proxy-deadlock
status: fixed
fixed_at: 2026-11-13T00:30:00+08:00
severity: critical
review: approved
---

# bugfix-006:双宿主下启用 proxy 后 clangd 停摆——外来 launcher 逃过排除 + 参数嵌套 + .bat spawn EINVAL

## 现象

- 用户报告:"打开 proxy 后,clangd 直接停摆了,没有任何效果了"。
- 日志证据(用户粘贴的 proxy 输出):
  - `parsed: realClangd=c:\Users\075\.vscode\extensions\vscode-ue-helper-0.2.0\out\launcher\proxy-launcher.bat` —— realClangd 被解析成 **launcher 自身**
  - argv 两层嵌套(外层 log-path=JoyCode、内层 log-path=Code,各一套完整 proxy 参数)
  - `[processBridge] spawn failed: spawn EINVAL` → `[processBridge] cannot send: child not available`
  - 乱码行:`'...动生成,配...clangd.useScriptAsExecutable' 不是内部或外部命令`
- 用户环境:双宿主(VS Code + JoyCode)打开同一 UE 项目(e:\Dream\XianDreamwalking)。

## 复现路径

- 测试(修复前失败 ✗,修复后通过 ✓):
  - `test/unit/clangd/proxy/realClangdResolver.test.ts` → `Given 候选是另一份扩展副本的 launcher(basename 相同、路径不同)When 解析 Then 一律排除`(修复前:返回外来 launcher → found)
  - 同文件 → `Given 外来 launcher 在前而 where 有真 clangd ...`(修复前:返回外来 launcher)
  - `test/unit/clangd/proxyManager.test.ts` → `Given 现有 arguments 已是嵌套 proxy 参数 When enable Then 剥离...`(修复前:整段嵌套透传)+ `extractRealClangdArgs` 纯函数套件
- 时间线重建(与日志逐段吻合):窗口 A(VS Code)enable 写入 path=A 的 launcher + A 套 arguments → 窗口 B(JoyCode)同 workspace,扩展副本路径不同 → isActive=false 走 enable → resolver 的 launcher 排除仅 isSamePath 比对本实例路径,外来 launcher 逃过排除且 fileExists 通过 → `--real-clangd` 写成 A 的 launcher.bat;enable 把 A 全套 arguments 整段当真实 clangd 参数 → 嵌套 → proxy CLI spawn .bat(无 shell)→ Node(CVE-2024-27980 后)抛 EINVAL → 停摆;bat 的 UTF-8 中文注释在 GBK 代码页 cmd 下错位,注释体被当命令执行 → 乱码行。

## 根因

realClangdResolver 的 launcher 排除只做"与本实例 launcherPath 等同比较",跨窗口/跨版本扩展副本写入 settings 的**外来 launcher** 逃过排除被写入 `--real-clangd`;叠加 enable() 无防重入(把现有 proxy 参数整段当真实 clangd 参数嵌套写入),最终 proxy CLI 对 .bat 无 shell spawn 抛 EINVAL,且失败后 bridge 挂死无诊断——clangd 停摆。

- 引入点:launcher 排除与 settingsManager 初版(bugfix-002 前后);.bat spawn 限制为 Node 安全修复(CVE-2024-27980)后成为必现;`src/build/buildRunner.ts:67-79` 在 build 链路已有同坑的正确防御(cmd /c 包装),proxy 链路漏配。
- 类别:边界遗漏(跨实例排除)+ 逻辑错误(嵌套无剥离)+ 错误处理缺失(spawn 失败静默挂死)。

## 修复

| 文件 | 位置 | 变更 |
|------|------|------|
| src/clangd/proxy/realClangdResolver.ts | isProxyLauncherPath | 候选 basename 为固定生成的 `proxy-launcher.bat` 即排除(与 launcherPath 等同比较并行)——跨安装目录/版本有效;误杀风险可忽略(真 clangd 不会同名) |
| src/clangd/proxyManager.ts | extractRealClangdArgs(新增导出) | 首元素 `--real-clangd` 判定 proxy 形态,`lastIndexOf('--')` 一次剥离任意层嵌套;非 proxy 形态原样返回(保持 enable 对用户原始参数语义) |
| src/clangd/proxyManager.ts | enable()/reapply() | 统一走 extractRealClangdArgs(旧 enable 不剥离、旧 reapply 用 indexOf 只剥一层) |
| src/clangd/proxy/processBridge.ts | spawnChild | spawn 失败时若路径为 .bat/.cmd 给出根因诊断;回调 onChildErrorCb → CLI `exit(1)` fail-fast(旧:静默挂死,宿主只见 cannot send) |
| esbuild.config.mjs | launcher bat | 注释改纯 ASCII(UTF-8 中文注释在 GBK 代码页 cmd 下错位、被当命令执行) |

**提交:** 未提交(工作区含进行中的其它变更,由用户决定提交时机;建议 `fix(bugfix-006): proxy 跨宿主 launcher 排除 + 参数嵌套剥离 + .bat spawn 诊断,修复 clangd 停摆`)。

## 回归验证(fresh evidence)

| 命令 | 结果 | 备注 |
|------|------|------|
| `npm run typecheck` | PASS | 0 错误 |
| `npm test` | PASS | 1546/1547(唯一失败为 perfLog 计时断言 flaky——负载敏感,单独重跑 9/9 过,PRE-EXISTING,与本修复无关) |
| `npm run build` | PASS | launcher bat 产物经 od 验证纯 ASCII |
| clangd 目录全量(60 文件) | PASS | 768/768 |

## 同类检查

- [x] `grep` 扫描同模式代码
- 结论:**spawn .bat 同坑已有正确样本**(src/build/buildRunner.ts:67-79 cmd /c 包装,bugfix-001 F1-1 修过);`src/clangd/proxy/cliArgs.ts:98` 的 `indexOf('--')` 为 CLI 单层契约语义(对正确单层配置正确,嵌套属上游污染,修复后的 enable 重写即纠正存量),记录不改。

## 用户存量配置自愈路径(评审核验)

用户当前已写坏的 workspace settings 两条修复路径:
1. **在 clangd.path 所指扩展实例的窗口**(isActive=true)执行 **reapply**(改任一 localization 配置触发,或再点一次"启用 proxy")——外来 launcher 被排除、嵌套参数被剥离,写入干净单层配置;
2. 或在新实例窗口执行 **enable**——同样产出干净配置。
注意:非 active 窗口执行 disable 只会告警跳过,不修复也不丢数据。

## 遗留与顺带发现

- (评审 minor-1)`settingsManager.ts:88-93`:双宿主下 enable 仍会把外来 proxy 配置备份为"原始值"(workspaceState 按实例隔离,A 窗口真备份未被污染,不阻碍恢复,但 B 窗口日后 disable 会无警告写回外来 launcher 配置)。
- (评审 minor-2)`extractRealClangdArgs`:proxy 形态下真实参数含裸 `--` 时 lastIndexOf 会截断——clangd CLI 不使用裸 `--`,实际不可达。
- (评审 minor-3)`clangdLocator.ts:233-236`:findClangdShared 的 configuredPath 短路绕过 launcher 排除,与新 basename 排除轻微不一致(旧行为,实际不可达)。
- (评审 minor-4)reapply 嵌套场景缺直接行为测试(与 enable 共用 extractRealClangdArgs,间接覆盖)。
- 日志中 `[settingsReader] no .vscode/settings.json found`:UE 生成的 .code-workspace 多根工作区下 settings 不落在 .vscode/settings.json,proxy CLI 的 settingsReader 找不到——未影响本次停摆链路,留待观察。

## 旅程日志(≤5 条)

- 根因定位的关键转折:resolver 的排除逻辑静态看"无懈可击"(launcherPath 已传、isSamePath 归一化完备),转而从日志 argv 的**两层嵌套结构**反推"存在第二个扩展实例",才意识到排除的等同比较只覆盖本实例路径——跨实例路径差异是盲区。
- 中途一度卡在"所有 resolver 路径要么写真 clangd 要么 notFound,launcher 不可能被写入"的矛盾里;跳出单实例视角(两个 asAbsolutePath 不同)后矛盾消解。
- 评审确认 processBridge 的 onChildErrorCb → CLI exit(1) 接线已存在:spawn 失败诊断回调顺手把"静默挂死"变成 fail-fast,是修复的额外收益。
