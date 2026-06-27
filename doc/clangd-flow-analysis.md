# clangd 支持流程分析报告

> 生成时间: 2026-06-26
> 分析对象: VSCodeUEHelper vs 原版 unreal-clangd v3
> 原版源码: https://github.com/boocs/unreal-clangd (v3 分支)

---

## 1. 原版 v3 完整链路

```
createProject
  │
  ├─① writeClangdConfig
  │     写入 .clangd 到项目根
  │     内容包含 CompilationDatabase 指令，指向 .vscode/unreal-clangd/
  │
  ├─② updateCompileCommands
  │     通过 VS Code Task API 执行 UBT
  │     Windows 环境用 PowerShell.exe 包装
  │     参数（取决于 intellisenseType）:
  │       Non-Native: <Target> <Platform> Development <uproject> -Compiler=Clang -mode=GenerateClangDataBase
  │       Native:     -projectfiles -project=<uproject> -game -engine -dotnet
  │     产出位置: engine/.vscode/<projectName>/compile_commands.json
  │
  │     └─ onDidEndTask 事件回调
  │           copyNewlyCreated compile_commands.json → .vscode/unreal-clangd/
  │
  ├─③ createCompletionFiles
  │     生成补全头文件到 .vscode/unreal-clangd/
  │     (completionHelper.cpp, defaultCompletions.h, addCompletions.h, macroCompletionHelper.h, addMacroCompletions.h)
  │
  └─④ clangd 重启
        读取 .clangd
        CompilationDatabase: .vscode/unreal-clangd
        → 找到 compile_commands.json
        → clangd 索引 UE 源码 ✅
```

### 关键设计点

- **执行方式**: VS Code Task API (`vscode.tasks.executeTask` + `ShellExecution`)，非 spawn
- **Windows 包装**: PowerShell.exe + ShellQuoting.Strong
- **事件驱动**: onDidEndTask 回调处理 UBT 完成，非阻塞等待
- **文件交付**: UBT 产出后通过 copyNewlyCreated 拷贝到固定目录
- **clangd 配置**: .clangd 中通过 CompilationDatabase 指令显式指定路径
- **默认模式**: intellisenseType 默认为 "Native"（用户不触发 Clang 工具链检查）

---

## 2. VSCodeUEHelper 当前状态 —— 三道断裂口

```
createProject
  │
  ├─① writeClangdConfig → 写 .clangd
  │     ❌ 缺口1: 不含 CompilationDatabase 指令
  │        clangd 无法知道 compile_commands.json 在哪里
  │
  ├─② generateCompileCommands → UBT Task 执行
  │     产出: engine/.vscode/<projectName>/compile_commands.json
  │     ❌ 缺口2: linkToWorkspaceRoot() 未被调用
  │        compile_commands.json 留在 engine 目录，不到项目根
  │
  ├─③ addCompletionHelperToCompileCommands
  │     ❌ 缺口3: 去 projectDir/compile_commands.json 找文件
  │        实际文件在 engine/.vscode/<projectName>/ 下
  │        → 找不到 → 静默跳过
  │
  └─④ clangd 在项目根找不到 compile_commands.json ❌
```

### 断裂口详细

| # | 文件 | 行 | 问题 | 影响 |
|---|------|-----|------|------|
| 1 | .clangd 生成逻辑 | - | 缺少 `CompilationDatabase:` 指令 | clangd 不知道去哪里找 compile_commands.json |
| 2 | createProject.ts | step 2 后 | 未调用 linkToWorkspaceRoot() | 文件留在 engine 目录 |
| 3 | completionFiles.ts | ~353 | 查找路径 projectDir/compile_commands.json | 路径错误，step 4 静默跳过 |

---

## 3. 修复历史回溯（14 轮迭代）

| 轮次 | 问题 | 根因 | 修复 |
|------|------|------|------|
| 1 | spawn EINVAL | 直接 spawn .bat，无 shell 包装 | cmd.exe /c 包装 |
| 2 | 路径残留 .vscode/unreal-clangd | 未做命名迁移 | 统一为 .vscode/vscodeuehelper |
| 3 | 找 Saved/ 目录 | 自作主张加子目录 | 改为项目根 |
| 4 | 错误 UBT 模式 | 猜的 -Mode=GenerateProjectFiles | 改为 GenerateClangDataBase |
| 5 | 双引号被 cmd /c 转义 | Windows spawn 引号语义错误 | 尝试 shell: true |
| 6 | exit code 1 当失败 | 不认识 -projectfiles 返回码 | 放宽到 0 或 1 |
| 7 | 基于幻觉分析 | dev-vp 编造了 v3 源码引用 | 真实 v3 分支验证 |
| 8-10 | 反复微调 spawn 参数 | 执行模型根本不同 | 完全重写为 Task API |
| 11 | Clang 工具链报错 | 默认 Non-Native 传 -Compiler=Clang | 待定 |

**教训**: 前面 10 轮全在修"生成"环节，但"生成后怎么喂给 clangd"的后链路（缺口 1/2/3）从未触及。

---

## 4. 核心差异总结

| | 原版 v3 | VSCodeUEHelper |
|--|---------|---------------|
| 执行方式 | VS Code Task API | VS Code Task API ✅ |
| Windows 包装 | PowerShell.exe | PowerShell.exe ✅ |
| UBT 双路径 | Native / Non-Native | Native / Non-Native ✅ |
| .clangd CompilationDatabase | ✅ 有 | ❌ 缺失 |
| linkToWorkspaceRoot 调用 | ✅ copyNewlyCreated | ❌ 未调用 |
| 默认模式 | Native | Non-Native |
| 后链路（文件→clangd） | ✅ 完整 | ❌ 三道口子 |

