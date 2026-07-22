/**
 * runtime-detect —— 运行时宿主环境检测
 *
 * 检测当前进程运行在哪种 AI 编辑器宿主里。
 * 用于判断是否启用 MCP 服务器等仅宿主专属的功能。
 *
 * ## 检测信号
 *
 * Cursor 和 Claude Code 在 spawn 子进程时会设置独特的环境变量,
 * 我们用它作为信号判断宿主类型。普通 VS Code 没有这些 env var,
 * 返回 null 表示未识别的宿主。
 *
 * ## 检测顺序
 *
 * 1. `CURSOR_TRACE_ID` / `CURSOR_USER_DATA_DIR` → 'cursor'
 * 2. `CLAUDE_CODE_ENTRYPOINT` / `CLAUDE_CODE_SSE_PORT` → 'claude-code'
 * 3. 都不存在 → null（普通 VS Code 或其他编辑器）
 *
 * ## 抽离原因（T4.3）
 *
 * `detectHost()` 原本定义在 `src/mcp/lifecycle.ts`,但它的逻辑与 MCP 本身无关,
 * 只是 4 行环境变量判断。`commands/showProjectInfo.ts` 也需要用它来显示
 * "当前宿主"信息,导致 commands → mcp 的反向依赖。
 *
 * 抽到 `@core/runtime-detect` 后:
 *   - `@core` 是横切基础设施的合适位置
 *   - `@mcp/lifecycle` 改为 re-export,保持向后兼容
 *   - commands 不再依赖 mcp
 *
 * 注意:`detectHost` 是纯函数,完全无副作用,
 * 单元测试只需 mock `process.env` 即可覆盖全部分支。
 */

/**
 * 当前进程的宿主类型。
 * - `'cursor'`: Cursor IDE
 * - `'claude-code'`: Claude Code CLI
 * - `null`: 未识别的宿主（普通 VS Code 等）
 */
export type RuntimeHost = 'cursor' | 'claude-code' | null;

/**
 * 检测当前进程运行在哪种 AI 编辑器宿主里。
 *
 * 通过环境变量判断:Cursor / Claude Code 启动子进程时会注入特有的
 * 环境变量。返回值供上层决定是否启用宿主专属功能(如 MCP 服务器)。
 *
 * @returns 宿主类型标识;不匹配任何已知宿主时返回 `null`。
 *
 * @example
 * ```ts
 * const host = detectHost();
 * if (host === 'cursor') {
 *   // 启用 Cursor 专属行为
 * }
 * ```
 */
export function detectHost(): RuntimeHost {
  if ([process.env.CURSOR_TRACE_ID, process.env.CURSOR_USER_DATA_DIR].some(Boolean)) {
    return 'cursor';
  }
  if ([process.env.CLAUDE_CODE_ENTRYPOINT, process.env.CLAUDE_CODE_SSE_PORT].some(Boolean)) {
    return 'claude-code';
  }
  return null;
}
