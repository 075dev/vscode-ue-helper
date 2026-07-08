# VSCodeUEHelper 优化改进计划

> 基于 unreal-sense.nvim 对照分析制定。每项标注现状(带源码位置)、目标、做法、改动文件、风险、验证方式。

---

## 实测验证结果(基于测试项目 `E:\Dream\XianDreamwalking`)

用真实项目(UE 5.8 + clangd 22.1.8)验证了计划中"待验证"项,结论如下:

| 验证项 | 实测结果 | 计划调整 |
|--------|----------|---------|
| P1-4 `@response_file` | compile_commands 32/32 条目全是 `@file.rsp` 形式(command 字段),**但 clangd 22.1.8 原生递归展开** @rsp(含嵌套 Shared.rsp);.rsp 无 SharedPCH、无 -include(GenerateClangDatabase 天然 -NoPCH) | ✅ **关闭**(clangd 18+ 不需 flatten) |
| P2-1 版本感知 -std | UE 5.8 的 UBT rsp 实际是 `/std:c++20`,VSCodeUEHelper .clangd 也是 c++20,**一致且正确**;unreal-sense 的 "5.5+→c++23" 反不符 UBT | ✅ **取消**(c++20 对 UE 5.x 全系正确) |
| P1-2 background-index | .clangd 是 `Index.Background: Build`;`--background-index-priority=normal` 是启动参数,需确认代理是否注入 | 维持,待核查代理参数 |
| P0-1 现状 | compile_commands 32 条目(1 模块),生成快;-NoExecCodeGenActions 仍省 codegen | 维持 P0 |
| detection | .code-workspace folders 完全符合规则(path=. → project,name=UE5 → engine),UE 5.8 正确识别 | 无需改 |

**关键结论**:P1-4、P2-1 经验证**取消/关闭**,计划从 9 项缩减为 7 项。VSCodeUEHelper 在 @rsp(靠 clangd 22 原生展开)和 -std(与 UBT 一致)上现状正确,unreal-sense 的对应做法反而不适用。

---

## 一、现状评估总览

对照 unreal-sense.nvim 的可取之处,VSCodeUEHelper 的相对位置:

| 能力 | VSCodeUEHelper 现状 | 评估 |
|------|---------------------|------|
| 宏 stub 兼容头 | `ueClangdCompat.h` 常规流程 `/FI` 强制 include,重写 `BODY_MACRO_COMBINE`(`ueClangdCompat.ts:61`) | ✅ **已超越**(unreal-sense 仅 fallback 用) |
| compile DB 缓存 | 指纹 SHA256 快路径,二次激活跳过 UBT(`compileCommandsCache.ts`) | ✅ **已超越**(unreal-sense 仅 mtime file_cache) |
| .clangd 操作 API | `ClangdOps` 统一 mutate/writeFull,原子写(`clangdOps.ts:47`) | ✅ **更严谨**(unreal-sense 直接 io.open) |
| UE 宏 specifier 补全 | 原生 `CompletionItemProvider` + snippet + meta(`ueMacroCompletionProvider.ts:15`) | ✅ **更完善**(unreal-sense 起独立 LSP) |
| UBT `-NoExecCodeGenActions` | **未用**(`compileCommands.ts:245`) | ❌ P0 差距 |
| buildType 联动 config | **硬编码 Development**(`compileCommands.ts:49`) | ❌ P1 差距 |
| `--background-index-priority=normal` | **未确认** | ❓ P1 待验证 |
| UBT 失败降级 | **直接抛错**(`compileCommands.ts:583`) | ❌ P1 差距 |
| `@response_file` flatten | **无** | ❓ P1 待验证是否需要 |
| 版本感知 `-std` | **未版本感知** | ❌ P2 差距 |
| 反射诊断 linter | **无** | ❌ P2 差距 |
| 增量 regen(文件保存触发) | 被动诊断驱动(无主动文件监听 regen) | ⚠️ P2 权衡 |

**结论**:VSCodeUEHelper 不必照搬 unreal-sense 的双 LSP / 自研 LSP / fallback stub(已有更优等价)。改进应聚焦**UBT 参数提速、降级韧性、性能调优**三个真正差距。

---

## 二、P0 高优先级(低成本高收益)

### P0-1 UBT 加 `-NoExecCodeGenActions`

**现状**:`buildNonNativeArgs`(`compileCommands.ts:223`)构造的 UBT 参数:
```
<buildTargetName> <unrealPlatform> Development <project> -Mode=GenerateClangDatabase [-architecture=]
```
没有 `-NoExecCodeGenActions`,UBT 在生成 compile DB 后会继续执行 codegen(编译 `.cpp` 到 `.o`),对 IntelliSense 场景纯属浪费,首次生成慢。

**目标**:跳过 codegen,只生成 compile DB,首次 setup 提速显著(unreal-sense 实测 ~60s 含此优化)。

**做法**:
1. 在 `compileCommands.ts:50` 附近加常量 `UPDATE_COMPILE_COMMANDS_ARG_NO_CODEGEN = '-NoExecCodeGenActions'`;
2. `buildNonNativeArgs` 的 `args` 数组(`:245`)末尾追加该常量;
3. **关键交互**:`-NoExecCodeGenActions` 可能导致 UHT 不生成 `.generated.h`。VSCodeUEHelper 已有兜底链路:`ueClangdCompat.h` 让 `GENERATED_BODY()` 在 `.generated.h` 缺失时仍能展开 + 被动诊断 `ueDiagnosticWatcher` 检测报错后触发 UBT 补生成。故链路自洽,无需额外处理。可选增强:在 `generateCompileCommands` 成功后主动检查 `.generated.h` 是否缺失,缺失则提示用户(非阻塞)。

**改动文件**:`src/clangd/compileCommands.ts`

**风险**:低。`-NoExecCodeGenActions` 是 UE 官方支持的 UBT 参数,unreal-sense 已验证。不影响被动诊断的 `runUbt` 路径(那是 `ueDiagnosticWatcher` 独立调用,不走 `generateCompileCommands`)。

**验证**:
- `npm run typecheck` + `npm run test:unit`;
- 手动:删 `compile_commands.json` 后跑 `UE Generate Compile Commands`,对比加 flag 前后耗时(日志 `[compileCommands] ubt.taskCompleted` 的 `elapsedMs`);
- 确认生成的 `compile_commands.json` 条目数 / include 路径不变。

---

## 三、P1 中优先级

### P1-1 buildType 从 config 读取,去硬编码

**现状**:`UPDATE_COMPILE_COMMANDS_ARG_DEVELOPMENT = 'Development'`(`compileCommands.ts:49`)硬编码,`buildNonNativeArgs` 直接用。而 `Config` 有 `configuration` 设置(Debug/DebugGame/Development/Shipping/Test),用户改设置不生效。

**目标**:`generateCompileCommands` 的 UBT buildType 联动 `config.configuration`。

**做法**:
1. `GenerateOptions`(`compileCommands.ts:66`)加可选字段 `buildType?: string`;
2. `buildNonNativeArgs` 用 `opts.buildType ?? 'Development'` 替换硬编码常量;
3. 调用方(`generateCompileCommands.ts` 命令、`createProject.ts`、`clangd/index.ts`)从 `config.configuration` 传入。

**改动文件**:`src/clangd/compileCommands.ts`、`src/commands/generateCompileCommands.ts`、`src/commands/createProject.ts`、`src/clangd/index.ts`

**风险**:低。`GenerateClangDatabase` 对 buildType 宽容,Development 是安全默认。注意 Debug 配置生成更慢,文档应提示用户 IntelliSense 场景建议 Development。

**验证**:切 `configuration` 到 Debug,重新生成,确认 UBT 命令行含 Debug。

### P1-2 确保 `--background-index-priority=normal`

**现状**:VSCodeUEHelper 不启动 clangd(用户装的 `vscode-clangd` 扩展启动),`background-index` 相关参数由 clangd 扩展设置或代理传入。未确认是否设了 `normal`。unreal-sense 的实战经验:18k 文件 UE 项目里 `background` 优先级会让索引构建被每次按键饿死,索引永远建不完。

**目标**:确保 clangd 以 `--background-index --background-index-priority=normal` 启动。

**做法**:
1. 先核查:`proxyManager.buildProxyArgs`(`proxyManager.ts:319`)构造的 `realClangdArgs` 是否含这两个参数;核查 clangd 扩展默认是否已带;
2. 若无,在代理启用时通过 `clangd.arguments` 写入这两个参数(走 `ClangdSettingsManager.enable` 的 `realClangdArgs`);
3. 或在 `.clangd` 的 `Index.Background` 配置层兜底(VSCodeUEHelper 已有 `background_index` 相关类型,见 `types.ts:89`)。

**改动文件**:`src/clangd/proxyManager.ts`(可能)、`src/clangd/clangdConfig.ts`

**风险**:低。`normal` 优先级会占用前台 CPU 建索引,但建完后恢复正常,远优于 `background` 永远建不完。

**验证**:`Output -> clangd` 日志确认启动参数含 `--background-index-priority=normal`;大项目观察 `.cache/clangd/index/` 是否在几分钟内建完。

### P1-3 UBT 失败 fallback 降级 DB

**现状**:`generateCompileCommands` 找不到 `compile_commands.json` 时抛错(`compileCommands.ts:583`),列候选路径 + 可能原因,用户只能修 UBT 错误重跑。UBT 因 UHT 错误挂掉时,整个 IntelliSense 不可用。

**目标**:UBT 失败时降级生成一份"够用"的 compile DB,让 clangd 能附着、能给基本补全(借鉴 unreal-sense `generate_fallback_db`,`compile_db.lua:356`)。

**做法**:
1. 新增 `src/clangd/compileCommandsFallback.ts`:
   - 扫项目 `Source/**/*.Build.cs`,正则提取 `PublicIncludePaths`/`PrivateIncludePaths`/`PublicDependencyModuleNames`;
   - 读 UHT manifest(`Intermediate/Build/**/*.uhtmanifest`)拿 `Modules[].IncludePaths` + 模块头列表;
   - 拼 engine core include 路径(`Engine/Source/Runtime/Core/Public` 等);
   - 扫 `Source/**/*.cpp`,为每个生成一条 `clang++ -std=c++20 -D__UNREAL__ ... -I<paths> -include ueClangdCompat.h <cpp>` 条目;
   - 写 `compile_commands.json`。
2. `generateCompileCommands` 在 candidates 全部未命中时(`:583` 抛错前),调用 fallback,成功则返回路径 + 日志 warn "using fallback DB (UBT failed)",失败才抛原错。
3. 复用现有 `ueClangdCompat.h`(VSCodeUEHelper 已有,比 unreal-sense 的 `UnrealClangdStubs.h` 更优)作为 `-include`。

**改动文件**:新增 `src/clangd/compileCommandsFallback.ts`、改 `src/clangd/compileCommands.ts`、`src/clangd/index.ts`(re-export)

**风险**:中。fallback DB 不含宏定义/正确的 PCH,clangd 会有误报。但比"完全不可用"强。必须日志明确标注 fallback 状态,避免用户误以为是正常 DB。建议加一个 `fallback: true` 标记进缓存条目,诊断面板(`diagnoseProject`)展示。

**验证**:故意在 `.Build.cs` 制造一个 UHT 错误,跑生成,确认 fallback DB 产出 + clangd 能附着 + 补全基本可用。

### P1-4 `@response_file` flatten -> ✅ 已验证:不需要,关闭

**实测**:测试项目(UE 5.8)的 `compile_commands.json` 32/32 条目全是 `clang-cl.exe @"...rsp"` 形式(command 字段)。**但 clangd 22.1.8 原生递归展开 `@rsp`**(含嵌套 `@Shared.rsp`),include 路径可见。.rsp 内容无 `SharedPCH`、无 `-include`(GenerateClangDatabase 模式天然 -NoPCH),unreal-sense 担心的两个问题在 VSCodeUEHelper 不存在。

**结论**:clangd 18+ 不需要 flatten。本项**关闭**。

**残余(低优先级)**:加 clangd 版本检测,`< 18` 时警告用户升级(旧 clangd 不展开 @rsp 会导致 include 全丢)。可并入 P1-2 的版本检测。

---

## 四、P2 增强

### P2-1 版本感知 `.clangd` 的 `-std` -> ✅ 已验证:取消

**实测**:UE 5.8 的 UBT 生成的 .rsp 里实际是 `/std:c++20`,VSCodeUEHelper 的 .clangd `Add` 也是 `/std:c++20`,**两者一致且正确**。unreal-sense 的 "5.5+ -> c++23" 规则反而与 UBT 实际标准不符(UE 5.x 全系用 c++20)。

**结论**:c++20 对 UE 5.x 全系正确。版本感知 -std 会引入与 UBT 的不一致,**取消本项**。保持当前 c++20。

### P2-2 反射诊断 linter

**现状**:VSCodeUEHelper 只有 clangd 诊断 + 被动诊断触发 UBT。缺 unreal-lsp 的反射诊断:`GENERATED_BODY()` 缺失、UE 命名前缀违规、`UFUNCTION` 多 RPC specifier。

**目标**:用 VSCode 原生 `DiagnosticCollection` 实现一个轻量反射诊断 linter(不起第二个 LSP,见上一轮分析)。

**做法**:
1. 新增 `src/clangd/ueReflectionLinter.ts`:
   - `vscode.languages.createDiagnosticCollection('ue-reflection')`;
   - 监听 `onDidChangeTextDocument` / `onDidSaveTextDocument`(cpp/h);
   - 正则扫:UCLASS/USTRUCT 后 7 行缺 GENERATED_BODY -> error;类名前缀不符 U/A/F/E/I/T -> warning;UFUNCTION 多 RPC -> error;
   - `collection.set(uri, diagnostics)`。
2. 在 `activateClangd`(`clangd/index.ts:101`)注册,`context.subscriptions.push`。
3. 诊断规则数据放 `ueReflectionLinterData.ts`(与 `ueMacroCompletionData.ts` 同范式,数据/逻辑分离)。

**改动文件**:新增 `src/clangd/ueReflectionLinter.ts`、`src/clangd/ueReflectionLinterData.ts`、改 `src/clangd/index.ts`

**风险**:低。独立 linter,失败不影响 clangd。注意 debounce(编辑时频繁扫),用 100-300ms 防抖。诊断与 clangd 诊断共存,Neovim 聚合同理 VSCode Problems 面板按 source 区分。

**验证**:写测试用例覆盖三条规则;手动在 cpp 文件造缺 GENERATED_BODY 的 UCLASS,确认 Problems 面板出 error。

### P2-3 增量 regen(`contains_file` 按需触发)

**现状**:VSCodeUEHelper 的 regen 是"被动诊断驱动"(clangd 报 `.generated.h` 缺失才触发 UBT),无"文件保存触发 compile DB regen"。新增 `.cpp`/`.h` 后,compile DB 不含该文件,clangd 无 IntelliSense,直到被动诊断链路触发。

**目标(权衡)**:借鉴 unreal-sense 的 `contains_file`(`compile_db.lua:311`)思路--保存文件时判断是否在 compile DB 中,不在则触发 regen。但 VSCodeUEHelper 已有 `IncrementalFileWatcher`(`clangd/index.ts:190`,chokidar),目前只埋点 perfLog 不触发 regen。

**做法(可选,需评估是否与被动诊断模式冲突)**:
1. 复用现有 `IncrementalFileWatcher`,在 `onBatch` 里加:对新文件调用 `compileCommands.containsFile(ccPath, file)`(新增 TS 版),不在则 `schedule_regen`;
2. `containsFile` 用 mtime 缓存(移植 unreal-sense `file_cache` 逻辑);
3. 串行化:`regen_running` + `regen_needed` + debounce(移植 unreal-sense `schedule_regen`,`init.lua:23`);
4. 与被动诊断模式协调:regen 后 `restart_clangd`(VSCodeUEHelper 代理侧已有重启机制)。

**改动文件**:`src/clangd/compileCommands.ts`(加 containsFile + cache)、`src/clangd/fileWatcher.ts`(加触发)、可能新增 `src/clangd/regenScheduler.ts`

**风险**:中。引入主动 regen 改变现有"被动"哲学,需评估是否值得(UE 项目 regen 慢,频繁触发扰民)。建议做成**默认关闭**的设置 `vscodeUEHelper.autoRegenOnNewFile`,用户可开。

**验证**:新增 `.cpp` 保存后,日志确认 `containsFile` 判定 + regen 触发;clangd 重新附着有 IntelliSense。

### P2-4 分步进度通知

**现状**:VSCodeUEHelper 有 `withProgress`(`ui/notifications.ts`),但 `generateCompileCommands` 是一次性 Task,无"命名阶段"细粒度反馈。

**目标**:长任务(fingerprint -> UBT -> 定位 cc.json)分步反馈。

**做法**:在 `generateCompileCommands` 关键阶段调 `withProgress` 的 `report` 传增量消息("Computing fingerprint..." -> "Running UBT..." -> "Locating compile_commands.json...")。或借鉴 unreal-sense `notify.step` 模式,封装一个 `StepProgress` 工具。

**改动文件**:`src/clangd/compileCommands.ts`、`src/ui/notifications.ts`

**风险**:低。纯 UX 增强。

**验证**:跑生成,确认进度条消息随阶段变化。

---

## 五、不建议照搬的点

| unreal-sense 做法 | 不照搬原因 |
|-------------------|-----------|
| 双 LSP(clangd + unreal-lsp) | VSCodeUEHelper 已用原生 `CompletionItemProvider` 实现 UE 宏补全(`ueMacroCompletionProvider.ts`),更轻量无文档同步开销 |
| unreal-lsp 自研 Python LSP | 实现有 `_notify` 帧格式 bug(`unreal_lsp.py:183`,裸 JSON+`\n` 非 Content-Length),publishDiagnostics 可能失效;能力弱(正则诊断、简陋 hover) |
| `UnrealClangdStubs.h` fallback stub | VSCodeUEHelper 已有 `ueClangdCompat.h`(`ueClangdCompat.ts:61`)常规流程兜底,更优 |
| 硬编码 specifier 表 | VSCodeUEHelper 的 `ueMacroCompletionData.ts` 已有更完善的 specifier + meta + snippet 数据 |
| 直接 `io.open` 写 `.clangd` | VSCodeUEHelper 的 `ClangdOps` 统一 API + 原子写更严谨 |

---

## 六、实施顺序与里程碑

**里程碑 M1(P0,1 项,半天)**:P0-1 `-NoExecCodeGenActions`。立竿见影提速,无依赖,可单独合入。

**里程碑 M2(P1,3 项,2 天)**:
1. P1-1 buildType 联动(正确性,与 P0-1 同文件,顺带做);
2. P1-2 `background-index-priority=normal`(先核查代理参数再改,顺带加 clangd<18 版本警告);
3. P1-3 fallback 降级 DB(工作量最大,放最后)。

**里程碑 M3(P2,3 项,按需)**:P2-2 反射诊断 linter(用户感知最强,建议先做)、P2-4 分步进度、P2-3 增量 regen(权衡后决定)。

每个里程碑结束:`npm run typecheck` + `npm run test:unit` + `npm run lint` 全绿,手动 F5 验证一次完整 setup 流程。

---

## 七、风险与回滚

- 所有改动均在新分支按里程碑提 PR,单里程碑可独立回滚;
- P0-1 / P1-1 / P1-2 改动小、影响面可控,直接合;
- P1-3 fallback / P1-4 flatten / P2-3 增量 regen 引入新行为,建议加设置开关,默认行为不变,用户/测试验证后再默认开启;
- 每项改动遵循项目既定模式:路径走 `WorkspaceState` getter、`.clangd` 写走 `ClangdOps`、用户可见字符串走 `t()` i18n、Chinese 注释、strict TS、no floating promises。
