# Changelog

All notable changes to VSCodeUEHelper are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **UE 版本 × 能力矩阵**（借鉴 [unreal-engine-mcp](https://github.com/FFZackFair92/unreal-engine-mcp) 的 `ue_status` / 版本兼容表，与 [boocs/unreal-clangd](https://github.com/boocs/unreal-clangd) 的「不同 UE 版本要求不同 LLVM 版本」说明）：新增 `src/core/ueCapabilities.ts`，把「不同 UE 版本行为不同」从散落注释收敛为可查询、可单测的矩阵——最低支持版本（5.2+）、UBT 响应文件（.rsp，5.1+）、UHT 反射头生成、**Epic 为该版本锁定的 clangd/LLVM 版本**。`Diagnose Clangd Project` 新增 `ueVersion` / `ueCapabilities` 两项检查；版本未知标记 `skip`（无法判定 ≠ 不通过），无可靠版本来源时**不臆造** clangd 版本号，改指引查 Epic 官方文档。
- **MCP 工具 `ue_status`**（第 10 个工具）：同步返回检测到的项目/引擎、当前构建 configuration/target/platform，以及 UE 版本能力矩阵——让 AI 代理在动手前就知道「这个引擎版本该配哪个 clangd、哪些能力可用」，而不是撞上 cryptic error。工具名沿用社区事实标准，提高代理按名字发现的命中率。OpenAPI 契约同步新增 `/mcp/tools/ue_status` 端点与 `UeCapabilityReport` schema。
- **清理 clangd 索引缓存命令** `vscodeUEHelper.clearClangdIndex`（借鉴 [Incanta/vscode-cpp-unreal](https://github.com/Incanta/vscode-cpp-unreal) 的 `Clear clangd Index`）：clangd 索引损坏或与引擎版本不匹配后，跳转/补全会集体失灵，重建索引是唯一出路。新增 `src/clangd/clangdIndexCache.ts` 定位 clangd profile 下的 `index/` 目录（`%LOCALAPPDATA%\clangd\index` / `~/.cache/clangd/index` / `<projectDir>\.cache\clangd\index`），先报体积与文件数、用户确认后再删除，随后可一键重启 clangd —— 把 `Diagnose` 从「只报告」补成「可修复」闭环。不存在就如实报告「未找到」，不猜路径、不空删。
- **clangd 系统头路径持久化到设置项**（新增 `vscodeUEHelper.clangd.msvcRoot` / `clangd.sdkRoot` / `clangd.fmsCompatibilityVersion`）：此前 `Set System Includes` 探测到的 MSVC / Windows SDK 路径只存在于 `.clangd` 的 flag 文本里，任何一次重写 `.clangd`（切项目、换配置、面板保存自定义 flag）都会让它和实际选择脱节。现在路径与 fms 版本写入设置项，`.clangd` 的系统 flag 组（`/imsvc` / `-fms-compatibility-version`）由**唯一渲染入口** `writeClangdAddFlags` 统一重建；面板保存自定义 flag 改为**并集**合并，不再把 `system-include-windows` 覆盖掉；设置变更时自动重写 `.clangd`。**fms 兼容版本只有一个来源**：按**本次选中的** MSVC 读出，渲染 `.clangd` 与持久化设置项共用同一个值 —— 此前渲染用探测值、持久化用选中值，用户选了与探测结果不同的 MSVC 版本时，`-fms-compatibility-version` 会与 `/imsvc` 指向不同版本的 MSVC（`_MSC_VER` 与实际头文件冲突），且之后任何一次重写会写入另一个值，同一份 `.clangd` 内容前后不一致。

### Fixed

- **用户可见文案引导用户设置一个不存在的配置项**：`quickPicks.noEngines` 写的是「未检测到 Unreal Engine 安装。请手动设置 `vscodeUEHelper.engineRoot`」——但 `engineRoot` **从来不是**本插件的设置项（`package.json` 的 `contributes.configuration` 里没有这个键，`engineRoot` 只是内部参数名）。更糟的是 `showInfo.enginesFoundEmpty` 的**英文**文案同样是「config vscodeUEHelper.engineRoot」，而中文文案早就写对了（「在 .code-workspace 的 folders[] 中未声明」）——英文用户被误导，中文用户没有。引擎路径的唯一真相源是 `.code-workspace` 的 `folders[]`，已把两处文案改为指向该真相源并指明正确动作（在 UE 中重新生成项目文件 / 核对 `folders[]`），同时对齐了控制面板的 `panel.noProject.desc` / `panel.disabled.noProject` / `panel.disabled.noEngine` / `panel.cmdBlocked.noProject` —— 原文案说「当前工作区没有 .uproject 文件」，会让用户以为打开项目目录就够了，而实际前提是打开 UE 生成的 `.code-workspace`。
- **新增回归守卫 `test/unit/i18n/settingReferences.test.ts`**：i18n 文案里出现的每个 `vscodeUEHelper.<key>` 都必须是 `package.json` 里真实存在的设置项；文案不得出现 `engineRoot`；en/zh 键集合必须完全一致。已用注入法验证该守卫确实能抓到上述 bug（而非空转通过）。
- **`npm run lint` 此前就带 3 个 error**（`test/unit/ui/notifications.test.ts` 的 `require-await` 违规，与本次改动无关）——仓库宣称的 `npm run lint` 检查此前无法通过，已一并修正。

**本轮（19 条全仓库审计修复）分组说明：** 完整缺陷清单、落点与验收证据见 `.qiling/planning/bugfix/004-audit-19-defects.md`。

- **构建早退不写快照，AI 代理读到的是上一次的旧结果**：没选到项目 / 没选到引擎 / 并发守卫这三条早退路径都不写构建快照，`ue_get_build_errors` 因此把**上一次**构建的残留当成当前结果返回。现在每次构建带唯一 `buildId` + `startedAtIso`；本次调用若没写过快照（用户取消、转发 Live Coding 等路径一并覆盖），统一补写一条失败快照。构建进行中时明确返回 `hasResult:false` + `reason:'build-in-progress'`，不再返回陈旧快照；从未构建过时返回 `reason:'no-build'`。另外 MCP 的 `dispatch` 此前只 catch rejection，命令层 resolve 出来的错误信封连日志都没有 —— 现在 resolve 出的错误信封也会记 error 日志。
- **`Ctrl+Shift+B` 拿不到真正的 UBT 构建任务**：Task provider 此前只返回空壳任务。现在接入 `WorkspaceState`（项目 / 引擎），用 `resolveUBTPath` + `resolveUBTTarget` + `buildUBTCommand` 解析出真实命令行（`<engineRoot>/Engine/Build/BatchFiles/Build.bat` + target + configuration + platform），以 VS Code 构建任务执行；工作区尚未就绪时任务列表为空（表现为「没有可用的构建任务」，不报错）。**并且修掉了含空格路径下必然失败的问题**：UE 默认装在 `C:\Program Files\Epic Games\UE_5.x`，而 VS Code 的 Task 进程（`ProcessExecution`）会由 Node 对参数做 Windows 转义、内部引号被转义成 `\"`，叠加 `cmd.exe /c` 「引号总数恰好两个才整对保留」的规则 → 引擎路径与项目路径两个含空格参数会把路径截断，任务报 "The network path was not found."。现在整条 UBT 命令放进环境变量、命令行只留一个不含空格与引号的变量引用，展开后就是 `"<Build.bat>" <UBT 参数…>` 标准形态（实测六种形态，只有「环境变量」与「临时 .bat 包装」能跑通）。
- **工程路径含空格或 `&` 时启动不了编辑器**：`launchEditor` 此前走 `cmd /c start`，路径里的 `&` / 引号会被命令行当成元字符解析，编辑器起不来或起错实例。现在直接 `spawn` 可执行文件 + 参数数组（不经过 shell），并监听 `'error'` 事件把启动失败转成可捕获的错误。
- **构建与 Live Coding 可以同时跑，抢同一批文件**：新增 `src/build/lock.ts` 共享锁（`isBuildLocked` / `tryLockBuild` / `unlockBuild`），两条路径互斥，构建进行中再触发 Live Coding 会被挡下。
- **`.clangd` 写成多文档 YAML 后整个文件读不了、改不了**：`.clangd` 支持用 `---` 分隔多个 YAML 文档（clangd 按目录深度叠加配置），而旧实现用单文档 API 解析，遇到第二个文档直接抛 "Source contains multiple documents" —— `readConfig` 永远返回 `null`、`mutate` 直接返回 `parse-failed`，用户手写的其他配置块完全无法编辑。现在走 `src/clangd/clangdYaml.ts`（`parseClangdDocs` / `mergeConfigIntoDoc` / `renderClangdDocs`）逐文档解析：主文档承载 `CompileFlags`、其余文档原样保留写回，合并用递归 `map.set`，注释不再丢失。
- **新增源文件进不了编译数据库，补出来的条目还指向旧文件**：配置指纹不含任何 `.cpp/.h`，新增源文件不改指纹 → 快路径命中 → UBT 根本不启动。现在快路径命中后追加一次探针，确认确有新增源文件就强制走 UBT；同时补齐条目在克隆时同步替换命令行里的源文件路径（`arguments` 优先，回退到 `command` 末元素），clangd 才能拿到新文件的定义。
- **编译数据库在工程目录里找不到，一次刷新还被写两遍**：候选搜索顺序原先偏向引擎根，工程目录里的本地副本反而找不到；现在顺序为「项目本地副本 → helper 目录 → 引擎根 …」，本地副本即 `<projectDir>/compile_commands.json`（helper 目录里的同名文件是指向它的符号链接）。原先两处各自 `JSON.parse` 整份文件再整体覆盖写、无 temp+rename，一次刷新写两遍，且带缩进的序列化把几 MB 的 DB 放大数倍 —— 现在合并为**一次原子写**（temp + rename），序列化改紧凑格式。**写入目标改为「clangd 实际读取的那个文件」**：helper 目录里的 `compile_commands.json` 在 Windows 未开开发者模式时是 `fs.symlink` 失败后的**独立副本**（默认状态），此前固定写项目本地副本 → clangd 读到的一直是旧内容，补齐的条目与注入的 completionHelper 条目对它完全不可见且无任何报错；现在写入前先解析真实目标（符号链接 → 它指向的文件；独立副本 → 它自己），两种形态下 clangd 都能读到最新内容，符号链接也不会被 `rename` 换成普通文件。**全部 DB 写入点收敛为 4 处并逐处登记**（`src/clangd/AGENTS.md` 有一张对照表）：前 3 处（生成命令 / 补齐缺失条目 / 注入 completionHelper）都写「clangd 实际读取的那个文件」且**读与写是同一个文件**；第 4 处是 UBT 失败时的降级 stub DB，它的写入目标**本身就是** clangd 的读路径，因此故意不解析符号链接，但它同样改用统一的原子写原语（此前带缩进序列化，条目数 = 全部源文件数时体积放大数倍）。
- **MCP 通道的 stdout 被日志污染**：MCP 的 stdio 传输把 JSON-RPC 帧写进 `process.stdout`，而 `logger.info` 也走 stdout —— 任何一行 info 日志都会插进协议帧流。现在 Logger 增加「只写 OutputChannel、不写 console」的开关，MCP 激活时关闭、退出与启动失败时恢复。同时在 README 如实标注当前限制：MCP server 仍运行在扩展宿主进程内，外部客户端尚不能直连（独立进程化的前置条件是解耦 detection / commands 层的 vscode 依赖）。
- **代理收到一个未知参数就整进程退出**：参数解析遇到不认识的参数时直接退出，一个多余参数就能让 clangd 代理死掉。现在降级为 warning 并忽略该参数。
- **代理请求关联 id 串扰**：请求关联 key 只有裸 id，客户端与服务端用同一个 id 时响应会配到错误的请求上。现在 key 加 client / server 命名空间。
- **MCP 失败响应不带 `isError`，AI 代理永远走不到错误分支**：成功响应有四种形状、失败是 `{ok:false,error:{code,message}}`，但一律不带 MCP 标准字段 `isError:true` → Cursor / Claude Code 的错误分支永不触发。现在内部统一用一个响应构造器，对外顶层载荷形状保持不变（不破坏既有契约与 AI agent 侧），失败时在 MCP 层补 `isError:true`；契约同步拆出独立的 `MCPFailure` schema。
- **控制面板首屏空白**：`resolveWebviewView` 在 `projectName` 还是空的时候就同步赋值了 `webview.html`，首屏渲染成 `no-project` 被 CSS 藏掉；补救用的 `postMessage` 又早于 webview 加载完成，投递失败时完全静默。现在先 await 项目信息再赋 HTML（且**先注册**消息监听，避免 await 期间到达的 `panelReady` 丢失），webview 回报 `panelReady` 后重推全部状态，`postMessage` 投递失败记 warn。
- **webview 可以用伪造消息驱动扩展侧命令**：来自 webview 的命令消息与配置值此前只做字段存在性检查。现在用 null 原型对象 + `CONFIG_VALUE_KINDS` + `validateConfigValue` 校验，配置值类型不符直接拒绝。
- **UBT 刷新后恢复错了文件，`launch.json` 丢失**：备份与恢复各自独立地找「第一个 `.code-workspace`」，两次之间不共享文件名 → UBT 重写目录后可能恢复到另一个文件；文件头承诺保护的 `.vscode/launch.json` 从未被备份；恢复是直接覆盖、非原子。现在备份按原文件名存到 `.vscode/uehelper-backup/`，`snapshot()` 记录被备份的名字、`restore()` 只恢复它（找不到同名备份就不恢复并记 error），`launch.json` 一并纳入，恢复改 temp + rename。旧的单文件备份视为过期，直接忽略不迁移。
- **silent 模式仍然弹窗，AI 代理被卡在对话框前**：`silent` 只作用于选项目那一步，选 MSVC / SDK 版本的两个 QuickPick 与一个模态错误框照弹。现在 silent 路径直接采用自动检测到的 MSVC / SDK 版本、不弹任何窗，检测失败则返回明确错误信封；非 silent 路径的错误框改为非模态。
- **写数组类型设置会产生无意义 warning**：`Config.update` 写盘前的校验比较的是序列化字符串，数组 / 对象类设置每次都被判成「有变化」。现在改为按值比较。

## [0.2.0] - 2026-10-05

### Changed

- **ClangdLocator 统一 clangd 路径解析**（add-003，决策 D8）：此前插件内两条互相独立、已实际漂移的解析链路（clangd 代理的 `realClangdResolver` 6 级候选 / Windows SDK 探测的 `findClangdExecutable` 4 级候选）收敛为 `ClangdLocator` 单服务——懒探测 + 缓存 + 失效（扩展激活零 IO，首次使用才探测），默认 LLVM 目录列表与 `clangd --version` InstalledDir 推导全局唯一份；候选链统一为 7 级（覆盖项 → 插件 clangdPath → 第三方 clangd.path 当前值 → 备份值 → `where clangd` → PATH → 默认目录），配置三键（`clangdPath` / `clangdProxy.realClangdPath` / `clangd.path`）变更与 proxy 启停自动失效缓存。36 端点对外行为不变。
- **控制面板按项目可用性收敛**：工作区未检测到 `.uproject` 时面板整体不可用——显示"未检测到 UE 项目"空状态（隐藏全部分页与按钮），仅保留"创建 UE 项目"入口；检测到项目后自动恢复。检测到项目但无引擎时，UBT 类按钮（构建/重构建/清理/启动编辑器/Live Coding/生成编译数据库）按适用度置灰，诊断/工具/代理类按钮仍可用。扩展侧 `executeCommand` 增加服务端兜底校验（webview 的 disabled 可被伪造消息绕过），无项目/无引擎时拒绝执行并回推原因。
- **控制面板按钮适用档位**：`BUTTON_GROUPS` 每个按钮声明 `requirement`（`always` / `project` / `engine`），由 `COMMAND_REQUIREMENT` 查表供 webview 渲染与扩展侧兜底共用，`panelState` 消息把项目/引擎存在性推到 webview 驱动刷新（检测完成、可见性恢复、用户切换项目/引擎选择时）。

- **未检测到项目时不再弹"从 .uproject 重新生成工作区"**：`WorkspaceState` 的字段缺失通知此前在任何派生字段（projectDir / projectName / engineRoot 等）被读取且缺失时都会弹警告——哪怕 detection 根本没发现 `.uproject`（非 UE 工作区的正常场景）。现在无项目时只写日志、绝不弹窗；仅当"检测到了项目但字段仍缺失"这种真实异常才提示。
- **未检测到项目时状态栏整体隐身**：`detection.ready` 未发现任何 `.uproject` 时，插件的全部状态栏项不再显示——8 个操作按钮（含原先仍会显示的 Config / Target / 项目信息）全部隐藏，UHT 状态项与性能三段指标（`showPerfInStatusBar` 开启时）也不再出现；检测到项目后按需出现。
- **UHT 状态项改版**：原右下角"UE Link Sync"状态项（`UE✓` / `UE Sync` / `UE throttle` 等缩写）迁移到**左下角项目信息按钮右侧**，文案统一为简短自解释的 "UHT" 系列——空闲 `✓ UHT`、排队 `✏ UHT…`、节流倒计时 `🕐 UHT in 3.2s`、生成中 `⟳ UHT…`、完成 `✓ UHT 850ms`、失败 `✗ UHT Failed`；tooltip 全部改为中文详细说明（UnrealHeaderTool 状态机、耗时、生成头文件数、节流合并统计）。
- **状态栏项目信息按钮精简为仅项目名**：左下角按钮不再拼接"引擎版本 | 平台"段，只显示 `$(file-code) 项目名`；引擎版本（含路径）与平台保留在悬停 tooltip 中，信息不丢失。平台设置变化后 tooltip 同步刷新（按钮文本只依赖项目名，无需重绘）。
- **进度弹窗可自动隐藏**：新增 `vscodeUEHelper.progressLocation` 设置（默认 `window`）——构建 / Create Project / 生成 compile_commands 的进度改在状态栏显示小转圈，任务结束自动消失，不再弹出右下角通知弹窗（VS Code 的通知进度没有"自动折叠"API，状态栏位置是标准的不打扰方案）；设为 `notification` 可恢复旧的右下角弹窗行为。

### Added

- **`ue_build` 支持单模块编译**（add-002）：MCP 工具 `ue_build` 新增可选 `module` 参数（UBT 原生 `-Module=`，仅 `mode=build` 生效，其余模式忽略并返回 warning）——AI 代理改完单个模块后可秒级编译验证，不必全 target 构建。构建结果与快照（`ue_get_build_errors`）透出 module 过滤范围。
- **UE 惯例感知的源/头文件切换命令**：`vscodeUEHelper.switchHeaderSource`（快捷键 `Alt+O`，已挂编辑器右键菜单）。修复"从头文件切换经常跳到引擎 `ObjectMacros.h`"的问题——该症状来自 clangd 扩展 `clangd.switchSourceHeader` 的实现：它按"头文件符号在索引中的定义位置"投票选目标、平票取路径字典序最小者，UE 头文件符号定义分散且后台索引不完整时票源稀疏，`Engine/Source/Runtime/CoreUObject/Public/UObject/ObjectMacros.h` 的路径字典序几乎最靠前于是屡屡胜出（本插件预包含链进一步放大了引擎公共头在索引中的富集度）。新命令不依赖索引，改用确定性路径规则：同目录同 stem 互换扩展名 → `Public`↔`Private`↔`Classes` 目录互换（保留子路径，插件模块路径同样支持）→ `X.generated.h` 剥 `.generated` 双侧匹配 → `.inl` 对应主头文件 → workspace 同 stem 搜索兜底（排除 Intermediate/Binaries 等目录，多候选弹 QuickPick）。
- **编辑器感知构建**（借鉴 [engine-link](https://github.com/rmoubayed/engine-link) / [UE Build Bridge](https://marketplace.visualstudio.com/items?itemName=Alingkumo.unreal-engine-link) 的 editor-aware build）：`build` 前通过 `tasklist` 检测 Unreal Editor 是否运行，运行中则提示改走 Live Coding（避免 DLL 锁定失败），`editorAwareBuild` 设置可关闭；MCP / silent 调用自动跳过。
- **新增源文件提示刷新 compile_commands**（借鉴 [boocs/unreal-clangd](https://github.com/boocs/unreal-clangd)）：增量 watcher 现在区分 add/change/unlink，检测到新增 C++ 文件时按 10 分钟节流提示一键刷新编译数据库（`CompileCommandsRefreshHint`）。
- **MCP 工具扩到 9 个**（对齐 engine-link / UE Build Bridge 的工具面）：新增 `ue_rebuild`、`ue_clean`（独立工具名）与 `ue_get_build_errors` —— 返回最近一次构建的结构化诊断（error/warning 计数、出错文件去重、截断明细），让 AI 代理闭环"构建 → 读错误 → 修复"。
- **clang-tidy 行级屏蔽命令**（借鉴 boocs/unreal-clangd）：`vscodeUEHelper.noLintCurrentLine`（行尾 `// NOLINT`）与 `vscodeUEHelper.noLintNextLine`（上方 `// NOLINTNEXTLINE`），幂等跳过已屏蔽行，支持多光标，已挂编辑器右键菜单。
- **createProject 可选生成 .clang-format / .clang-tidy**（借鉴 boocs/unreal-clangd）：`scaffold.clangFormat`（默认开）与 `scaffold.clangTidy`（默认关）控制；只创建缺失项不覆盖已有配置；模板显式禁用会让 clang-tidy 在 Lyra 类项目崩溃的 `readability-static-accessed-through-instance`。
- **复制 UBT 构建命令**（借鉴 [vscode-boreal](https://github.com/mainframeindustries/vscode-boreal)）：`vscodeUEHelper.copyBuildCommand` 把当前项目/引擎/配置对应的 UBT 命令行（含 -Rebuild/-Clean）复制到剪贴板，便于在任意终端复现构建问题。
- **.clang-format 模板升级为 UE5 C++ 编码标准风格**：`scaffoldClangFormatAndTidy` 生成的 `.clang-format` 从"基础版"重写为对齐 Epic UE 编码标准 + 社区验证配置（[TensorWorks/UE-Clang-Format](https://github.com/TensorWorks/UE-Clang-Format)，MIT）的完整版——UE 反射宏识别（`StatementMacros`：GENERATED_BODY/UPROPERTY 等宏后的代码不再被错误缩进折行）、Allman 大括号（if/for/while 大括号换行）、Tab 缩进（4 宽，UE 标准）、case 标签/预处理指令/命名空间内容缩进、UE 枚举不折行、`ColumnLimit: 0` 不强制折行（UE_LOG/Slate 长表达式友好）、include 不自动排序（避免破坏编译语义）；需 clang-format/clangd ≥ 13（模板头已注明）。只影响新生成的文件，已存在的用户配置不覆盖。

### Fixed

- **MCP 服务器从未启动（extension.ts 未接线 activateMCP）**（bugfix-002）：任何宿主下 MCP 服务器都不会启动——AI 代理的 9 个 `ue_*` 工具全部拿不到（连接不上或 callTool 返回 `MCP_CONTEXT_NOT_INITIALIZED`）。根因是 `activate` 流程从未调用 `activateMCP`（MCP 模块改造时留下的 dead code，接线计划此后未落地）。修复后新增回归测试钉住激活链路（`extension.test.ts`）。
- **Live Coding 不再打开新项目实例**：点击 Live Coding 按钮此前 spawn 一个不带 `-Project` 的全新 `UnrealEditor.exe`（`-ExecCmds` 方式）——UE 弹出项目管理器且热重载作用在错误实例上。已改为 UBT `-LiveCoding` 官方方式：直接连接正在运行的编辑器触发热重载，不弹任何新窗口（编辑器未运行时回退为普通构建）；编译期间进度实时可见、可取消，失败时弹出 UBT 输出尾部错误。
- **设置/命令/视图的中文说明从未生效（非标准本地化字段）**：`package.json` 此前用 `description@zh` / `title@zh` / `name@zh` 字段写中文——VS Code 会忽略这些非标准字段，中文用户在设置界面只看到英文；且中文语言文件误命名为 `package.nls.zh.json`（VS Code 只加载 `package.nls.zh-cn.json`）。已全量迁移到标准 nls 机制：`package.json` 用 `%key%` 占位符，`package.nls.json`（英文默认）与 `package.nls.zh-cn.json`（简体中文）提供翻译——覆盖 22 个设置项（含 `progressLocation` 的枚举描述与 `clangd.userAddFlags` 的 markdown 说明）、26 个命令标题、2 个侧边栏视图名。新增 `nlsPlaceholders.test.ts` 守护测试（占位符缺键/孤儿键/`@zh` 回归/文件名）防再次失效。
- **控制面板分页无法切换（webview 脚本被注释截断）**：`controlPanel.html.ts` 内联脚本注释中含字面 `</script` 序列——HTML 解析器据此在注释中间提前终止 `<script>` 块，整个 IIFE 从未执行，分页/按钮/保存/状态刷新全部失灵，残余脚本文本被当作正文渲染。已改写注释并加回归测试（生成的 HTML 必须恰好一对 script 开合标签）。
- **激活提示**: 补齐 `package.json#activationEvents` 的 18 个缺失 `onCommand` 事件,使全部 22 个命令 ID 在被点击时立即触发激活,不再显示 "Extension 'VSCodeUEHelper' is activating…"。仓库根 AGENTS.md 与 `src/commands/AGENTS.md` 同步把"在 `activationEvents` 加 `onCommand`"纳入新增命令铁律,避免回归。
- **typecheck 清零**: 修复 `firstRunInit.test.ts` 中 5 处 mock 谓词解构的历史类型错误，`npm run typecheck` 恢复零错误。

## [0.7.0] — 2026-06-24

### Phase 7 — Release readiness

- Full integration test suite (`npm test`)
- Updated README with feature matrix and command reference
- Documentation reflects all 7 phases complete

## [0.6.0] — 2026-06-24

### Phase 6 — Tests & Docs

- Vitest unit tests for all parsers (MSVC, UBT, linker, uproject)
- Clangd YAML rendering tests
- Integration scenarios for MSVC + UBT interleaved output
- 18 tests passing across 4 files

## [0.5.0] — 2026-06-24

### Phase 5 — MCP Integration

- MCP server with `@modelcontextprotocol/sdk`
- 6 tools exposed: `ue_build`, `ue_launch_editor`, `ue_live_coding`,
  `ue_generate_compile_commands`, `ue_show_project_info`, `ue_toggle_completion_mode`
- Lifecycle detection: auto-starts in Cursor / Claude Code env, no-op elsewhere
- Cursor rules generator (`.cursor/rules/unreal-cpp.mdc`)
- GitHub Copilot instructions (`.github/copilot-instructions.md`)

## [0.4.0] — 2026-06-24

### Phase 4 — UI & Commands

- All 12 commands wired to real implementations:
  - `vscodeUEHelper.build` / `.rebuild` / `.clean`
  - `vscodeUEHelper.launchEditor`
  - `vscodeUEHelper.liveCoding` (Windows only)
  - `vscodeUEHelper.generateCompileCommands`
  - `vscodeUEHelper.createProject` (scaffolds `.clangd` + customization points)
  - `vscodeUEHelper.toggleCompletionMode` (status bar toggle)
  - `vscodeUEHelper.installRules` / `.uninstall`
  - `vscodeUEHelper.setSystemIncludes` (Phase 6 placeholder)
  - `vscodeUEHelper.showProjectInfo`
- Status bar widget shows project / engine / config / target
- QuickPick pickers for engine, project, configuration, target, platform
- Problems panel integration for MSVC diagnostics
- Output channel for build output
- Progress notifications

## [0.3.0] — 2026-06-24

### Phase 3 — Clangd IntelliSense

- `compile_commands.json` generation via UBT `-ProjectFiles` mode
- `.clangd` writer with MSVC warning suppression
- Preparse-includes for UE macros (fast/slow profiles)
- Workspace backup against UBT clobber (`.vscode/.code-workspace.backup`)
- Status-bar completion mode toggle (`UE⚡` / `UE⌚`)
- Bundled preparse lists: `ue5-fast.json` (18 headers), `ue5-slow.json` (49 headers)

## [0.2.0] — 2026-06-24

### Phase 2 — Build Layer

- UBT CLI construction (`buildUBTCommand`)
- Editor path resolution (`resolveEditorPath`, `resolveLiveCodingCmd`)
- Build runner with stdout/stderr streaming and abort signal
- MSVC parser (file(line,col): error/warning Cxxxx: message)
- UBT progress parser (`[N/M] description`)
- Linker parser (LNK2019, LNK1120)
- VS Code TaskProvider for `Ctrl+Shift+B`
- Cross-platform editor launch (cmd / open / direct exec)

## [0.1.0] — 2026-06-24

### Phase 1 — Detection

- `UprojectScanner` — scans workspace for `.uproject`, parses EngineAssociation
- `EngineDiscovery` — cross-platform:
  - Windows: `HKLM\SOFTWARE\EpicGames\Unreal Engine\<version>` registry
  - Mac: `~/Library/Application Support/Epic/UnrealEngine`, `/Users/Shared/Epic Games`
  - Linux: `~/UnrealEngine`, `/opt/UnrealEngine`, `/usr/local/UnrealEngine`
  - Env var `UE_ROOT` override
- `VsBuildTools` — Windows-only vswhere.exe detection + MSVC toolset path
- `WorkspaceContext` — Memento-persisted selection

## [0.0.0] — 2026-06-24

### Phase 0 — Foundation

- Project skeleton (TypeScript strict + esbuild + Vitest + ESLint + Prettier)
- 12 command palette entries registered
- 10 typed configuration options
- Core modules: `Logger`, `Config` (typed settings wrapper), `command-registry`
- Comprehensive plan saved to `.claude/plans/vscode-ue-helper-plan.md`
- `showProjectInfo` placeholder command
