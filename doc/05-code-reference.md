# 05 · 代码说明（关键算法详解）

> 本文档深入解释项目里**最容易踩坑**的几块代码：为什么这么写、关键决策、失败模式。

---

## 目录

1. [.code-workspace 路径解析](#1-code-workspace-路径解析)
2. [clangd 路径发现（InstalledDir）](#2-clangd-路径发现installeddir)
3. [UBT target 名解析](#3-ubt-target-名解析)
4. [Windows 进程管理（spawn / kill）](#4-windows-进程管理spawn--kill)
5. [JSON5 vs JSON 解析 .uproject](#5-json5-vs-json-解析-uproject)
6. [detection.ready Promise 模式](#6-detectionready-promise-模式)
7. [状态栏 11 个按钮的渲染](#7-状态栏-11-个按钮的渲染)
8. [withProgress 桥接 CancellationToken](#8-withprogress-桥接-cancellationtoken)
9. [compile_commands.json 的 symlink 策略](#9-compile_commandsjson-的-symlink-策略)

---

## 1. .code-workspace 路径解析

**文件**：`src/detection/index.ts:58-141`

### 为什么完全信任 `.code-workspace`？

之前的版本会扫描整个 workspace 找 `.uproject`，还从 `.uproject` 的 `EngineAssociation` 字段反查引擎。两种都不可靠：
- **扫描整个 workspace**：慢，多 workspace 混乱
- **EngineAssociation 字段**：UE 5.x 用的是 GUID 不是版本号（如 `{CDB3CAF5-...}`），反查不出

**正确做法**：让用户**显式**在 `.code-workspace` 里声明项目 + 引擎：

```json
{
  "folders": [
    { "name": "XianDreamwalking", "path": "." },          ← 项目根目录
    { "name": "UE5",              "path": "D:\\Program Files\\UE_5.8" }  ← 引擎根目录
  ]
}
```

按位置约定：
- `folders[0]` = 项目根目录
- `folders[1]` = 引擎根目录

### 路径解析细节

```ts
const workspaceFile = vscode.workspace.workspaceFile;
// → { scheme: 'file', fsPath: 'E:\\Dream\\XianDreamwalking\\XianDreamwalking.code-workspace' }

const raw = await fs.readFile(workspaceFile.fsPath, 'utf-8');
const folders = JSON.parse(raw).folders ?? [];
// 注意：.code-workspace 是合法 JSON（不是 JSON5），用 JSON.parse 即可

const projectEntry = folders[0];
const projectAbsPath = path.resolve(workspaceRootDir, projectEntry.path);
// path.resolve 处理相对路径（"."）和绝对路径
const uprojectPath = path.join(projectAbsPath, `${projectEntry.name}.uproject`);
```

### 失败处理策略

| 失败 | 行为 |
|---|---|
| `workspaceFile` undefined | `logger.error('no .code-workspace is open')` + 返回空 |
| `folders[0]` 不存在 | `logger.error('folders[0] missing')` + 返回空 |
| `.uproject` 不存在 | `logger.error` + 返回 `{projects:[], engines:[]}` |
| `folders[1]` 不存在 | `logger.error` 但**仍然**返回 project（只 engines 空） |
| `Build.version` 不存在 | `logger.error` + 返回 `{projects, engines:[]}` |

注意：**没有 catch + return fallback**。找不到就是找不到 —— 不假装找到。

---

## 2. clangd 路径发现（InstalledDir）

**文件**：`src/clangd/windowsSdk.ts:32-194`

### 难点

Windows 上 clangd / clang++.exe / cl.exe 的位置不固定：
- LLVM 默认装到 `C:\Program Files\LLVM\bin\`
- 但用户可能用其他安装器
- 也可能用 `winget install LLVM.LLVM`
- 也可能从 VS Build Tools 自带

不 hardcode 任何路径，而是 **让 clang 自己告诉你**。

### 步骤

```ts
// Step 1: 找 clangd.exe（任意来源都行）
const clangdExe = await findClangdExecutable(clangdPath);
// 顺序：用户配置 → `where clangd` → PATH walk → 默认 LLVM 路径

// Step 2: 跑 clangd --version 拿 InstalledDir
const { stdout } = await execFileAsync(clangdExe, ['--version']);
// clangd version 19.1.0
// Target: x86_64-pc-windows-msvc
// Thread model: posix
// InstalledDir: C:\Program Files\LLVM\bin    ← 这个！

// Step 3: 从 InstalledDir 拼出 clang++.exe
const clangPP = path.join(installedDir, 'clang++.exe');

// Step 4: 跑 clang++.exe -v -E -xc++ - 拿系统 include 搜索列表
const { stderr } = await execFileAsync(clangPP, ['-v', '-E', '-xc++', '-']);
// clang version 19.1.0
// Target: x86_64-pc-windows-msvc
// Thread model: posix
//  "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\VC\\Tools\\MSVC\\14.39.33519\\include"
//  "C:\\Program Files (x86)\\Windows Kits\\10\\Include\\10.0.22621.0\\ucrt"
//  ...
// End of search list.

// Step 5: 从 include 路径识别 MSVC root 和 SDK root
// 规则：路径里倒数第二个 segment 是 "MSVC" → MSVC root
// 路径里 segment 序列是 ".../Windows Kits/10/Include/<ver>" → SDK root
```

### 关键代码段

```ts
function identifyRoots(paths: string[]): { msvcRoot: string | null; sdkRoot: string | null } {
  let msvcRoot: string | null = null;
  let sdkRoot: string | null = null;

  for (const p of paths) {
    const parts = p.split(/[\\/]/);
    const verIdx = parts.findIndex((s) => /\d/.test(s));  // 找含数字的 segment（版本号）
    if (verIdx < 1) continue;
    const versionRoot = parts.slice(0, verIdx + 1).join(path.sep);
    const parentName = parts[verIdx - 1]?.toLowerCase();

    if (parentName === 'msvc' && !msvcRoot) {
      msvcRoot = versionRoot;
    } else if (parentName === 'include' && parts[verIdx - 2]?.toLowerCase() === '10' && !sdkRoot) {
      // .../Windows Kits/10/Include/<ver>/
      sdkRoot = versionRoot;
    }
  }

  return { msvcRoot, sdkRoot };
}
```

### 为什么用 clang 反向推断 vs vswhere？

| 方法 | 优 | 劣 |
|---|---|---|
| **clang 反向**（我们用） | 100% 准确（clang 已经在用） | 需要 clang 已装好 |
| **vswhere** | 不依赖 clang | 多个 VS 装时要选；VS Build Tools 可能没 vswhere |

clang 方法对 UE C++ 用户更可靠 —— 他们必然装了 clangd。

---

## 3. UBT target 名解析

**文件**：`src/build/ubt.ts:resolveUBTTarget()`

### 问题

UBT 期望的 target 名是 `<ProjectName><Suffix>` 形式：
- `XianDreamwalking.uproject` → target = `XianDreamwalking` 或 `XianDreamwalkingEditor`
- 不是字面量 `Editor`

我们 `Config.target` 存的是类型 `Editor | Game | Server | Client`，要转换成实际 target 名。

### 实现

```ts
export function resolveUBTTarget(uprojectPath: string, type: string): string {
  const projectName = path.basename(uprojectPath, '.uproject');
  switch (type) {
    case 'Editor':  return `${projectName}Editor`;
    case 'Server':  return `${projectName}Server`;
    case 'Client':  return `${projectName}Client`;
    default:        return projectName;  // Game
  }
}
```

调用方：

```ts
// src/commands/build.ts
const cmd = buildUBTCommand({
  project: project.path,
  target: resolveUBTTarget(project.path, config.target),  // ← Editor → XianDreamwalkingEditor
  ...
});
```

### 没这个会怎样？

UBT 报：
```
Couldn't find target rules file for target 'Editor' in rules assembly 'UE5Rules'
Result: Failed (RulesError)
```

这是真实的 bug 历史 —— 当时 status bar 显示 `$(symbol-class) Editor`，我直接传 `'Editor'` 给 UBT，构建失败。修复后才正常。

---

## 4. Windows 进程管理（spawn / kill）

**文件**：`src/build/buildRunner.ts`

### 坑 1: 不能直接 spawn `.bat`

```ts
// ❌ 错误 —— Node 返回 EINVAL
spawn('Build.bat', [...args]);

// ✅ 正确 —— 用 cmd.exe /c 包装
spawn('cmd.exe', ['/c', 'Build.bat', ...args], { ... });
```

Node 在 Windows 上不支持直接执行 `.bat` / `.cmd` 文件（Linux 也不支持但有 shebang 机制）。

### 坑 2: 不能只 kill 子进程

```ts
// ❌ 错误 —— 只杀 cmd.exe，Build.bat / dotnet / UnrealBuildTool 继续跑
child.kill();

// ✅ 正确 —— 杀整个进程树
async function killTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === 'win32') {
    await execFileAsync('taskkill', ['/F', '/T', '/PID', String(pid)]);
    // /F = force, /T = tree (包括子进程)
  } else {
    try {
      process.kill(-pid, 'SIGTERM');  // 负 pid = 进程组
    } catch {
      child.kill('SIGTERM');
    }
  }
}
```

POSIX 路径需要 `spawn(..., { detached: true })` 让子进程成为进程组 leader。

### 坑 3: AbortSignal 必须桥接到 CancellationToken

VS Code 的 `vscode.window.withProgress` 接受 `CancellationToken`，但 `runBuild` 用的是 Web 标准 `AbortSignal`。需要桥接：

```ts
const controller = new AbortController();
token.onCancellationRequested(() => controller.abort());
await runBuild(cmd, { signal: controller.signal, ... });
```

详见 §8。

---

## 5. JSON5 vs JSON 解析 .uproject

**文件**：`src/detection/uprojectScanner.ts`

### UE 的 .uproject 不是合法 JSON

实际例子：

```json
{
    "FileVersion": 3,
    "Modules": [
        {
            "Name": "XianDreamwalking",
            ...
        }
    ],
    "Plugins": [
        {
            "Name": "ModelingToolsEditorMode",
            "Enabled": true
        },
        {
            "Name": "CommonUI",
            "Enabled": true
        },    ← 尾部逗号！JSON 不允许
    ]
}
```

`JSON.parse` 失败 → 整个 project 检测失败 → status bar 显示 `No Project`。

### 修复：用 JSON5

```ts
import * as JSON5 from 'json5';
raw = JSON5.parse(text) as RawUProject;
```

JSON5 容忍：
- 注释（`//` 和 `/* */`）
- 尾部逗号
- 单引号字符串
- 未引号的属性名

依赖 `json5` 包（已在 `package.json`）。

### 找到 bug 的过程

用户报告"路径都对了，但状态栏显示 No Project"。我：
1. 跑 typecheck / build / tests —— 都通过
2. 看日志：`projects=0` 但 `folder count: 2`
3. 怀疑是 `fs.readdir` 在 extension host 失败（其实是死路）
4. 用 Node 脚本独立验证：`JSON.parse(uproject)` 失败 —— `Unexpected token ']'`
5. 改用 `JSON5.parse` —— 通过

详细日志追踪对调试**复杂 bug**很重要。

---

## 6. detection.ready Promise 模式

**文件**：`src/detection/index.ts:DetectionHandles.ready`

### 问题

检测项目 + 引擎是**异步**的（要读文件、解析 JSON），但状态栏 UI 渲染想拿到结果才能显示。

如果用回调：
```ts
detection.onReady((result) => statusBar.update(result));
```
多消费者、错误处理、取消都麻烦。

### 方案：Promise + async/await

```ts
interface DetectionHandles {
  // ...
  ready: Promise<DetectionResult>;
}

handles.ready = (async (): Promise<DetectionResult> => {
  // 异步预热
  return { projects, engines, workspaceFile };
})();

// 消费方：
const result = await detection.ready;
statusBar.update(resultToContext(result));
```

### UI 层细节

```ts
// src/ui/index.ts
const renderOnce = async (): Promise<void> => {
  try {
    const result = await detection.ready;
    statusBar.update(...);
  } catch (err) {
    logger.error('[ui] render failed:', err);
    statusBar.update({ project: null, engine: null }, settings);  // 降级
  }
};
```

**好处**：
- 单消费者 / 多消费者都行（Promise 可以 `await` 多次）
- 错误自动传播到 `catch`
- UI 在 await 期间可以显示 loading 状态（虽然当前没做）

---

## 7. 状态栏 11 个按钮的渲染

**文件**：`src/ui/statusBar.ts`

### priority 决定位置

```ts
this.buildBtn = createStatusBarItem(Left, 300);     // 最左
this.rebuildBtn = createStatusBarItem(Left, 299);
this.cleanBtn = createStatusBarItem(Left, 298);
this.configBtn = createStatusBarItem(Left, 297);
this.targetBtn = createStatusBarItem(Left, 296);
this.platformBtn = createStatusBarItem(Left, 295);  // 注意这个是 295 还是 296？
this.sdkBtn = createStatusBarItem(Left, 294);       // 新加的 SDK 按钮
this.projectBtn = createStatusBarItem(Left, 293);   // 之前是 294，调过了
// ...
```

priority 越大越靠左。**加新按钮时要把所有后面的 priority 调小**，否则顺序乱。

### 渲染规则

```ts
update(ctx, settings) {
  // build 按钮永远显示 'Build'（除非正在 build，会被 showBuilding() 改）
  this.buildBtn.text = '$(play)  Build';
  
  // config 按钮显示当前值
  this.configBtn.text = `$(gear)  ${settings.buildConfiguration}`;
  
  // project 按钮显示项目名 OR 警告
  if (ctx.project) {
    this.projectBtn.text = `$(file-code)  ${ctx.project.name}`;
    this.projectBtn.backgroundColor = undefined;
  } else {
    this.projectBtn.text = '$(warning)  No Project';
    this.projectBtn.backgroundColor = warningBg;
  }
  
  // visibility —— 没有项目时隐藏 build/launch
  if (ctx.project) {
    this.buildBtn.show();
    // ...
  } else {
    this.buildBtn.hide();
    // ...
  }
}
```

### 图标选择

VS Code 内置 Product Icons，常用：
- `$(play)` 播放
- `$(refresh)` 刷新
- `$(trash)` 删除
- `$(gear)` 齿轮（设置）
- `$(symbol-class)` 类符号（target）
- `$(device-desktop)` 设备（platform）
- `$(library)` 库
- `$(file-code)` 代码文件（project）
- `$(package)` 包（engine）
- `$(zap)` 闪电（live coding）
- `$(rocket)` 火箭（launch）

完整列表：VS Code 文档 "Product Icon Reference"。

---

## 8. withProgress 桥接 CancellationToken

**文件**：`src/ui/notifications.ts` + `src/commands/build.ts`

### 问题

`vscode.window.withProgress` 的 task 接收 `CancellationToken`，但我们的 `runBuild` 用 Web `AbortSignal`。

### 实现

**notifications.ts**：

```ts
export async function withProgress<T>(
  title: string,
  task: (
    report: (msg: string, increment?: number) => void,
    token: vscode.CancellationToken,  // ← 暴露给 task
  ) => Promise<T>,
): Promise<T> {
  return vscode.window.withProgress(
    { location: ProgressLocation.Notification, title, cancellable: true },
    async (progress, token) => {
      const report = (msg, inc) => progress.report({ message: msg, increment: inc });
      return task(report, token);
    },
  );
}
```

**build.ts**：

```ts
const result = await withProgress(title, async (report, token) => {
  const controller = new AbortController();
  const onCancel = () => controller.abort();
  if (token.isCancellationRequested) onCancel();
  else token.onCancellationRequested(onCancel);

  return await runBuild(cmd, {
    signal: controller.signal,  // ← runBuild 用 AbortSignal
    onProgress: (msg) => report(msg),
    onOutput: (line) => channel.appendLine(line),
  });
});
```

**buildRunner.ts**：

```ts
if (options.signal) {
  const onAbort = () => killTree(child);  // ← 杀整个进程树
  if (options.signal.aborted) onAbort();
  else options.signal.addEventListener('abort', onAbort, { once: true });
}
```

### 效果

用户点 Build → 进度条出现 + 取消按钮 → 点取消 → CancellationToken 触发 → AbortController.abort() → signal.aborted = true → killTree() → `taskkill /F /T /PID <pid>` → 整个 UBT 进程链终止。

---

## 9. compile_commands.json 的 symlink 策略

**文件**：`src/clangd/compileCommands.ts:linkToWorkspaceRoot()`

### UBT 的输出位置

UBT 跑完 `-ProjectFiles -Mode=GenerateProjectFiles` 后生成的 `compile_commands.json` 在：

```
<Project>/Saved/compile_commands.json
```

但 clangd 默认在**项目根目录**找 `compile_commands.json`。UE 项目根通常有 `.uproject` / `Source/` / `Content/`，没有 `compile_commands.json`。

### 三种解决方式

| 方式 | 优 | 劣 |
|---|---|---|
| **复制**到根目录 | 简单 | 双倍磁盘；每次 UBT 更新要重新复制 |
| **符号链接** | 单份数据，UBT 更新自动反映 | Windows 没开发者模式可能失败 |
| **改 .clangd** 加 `CompilationDatabase: Saved/` | 零副作用 | 用户得自己改配置 |

我们用 **symbol link + fallback copy**：

```ts
try {
  await fs.symlink(jsonPath, target, 'file');
} catch {
  await fs.copyFile(jsonPath, target);
}
```

如果 symlink 失败（Windows 无开发者模式），fallback 复制。

### Windows 开启开发者模式

Settings → "Developer Mode" → 启用。
不开启也能用（fallback 到 copy）—— 性能略差但功能正常。

---

## 总结：核心代码地图

| 你想做 | 看这里 |
|---|---|
| 加新命令 | `commands/` + `commands/index.ts` + `package.json` |
| 改项目检测 | `detection/index.ts:handles.ready` |
| 改 .uproject 解析 | `detection/uprojectScanner.ts` |
| 改 .clangd 生成 | `clangd/clangdConfig.ts` |
| 改 UBT 调用 | `build/buildRunner.ts` + `build/ubt.ts` |
| 改状态栏 UI | `ui/statusBar.ts` |
| 加状态栏按钮 | `ui/statusBar.ts` 的 `StatusBarManager` 类 |
| 改 Windows SDK 发现 | `clangd/windowsSdk.ts` |
| 加 MCP tool | `mcp/tools.ts` |

每个文件顶部都有详细 docstring 解释职责。