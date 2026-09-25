/**
 * mcp/tools —— Model Context Protocol 服务器的工具定义
 *
 * 每个工具对应我们的一个命令,但由 AI 代理通过 MCP 调用(不是用户从命令面板)。
 *
 * ## Phase 11 SSoT 包 4 变更
 *
 * - 删除 Phase 5 的 hardcoded stub。callTool 现在 dispatch 到真正的 executeXxx,
 *   silent = true 跳过 auto-pick / picker 避免阻塞 AI agent。
 * - 删除 ue_toggle_completion_mode (Plan / H4-B 决议:fast/slow 已合并)。
 * - 新增 ue_set_system_includes (Windows MSVC + Win SDK 配置)。
 *
 * ## MCP runtime context
 *
 * `setMCPContext()` 在 `activateMCP()` 中调用,注入本进程单例 config/logger/
 * detection/workspace/clangdOps。[bugfix-002] extension.ts 激活流程已接线 activateMCP:
 * 在 Cursor / Claude Code 宿主(检测 env vars)下启动,普通 VS Code 为 no-op。
 *
 * ## 同步签名 / fire-and-forget dispatch
 *
 * callTool 保持同步签名 `(name, args) => string`,不阻塞 MCP request handler;
 * 调 executeXxx 后立刻返回 `{ok: true, dispatched: name}`,真实进度通过 logger
 * 流到 OutputChannel + Problems 面板(命令层已有处理)。
 */

import type { Config } from '@core/config';
import type { Logger } from '@core/logger';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import type { ClangdOps } from '@clangd/clangdOps';
import { errEnvelope, EC_MCP_CONTEXT_NOT_INITIALIZED, EC_UNKNOWN_TOOL } from '@core/envelope';
import { executeBuild } from '@commands/build';
import { executeLaunchEditor } from '@commands/launchEditor';
import { executeLiveCoding } from '@commands/liveCoding';
import { executeGenerateCompileCommands } from '@commands/generateCompileCommands';
import { executeSetSystemIncludes } from '@commands/setSystemIncludes';
import { showProjectInfo } from '@commands/showProjectInfo';
import { getLastBuildSnapshot, summarizeBuildErrorsForAgent } from '@build/lastBuild';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const MCP_TOOLS: MCPTool[] = [
  {
    name: 'ue_build',
    description: 'Build / Rebuild / Clean via UBT. Supports optional single-module filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: ['build', 'rebuild', 'clean'],
          description: 'Build mode. Default: build.',
        },
        module: {
          type: 'string',
          description:
            '[add-002] Single-module compile filter (UBT -Module=). Only used with mode=build; ' +
            'ignored for rebuild/clean. Compiles the module to object files only — no link, no DLL ' +
            'output, so use it to verify compilation errors quickly. Unknown module names fail the ' +
            'build; read the error via ue_get_build_errors.',
        },
      },
    },
  },
  {
    // [借鉴 engine-link / UE Build Bridge] 独立的 rebuild / clean 工具名 ——
    // AI 代理按意图命名工具发现时命中率更高；dispatch 到同一个 executeBuild。
    name: 'ue_rebuild',
    description: 'Rebuild the UE project (Clean + Build via UBT -Rebuild).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ue_clean',
    description: 'Clean UE project intermediates via UBT -Clean.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    // [借鉴 engine-link / UE Build Bridge 的 get_build_errors] AI 闭环的读取端：
    // 触发 ue_build 之后调本工具拿结构化诊断（文件/行/列/错误码/消息）再改代码。
    name: 'ue_get_build_errors',
    description:
      'Get the last build result: structured MSVC/UBT diagnostics (file, line, code, message), ' +
      'error/warning totals, and files with errors. Returns hasResult=false if no build has run yet.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ue_launch_editor',
    description: 'Launch the Unreal Editor for the selected .uproject.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ue_live_coding',
    description: 'Trigger Live Coding hot-reload (Windows only).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ue_generate_compile_commands',
    description: 'Generate compile_commands.json via UBT -ProjectFiles.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ue_show_project_info',
    description: 'Show detected project / engine info.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'ue_set_system_includes',
    description: 'Set system includes for Windows MSVC + Windows SDK.',
    inputSchema: { type: 'object', properties: {} },
  },
];

/**
 * MCP runtime context —— activateMCP 调 setMCPContext 注入。
 * MCP 模块在 Cursor / Claude Code spawn 时启动,普通 VS Code 完全不调,
 * 所以 _ctx 在普通环境下永远是 null,callTool 返回 `{ok: false, error: {code, message}}`。
 */
export interface MCPContext {
  config: Config;
  logger: Logger;
  detection: DetectionHandles;
  workspace?: WorkspaceState;
  clangdOps?: ClangdOps;
}

let _ctx: MCPContext | null = null;

/** 注入 MCP 运行时上下文 —— activateMCP 内部调用。传 null 等于清空(unmount/dispose)。 */
export function setMCPContext(ctx: MCPContext | null): void {
  _ctx = ctx;
}

/** 测试 / 调试用 —— 读取当前注入的 context(返回值只用于断言,严禁业务依赖)。 */
export function getMCPContext(): MCPContext | null {
  return _ctx;
}

/**
 * Call a tool by name with the given args. Returns the JSON string the
 * MCP transport expects。
 *
 * 保持同步签名:executeXxx 是 async 真实命令,但 MCP 不阻塞 AI agent,
 * 所以 fire-and-forget dispatch 后立刻返回 `{ok: true, dispatched}`,
 * 真实进度通过 logger 输出。错误路径同步返回 `{ok: false, error: {code, message}}`
 * (契约 openapi.yaml Error + 决策 D5,错误码取自全局 9 项枚举)。
 */
export function callTool(name: string, args: Record<string, unknown>): string {
  if (!_ctx) {
    // 契约错误出口(openapi.yaml Error + 决策 D5):{ok: false, error: {code, message}},非裸字符串
    return JSON.stringify(
      errEnvelope(
        EC_MCP_CONTEXT_NOT_INITIALIZED,
        'MCP context not initialized — extension is not running in Cursor / Claude Code host',
      ),
    );
  }
  const { config, logger, detection, workspace, clangdOps } = _ctx;

  // fire-and-forget:真实进度通过 logger 流到 OutputChannel + Problems 面板。
  // 这里仅记录 dispatch + 捕获未处理的 rejection。
  // 形参放宽为 Promise<unknown>:命令层已按契约返回 Envelope(骨架阶段),dispatch 只关心 rejection。
  const dispatch = (p: Promise<unknown>, label: string): void => {
    p.catch((err) => {
      logger.error(`[mcp] tool ${label} failed:`, err);
    });
  };

  switch (name) {
    case 'ue_build': {
      const rawMode = typeof args.mode === 'string' ? args.mode : 'build';
      const mode: 'build' | 'rebuild' | 'clean' =
        rawMode === 'rebuild' || rawMode === 'clean' ? rawMode : 'build';
      // [add-002] module 仅 mode=build 生效;rebuild/clean 携带时忽略并在响应带
      // warning(契约 MCPDispatch.warning),不报错——与"非法 mode 静默回落"同一宽容风格
      // [评审 major] module 是首个 agent 可控且进入 verbatim cmd.exe 命令行的字符串
      // (buildRunner F1-1 整条命令原样拼接交 cmd 解析),含引号可闭合 -Module=" 引出
      // 命令注入 —— 白名单到 UE 模块名合法字符集,不匹配按未提供处理并返回 warning
      const trimmedModule = typeof args.module === 'string' ? args.module.trim() : '';
      const validModule = /^[\w.+-]+$/u.test(trimmedModule);
      const module = mode === 'build' && validModule ? trimmedModule : undefined;
      let warning: string | undefined;
      if (trimmedModule && mode !== 'build') {
        warning = 'module ignored for rebuild/clean; only mode=build supports module filtering';
      } else if (trimmedModule && !validModule) {
        warning = 'module ignored: contains characters outside [A-Za-z0-9_.+-]';
      }
      dispatch(
        executeBuild(mode, config, logger, detection, workspace, true, undefined, module),
        name,
      );
      return JSON.stringify({
        ok: true,
        dispatched: name,
        mode,
        ...(warning ? { warning } : {}),
        note: 'fire-and-forget; see logger',
      });
    }
    case 'ue_rebuild':
      dispatch(executeBuild('rebuild', config, logger, detection, workspace, true), name);
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    case 'ue_clean':
      dispatch(executeBuild('clean', config, logger, detection, workspace, true), name);
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    case 'ue_get_build_errors': {
      // 同步读进程内快照（MCP server 与扩展宿主同进程，见 src/mcp/server.ts），
      // 不需要 fire-and-forget —— AI 代理拿到的就是确定性的最近构建结果。
      const snap = getLastBuildSnapshot();
      if (!snap) {
        return JSON.stringify({
          ok: true,
          hasResult: false,
          note: 'no build has run in this session; call ue_build first',
        });
      }
      // [Wave3 契约适配] summarizeBuildErrorsForAgent 把计数嵌在 totals 下
      // (src/build/lastBuild.ts,本任务边界外禁改),契约 BuildSummary(openapi.yaml
      // components.schemas.BuildSummary)要求顶层 errorCount/warningCount ——
      // 在此出口做薄适配:从 totals 映射出顶层计数,其余字段原样保留
      // (契约未禁止超集,totals/cancelled/durationMs 等继续随响应透出)。
      // ParsedDiagnostic 已含契约可选 column 字段(src/core/types/diagnostic.ts),
      // 诊断原样透传,无需在适配层补齐。
      const summary = summarizeBuildErrorsForAgent(snap);
      // 注意：summary 里也有 build 级别的 ok（构建是否成功），所以嵌套在 build 字段下，
      // 避免与工具调用级别的 ok 冲突。
      return JSON.stringify({
        ok: true,
        hasResult: true,
        build: {
          ...summary,
          errorCount: summary.totals.errors,
          warningCount: summary.totals.warnings,
        },
      });
    }
    case 'ue_launch_editor':
      dispatch(executeLaunchEditor(config, logger, detection, workspace, true), name);
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    case 'ue_live_coding':
      dispatch(executeLiveCoding(config, logger, detection, workspace, true), name);
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    case 'ue_generate_compile_commands':
      dispatch(executeGenerateCompileCommands(config, logger, detection, workspace, true), name);
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    case 'ue_show_project_info':
      dispatch(showProjectInfo(config, logger, detection, workspace, true), name);
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    case 'ue_set_system_includes':
      dispatch(
        executeSetSystemIncludes(config, logger, detection, workspace, clangdOps, true),
        name,
      );
      return JSON.stringify({ ok: true, dispatched: name, note: 'fire-and-forget; see logger' });
    default:
      // 契约错误出口(openapi.yaml Error + 决策 D5):{ok: false, error: {code, message}},非裸字符串
      return JSON.stringify(errEnvelope(EC_UNKNOWN_TOOL, `Unknown tool: ${name}`));
  }
}
