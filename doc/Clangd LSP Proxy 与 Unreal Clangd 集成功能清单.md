1. clangd 配置生成模块
1.1 .clangd 生成方式
- 使用 yaml 库生成 .clangd，不再手写 YAML 字符串。
- 生成单一 YAML 文档。
- 不使用 managed block 标记。
- 直接覆盖旧 .clangd，避免重复 CompileFlags / Diagnostics / InlayHints / Index。
- 禁止 YAML 自动折行，避免 /imsvc...Microsoft Visual Studio... 被拆成多行。
- If 使用对象格式，而不是数组格式：
If:
  PathMatch:
    - ...
1.2 .clangd 参数结构
- 生成 If.PathMatch：
- .vscode/vscodeuehelper/completionHelper.cpp
- Source/.*\.(cpp|h)
- 生成 CompileFlags.CompilationDatabase：
- .vscode/vscodeuehelper
- 生成 CompileFlags.Compiler：
- 指向 clang-cl.exe
- 生成 CompileFlags.Add：
- /X
- /imsvc... Windows SDK 路径
- /imsvc... MSVC include 路径
- -fms-compatibility-version=...
- /std:c++20
- /FI...macroCompletionHelper.h
- /TP
- -mwaitpkg
- MSVC warning flags：
- /we4668
- /wd4244
- /wd4838
- /W4
- /wd5054
- 大量 Clang warning flags：
- -Werror
- -Wshadow
- -Wundef
- -Wdelete-non-virtual-dtor
- -Wenum-conversion
- -Wbitfield-enum-conversion
- -Wno-* 系列 UE 兼容警告项
- 生成 InlayHints：
- Enabled: Yes
- ParameterNames: Yes
- DeducedTypes: Yes
- Designators: Yes
- 生成 Diagnostics：
- UnusedIncludes: None
1.3 clangd 22.x 兼容性
- 不生成 Preamble: 配置。
- 不生成 Hover: 配置。
- 不生成 Completion: 配置。
- 不在 If 块内生成 Index。
- CompilationDatabase 必须放在 CompileFlags 内部。
2. Windows SDK / MSVC 检测模块
2.1 系统头文件检测
- 自动检测 Windows SDK include 路径：
- cppwinrt
- shared
- ucrt
- um
- winrt
- 自动检测 MSVC include 路径。
- 自动检测 MSVC compiler version，用于生成：
- -fms-compatibility-version=...
2.2 UE 推荐 SDK 版本
- 读取引擎路径下：
Engine\Config\Windows\Windows_SDK.json
- 优先使用 UE 推荐的 Windows SDK 版本。
- 如果推荐版本找不到，则使用本机最新可用版本。
2.3 /imsvc 格式
- 使用模板风格：
/imsvcC:\...
- 不使用：
/imsvc"C:\..."
- 不让 YAML 自动折行。
3. compile_commands.json 生成模块
3.1 UBT 调用方式
- 默认使用：
-mode=GenerateClangDatabase
- 不默认使用：
-projectfiles
- 因为 -projectfiles 只生成 VS project files，不生成可靠的 compile_commands.json。
3.2 UBT 路径检测
- 优先支持 UE 5.x 的：
Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.exe
- 兼容 UE 4.x / 旧版本：
Engine\Build\BatchFiles\RunUBT.bat
- Unix/macOS 使用：
RunUBT.sh
3.3 LLVM_PATH
- 自动检测 LLVM / clang 安装目录。
- 如果用户配置了 clangd/clang 路径，优先使用。
- 将 LLVM_PATH 注入 UBT 进程，避免：
Clang x64 must be installed
3.4 输出定位
- 优先查找：
<EngineRoot>\compile_commands.json
- 备选查找：
- 项目 .vscode/vscodeuehelper/compile_commands.json
- 项目根 compile_commands.json
- 引擎 .vscode/<ProjectName>/compile_commands.json
- 引擎 .vscode/unreal-clangd/compile_commands.json
- 必须检查文件非空，避免接受 [] 或 0 字节文件。
3.5 链接/复制到项目目录
- 将生成的 compile_commands.json 放到：
<ProjectRoot>\.vscode\vscodeuehelper\compile_commands.json
- 避免符号链接被覆盖导致 0 字节问题。
- 倾向于直接 copy，减少 Windows symlink 问题。
3.6 RSP 文件处理
- 确认 compile_commands.json 中的 @rsp 引用存在。
- 确认 rsp 文件链存在：
- 单文件 .cpp.obj.rsp
- 模块级 Shared.rsp
- Shared.rsp 中应包含大量 UE /I 路径。
- 移除或规避可能干扰 clangd 的 PCH 相关参数：
- /Yu...
- /Fp...
- 保留必要的：
- /FI...Definitions...
- /FI...SharedPCH...
4. Create Unreal Clangd Project 主流程模块
4.1 Step 1：写 .clangd
- 按模板参数生成完整 .clangd。
- 包含：
- If.PathMatch
- Compiler
- Windows SDK / MSVC flags
- warning flags
- macro helper /FI
- 直接覆盖旧 .clangd，防止重复块。
4.2 Step 2：生成 compile_commands.json
- 使用 GenerateClangDatabase 模式。
- 注入 LLVM_PATH。
- 生成后复制到 .vscode/vscodeuehelper。
- 检查文件非空。
4.3 Step 3：创建补全文件
- 创建：
- addCompletions.h
- addMacroCompletions.h
- defaultCompletions.h
- macroCompletionHelper.h
- completionHelper.cpp 或对应辅助文件
4.4 Step 4：补全 compile_commands 条目
- 将 completion helper 加入 compile_commands。
- 对项目中新文件 / 头文件补齐 compile command 条目。
- 确保用户 .h / .cpp 文件可被 clangd 正确解析。
4.5 Step 5：完成提示
- 显示生成结果。
- 不误导用户说系统 include 已配置，除非确实已经生成。
- 提醒需要重启 clangd / reload VS Code。
5. clangd 性能优化模块
5.1 VS Code tab 保活
- 自动/建议写入：
"workbench.editor.enablePreview": false
"workbench.editor.enablePreviewFromQuickOpen": false
"workbench.editor.limit.enabled": false
- 目标：
- 避免切换文件时 VS Code 发送 didClose
- 尽量让 clangd 保留活跃文件 AST
5.2 clangd 参数优化
- 支持/推荐写入：
"--pch-storage=disk"
"--background-index"
"--background-index-priority=background"
"-j=4"
"--header-insertion=never"
"--completion-style=bundled"
"--limit-results=100"
"--limit-references=2000"
"--log=error"
- 可选模式：
- --pch-storage=disk
- --pch-storage=memory
- 可选前台流畅模式：
- --background-index=false
- -j=2
5.3 VS Code 请求降噪
- 可选写入：
"editor.inlayHints.enabled": "offUnlessPressed"
"editor.lightbulb.enabled": "off"
"editor.codeActionsOnSave": {
  "source.fixAll": "never",
  "source.organizeImports": "never"
}
- 目标：
- 减少 codeAction
- 减少 inlayHint
- 减少切换文件时的取消请求噪音
5.4 文件监听排除
- 推荐 search.exclude 排除：
- .vs
- Binaries
- DerivedDataCache
- Saved
- Intermediate
- 推荐 files.watcherExclude 排除：
- .vs
- Binaries
- DerivedDataCache
- Saved
- 谨慎排除 Intermediate 的 watcher，因为其中有 UHT/RSP 产物。
6. clangd LSP Proxy 模块
6.1 Proxy 基础功能
- 新增可选 clangd LSP proxy。
- 通信链路：
VS Code clangd extension
  → vscodeuehelper-clangd-proxy
  → real clangd.exe
- 支持 stdio LSP framing：
Content-Length: ...
6.2 didClose 保活 AST
- 拦截：
textDocument/didClose
- 不立即转发给 clangd。
- 延迟转发 / LRU 回收。
- 目标：
- 让 clangd 认为最近关闭的文件仍然 open
- 保留 ASTWorker / AST 缓存
6.3 didOpen 处理
- 如果文件仍被 proxy 保活：
- 不转发 didOpen
- 改为发送 didChange 同步最新文本
- 避免 clangd 报“文件已打开”。
6.4 LRU / TTL 策略
- 配置：
- keepaliveMax
- keepaliveTtlSec
- 推荐默认：
- keepaliveMax = 10 或 20
- ttl = 600 或 900 秒
- 超限时真正转发最老的 didClose。
6.5 Proxy 设置项
- vscodeUEHelper.clangdProxy.enabled
- vscodeUEHelper.clangdProxy.keepaliveMax
- vscodeUEHelper.clangdProxy.keepaliveTtlSec
- vscodeUEHelper.clangdProxy.realClangdPath
- vscodeUEHelper.clangdProxy.logPath
6.6 Proxy 命令
- Enable Clangd Proxy
- Disable Clangd Proxy
- Show Clangd Proxy Status
6.7 Proxy 启用/禁用
- 启用时修改：
- clangd.path
- clangd.arguments
- 真实 clangd 参数通过 -- 分隔后转发。
- 禁用时恢复用户原有配置。
- 原始配置保存到 workspaceState。
7. clangd LSP Proxy 汉化模块
7.1 诊断汉化
- 拦截：
textDocument/publishDiagnostics
- 修改：
- diagnostics[].message
- relatedInformation[].message
- 默认模式：
- 英文原文 + 中文解释追加
7.2 Code Action 汉化
- 拦截：
textDocument/codeAction
- 修改：
- CodeAction.title
- CodeAction.disabled.reason
- 不修改：
- edit
- command
- data
7.3 Hover 汉化
- 拦截：
textDocument/hover
- 翻译普通说明文本。
- 不翻译代码块。
- 默认追加中文解释。
7.4 Completion 文档汉化
- 后续可选。
- 可汉化：
- CompletionItem.documentation
- CompletionItem.detail
- 不修改：
- label
- insertText
- textEdit
7.5 翻译方式
- 第一版使用规则表。
- 不使用在线 LLM。
- 支持常见 clangd 报错：
- incomplete type
- unknown type name
- undeclared identifier
- no member named
- no matching function
- file not found
- macro redefinition
7.6 汉化配置项
- vscodeUEHelper.clangdProxy.localization.enabled
- vscodeUEHelper.clangdProxy.localization.mode
- append
- replace
- vscodeUEHelper.clangdProxy.localization.targets
- diagnostics
- codeActions
- hover
8. VS Code 设置管理模块
8.1 自动写入 clangd 设置
- 写入/更新：
- clangd.arguments
- clangd.path
- clangd.detectExtensionConflicts
- 避免覆盖用户自定义配置，必要时备份。
8.2 自动写入 editor 设置
- 可写入：
- 关闭 preview tab
- 关闭 editor limit
- 降低 inlayHint / lightbulb / codeAction 噪音
8.3 配置备份与恢复
- 启用 proxy 前备份原配置。
- 禁用 proxy 时恢复原配置。
- 存储位置：
- workspaceState
- 或 .vscode/vscodeuehelper/settings-backup.json
9. 测试与验证模块
9.1 .clangd 结构验证
- 单一 CompileFlags
- 无重复 key
- If 是对象，不是数组
- /imsvc 不折行
- CompilationDatabase 在 CompileFlags 内部
9.2 compile_commands 验证
- 文件非空。
- 包含项目源文件条目。
- @rsp 文件存在。
- Shared.rsp 存在。
- Shared.rsp 包含大量 /I 路径。
9.3 clangd 日志验证
- 无 Unknown Config key
- preamble 正常构建。
- 切换文件时减少 didClose
- proxy 模式下 didClose 被延迟。
- 功能验证：
- 定义跳转
- 补全
- 宏识别
- diagnostics
9.4 性能验证
- 首次打开文件耗时。
- 切换回文件耗时。
- 重启 VS Code 后打开耗时。
- clangd 内存占用。
- pch 缓存目录大小。