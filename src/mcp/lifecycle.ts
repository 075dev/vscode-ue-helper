/**
 * mcp/lifecycle —— 检测当前宿主是否支持 MCP
 *
 * Cursor 和 Claude Code 在 spawn 子进程时会设置独特的环境变量,
 * 我们用它作为信号决定是否启动 MCP 服务器。
 * 普通 VS Code 没有这些 env var,保持静默。
 *
 * `detectHost()` 已抽离到 `@core/runtime-detect`（T4.3）,
 * 这里通过 re-export 保持向后兼容 —— 内部模块继续用 `@mcp/lifecycle`
 * 不会破坏,外部新代码应直接 import `@core/runtime-detect`。
 */

import { detectHost } from '@core/runtime-detect';

export type MCPMode = 'auto' | 'always' | 'never';

export function shouldStartMCP(mode: MCPMode): boolean {
  if (mode === 'always') {
    return true;
  }
  if (mode === 'never') {
    return false;
  }
  // 'auto' mode — start iff we can detect a Cursor / Claude Code host.
  return detectHost() !== null;
}

// 向后兼容 re-export —— 老代码继续 `import { detectHost } from '@mcp/lifecycle'` 仍可用
export { detectHost };
export type { RuntimeHost } from '@core/runtime-detect';
