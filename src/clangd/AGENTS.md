# clangd 模块知识库

## 模块概述

**clangd 智能提示集成**，负责：
- 生成 `compile_commands.json` (通过 UBT)
- 写入 `.clangd` 配置文件
- Preparse-includes UE 宏补全文件系统
- 工作区备份防 UBT 覆盖
- fast/slow 补全模式切换

## 核心文件

| 文件 | 职责 |
|---|---|
| `clangdConfig.ts` | 读/写 `.clangd` 配置，系统包含路径管理 |
| `clangdOps.ts` | [Phase 8] 统一 .clangd 操作 API（mutate / setAddFlag / replaceAddBlock）—— 22 callers |
| `compileCommands.ts` | 跑 UBT 生成 compile_commands.json |
| `compileCommandsFallback.ts` | UBT 失败时的 fallback DB |
| `compileCommandsCache.ts` | 缓存层 |
| `completionMode.ts` | fast/slow 模式控制器 + 状态栏（**[Pitfall]** 模式已合并，仅 slow） |
| `completionFiles.ts` | UE 宏补全文件系统 (addCompletions.h 等)；含撒谎兼容层 |
| `preparseIncludes.ts` | 打包的头文件列表 (curated vs comprehensive) |
| `workspaceBackup.ts` | 备份/恢复 .code-workspace 防 UBT 覆盖 |
| `windowsSdk.ts` | MSVC + Windows SDK 路径发现 |
| `ueClangdCompat.ts` | UE + clangd 兼容层（重写 BODY_MACRO_COMBINE） |
| `ueMacroCompletionProvider.ts` | VS Code LSP CompletionItemProvider（UE 宏补全） |
| `ueMacroCompletions.ts` | UE 宏补全数据结构 |
| `ueReflectionLinter.ts` | UE 反射 linter |
| `proxyManager.ts` | 接管检测状态后构建 proxy CLI 参数 |
| `fileWatcher.ts` | IncrementalFileWatcher (chokidar) |
| `intermediateUhtCollector.ts` | Intermediate/Build/.../UHT 收集 |
| `headerCache.ts` | `.h` 指纹缓存 |
| `fingerprint.ts` | 配置指纹（缓存键） |
| `flagGlossary.ts` | clangd flag 词典（hover 提示） |
| `perfLog.ts` | 轻量 perf 埋点单例（activation.elapsed 等事件） |
| `perfProxy.ts` | LSP proxy 开销测量（P50/P95/P99 + RSS） |
| `types.ts` | clangd 模块公共类型（CompileCommandsEntry / ClangdConfig） |
| `modifyRspFiles.ts` | 监听 .rsp 改动并写 .clangd ModifyFile 块（P2-1，Phase 11 引入） |
| `createRspMatchers.ts` | 构造 .rsp → .clangd 转换的 matchers |
| `proxyLogChannel.ts` | proxy 输出 channel 包装（轻量占位） |
| `proxyLogTailer.ts` | tail 真实 clangd 日志，UI 显示用 |
## 子目录

- **`proxy/`** —— 独立 LSP 代理 CLI 进程（17 文件）。详见 `src/clangd/proxy/AGENTS.md`。
- **`diagnostics/`** —— "Diagnose Clangd Project" 命令的内部检查器（checks / format / io / types）。**无 index.ts**，从 `diagnoseProject.ts` 内部相对导入。

## 关键数据流

### compile_commands.json 生成
```
executeGenerateCompileCommands()
  └── generateCompileCommands()
       ├── 跑 UBT -ProjectFiles
       └── linkToWorkspaceRoot()  → 符号链接到工作区根
```

### 补全模式切换
```
executeToggleCompletionMode()
  └── CompletionModeController.toggle()
       ├── 切换 config.completionMode
       ├── 重写 .clangd 的 CompileFlags.Add
       └── refresh 状态栏
```

### ueClangdCompat 兼容头

`createCompletionFiles` 在 `.vscode/vscodeuehelper/` 下写入 `ueClangdCompat.h`，`.clangd` 通过 `/FI` 强制在 UE 头之前包含它。该头重写 `BODY_MACRO_COMBINE` 宏，使 `UCLASS()` / `GENERATED_BODY()` 在 `.generated.h` 过期或缺失时仍能展开为合法 C++，避免 clangd 报 `unknown_typename` 错误。

## Fast vs Slow 模式

| 维度 | Fast (curated) | Slow (comprehensive) |
|---|---|---|
| 头文件数 | ~18 个 | ~49 个 |
| 索引速度 | 快 | 慢 |
| 宏覆盖 | 常用核心宏 | 几乎所有 UE 宏 |
| 默认 | ✅ | ❌ |

## .clangd 配置结构

```yaml
CompileFlags:
  Add:
    - --target=x86_64-pc-windows-msvc
    - -std=c++20
    - ... 更多 flag
    - -include${workspaceFolder}/.vscode/unreal-clangd/addCompletions.h
  Remove:
    - -W*
    - /W*
Diagnostics:
  UnusedIncludes: Strict
  MissingIncludes: Strict
InlayHints:
  Enabled: Yes
  ParameterNames: Yes
  DeducedTypes: Yes
```

## 系统包含路径发现

Windows 上需要 MSVC 和 Windows SDK 头文件让 clangd 找到 `#include <windows.h>` 等。

发现顺序：
1. `vswhere.exe` → MSVC 安装路径
2. 枚举 `Microsoft Visual Studio/<version>/BuildTools/VC/Tools/MSVC/<version>/include`
3. Windows SDK `Program Files (x86)/Windows Kits/10/Include/<version>/um` + `/ucrt`

## 工作区备份机制

UBT 跑 `-ProjectFiles` 时会**重写** `.code-workspace`，丢失用户的引擎文件夹配置。

解决方案：
1. UBT 运行前：备份 `.code-workspace` 到临时文件
2. UBT 完成后：从备份恢复
3. backup 实例注入 UBT 调用链

## 关键类型

```typescript
interface ClangdConfig {
  CompileFlags: { Add: string[]; Remove: string[] };
  Diagnostics: { UnusedIncludes: string; MissingIncludes: string };
  InlayHints: { Enabled: string; ParameterNames: string; DeducedTypes: string };
}

interface CompileCommandsEntry {
  directory: string;
  command: string;
  file: string;
}

type CompletionMode = 'fast' | 'slow';
```
