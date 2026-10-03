/**
 * editorDetect —— 检测 Unreal Editor 是否正在运行（编辑器感知构建）
 *
 * 模式借鉴 engine-link / UE Build Bridge（Alingkumo/unreal-engine-link）的
 * "editor-aware build"：编辑器运行中执行全量 UBT 构建会撞 DLL 锁定
 * （UnrealEditor-<Project>.dll 被占用），此时应改走 Live Coding 热重载。
 *
 * 实现要点：
 *   - Windows 上用 `tasklist /FI "IMAGENAME eq UnrealEditor.exe" /FO CSV /NH` 查询，
 *     不引入额外依赖（wmic 在新系统上已弃用，PowerShell 启动太慢）。
 *   - tasklist 找不到进程时输出本地化提示（"INFO: No tasks..." / 中文系统输出
 *     "信息: 没有运行的任务..."），不能依赖错误码或英文关键词判断 —— 唯一可靠的
 *     信号是 CSV 行里是否出现带引号的进程映像名。
 *   - 检测失败（tasklist 不存在 / 非 Windows）一律返回 false，绝不阻断构建主流程。
 */

import { execFile } from 'node:child_process';

/** 编辑器相关进程映像名（小写比较）。UnrealEditor-Cmd.exe 是命令行渲染/调试入口。 */
export const EDITOR_PROCESS_IMAGE_NAMES: readonly string[] = [
  'UnrealEditor.exe',
  'UnrealEditor-Cmd.exe',
];

export interface EditorDetectOptions {
  /**
   * 注入 execFile 便于单测；默认 node:child_process.execFile。
   * 用最小结构类型而非 `typeof execFile` —— Node 的 execFile 类型带
   * `__promisify__` 属性,vi.fn mock 无法满足该结构。
   */
  execFileImpl?: ExecFileLike;
  /** 注入进程映像名列表；默认 EDITOR_PROCESS_IMAGE_NAMES */
  processNames?: readonly string[];
}

/** execFile 的最小结构类型(仅本模块用到的 callback 形态) */
export type ExecFileLike = (
  cmd: string,
  args: readonly string[],
  opts: { timeout?: number; windowsHide?: boolean },
  cb: (err: Error | null | undefined, stdout: string | undefined) => void,
) => void;

/**
 * 解析 tasklist CSV 输出，判断目标进程是否在运行。
 *
 * CSV /NH 输出形如：
 *   "UnrealEditor.exe","12345","Console","1","1,234,567 K"
 * 找不到进程时是本地化文本行，不会出现带引号的映像名 —— 所以用
 * `"name"`（带引号）子串匹配，避免误匹配到提示文本里的进程名。
 */
export function parseTasklistOutput(
  output: string,
  processNames: readonly string[] = EDITOR_PROCESS_IMAGE_NAMES,
): boolean {
  for (const name of processNames) {
    if (output.includes(`"${name}"`)) {
      return true;
    }
  }
  return false;
}

/**
 * 检测 Unreal Editor 是否正在运行。
 *
 * @returns true = 至少一个编辑器进程在运行；false = 未运行或检测失败
 */
export function isUnrealEditorRunning(options: EditorDetectOptions = {}): Promise<boolean> {
  const execFileImpl = options.execFileImpl ?? (execFile as unknown as ExecFileLike);
  const processNames = options.processNames ?? EDITOR_PROCESS_IMAGE_NAMES;
  // 主映像名用于 tasklist /FI 过滤（一次只查一个）；完整列表用于输出解析。
  const primary = processNames[0] ?? 'UnrealEditor.exe';

  return new Promise((resolve) => {
    execFileImpl(
      'tasklist',
      ['/FI', `IMAGENAME eq ${primary}`, '/FO', 'CSV', '/NH'],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err) {
          // 非 Windows / tasklist 缺失 / 超时：按"未运行"处理，不阻断构建
          resolve(false);
          return;
        }
        resolve(parseTasklistOutput(String(stdout ?? ''), processNames));
      },
    );
  });
}

/**
 * 是否应该建议改用 Live Coding（纯函数，便于测试）。
 *
 * 只对增量 build 生效 —— rebuild/clean 本来就要关编辑器，提示没有意义；
 * MCP/silent 调用方在命令层已拦截。
 */
export function shouldSuggestLiveCoding(
  mode: 'build' | 'rebuild' | 'clean',
  editorRunning: boolean,
): boolean {
  return mode === 'build' && editorRunning;
}
