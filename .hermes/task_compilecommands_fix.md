# 任务：修复 compileCommands.ts 的 spawn 引号 bug

文件：`src/clangd/compileCommands.ts`
范围：第 129-141 行的 `execFileAsync` 调用

## 问题描述
当前代码手动用 cmd.exe /c 包装 .bat 脚本，并在 args 里加双引号：
```
const execArgs = isWin && isShellScript ? ['/c', `"${ubtPath}"`, ...args] : args;
```
execFile 把双引号当作文件名一部分传给 cmd，cmd 报 `'"D:\Program Files\..."' is not recognized`。

## 修复方案
放弃手动 cmd.exe /c 包装，改用 spawn 的 shell: true 选项。Node.js 自己处理 Windows 路径引号。

## 具体修改步骤

### 步骤 1：修改 import（第 15 行）
```
import { execFile, spawn } from 'node:child_process';
```

### 步骤 2：在 execFileAsync 旁添加 spawnAsync 辅助函数（第 19 行之后）
```typescript
function spawnAsync(
  cmd: string,
  args: ReadonlyArray<string>,
  opts: import('node:child_process').SpawnOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args as string[], opts);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`spawn ${cmd} exited with code ${code}`));
    });
  });
}
```

### 步骤 3：替换第 129-141 行
删除原来的：
```
  // On Windows, .bat / .cmd files cannot be spawned directly — Node returns
  // EINVAL, especially with cross-drive paths and spaces. Wrap with cmd.exe /c
  // so the shell resolves the script. (buildRunner.ts uses the same pattern.)
  const isWin = process.platform === 'win32';
  const isShellScript = ubtPath.endsWith('.bat') || ubtPath.endsWith('.cmd');
  const execCmd = isWin && isShellScript ? 'cmd.exe' : ubtPath;
  const execArgs = isWin && isShellScript ? ['/c', `"${ubtPath}"`, ...args] : args;

  const { stdout, stderr } = await execFileAsync(execCmd, execArgs, {
    timeout: 300_000,
    windowsHide: true,
    signal: opts.signal,
  });
```

替换为：
```
  // On Windows, .bat / .cmd files cannot be spawned directly — Node returns
  // EINVAL, especially with cross-drive paths and spaces. Use shell: true
  // so Node.js wraps the command in cmd.exe itself with correct quoting.
  const isWin = process.platform === 'win32';
  const isShellScript = ubtPath.endsWith('.bat') || ubtPath.endsWith('.cmd');

  const { stdout, stderr } = await spawnAsync(ubtPath, args, {
    shell: isWin && isShellScript,
    timeout: 300_000,
    windowsHide: true,
    signal: opts.signal,
  });
```

## 约束
- 第 217 行 `execFileAsync(cmd, ['clangd'])` 不碰
- execFile 导入保留（line 217 需要）
- 只改这个函数里的这一段
- 改完后跑 `npx tsc --noEmit` 验证编译通过
