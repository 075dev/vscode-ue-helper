/**
 * clangdFlagRenderer —— `.clangd` `CompileFlags.Add` 的**唯一渲染 + 写入入口**
 *
 * ## 为什么需要统一入口
 *
 * 旧实现有 **3 条各自独立**的「渲染 + 整体替换」路径：
 *
 * | 路径 | ctx 里带了什么 | 后果 |
 * | --- | --- | --- |
 * | `src/commands/setSystemIncludes.ts` | 只有 `systemIncludeFlags` | compat-header / preparse / uht 全部渲染不出来 |
 * | `src/ui/controlPanel.ts` | **完全为空 `{}`** | 依赖动态路径的词条**全部渲染不出来** |
 * | `src/clangd/completionMode.ts` | compat / macro / preparse | 缺 `intermediateUhtDirs` 与 `systemIncludeFlags` |
 *
 * 三条路径渲染出的 Add 内容互不相同，而 `ClangdOps.applyAddFlags` 是
 * **整体替换** —— 所以**谁最后写谁赢**。最典型的后果：用户在控制面板勾选
 * 「强制包含 UE Clangd 兼容头」→ 面板路径 ctx 为空 → `compat-header` 渲染出
 * 零个 flag → 勾选**静默失效**，面板显示保存成功但 `.clangd` 里啥也没有。
 *
 * 还有一个更硬的坑：`system-include-windows` **不在 glossary 里**（没有对应
 * checkbox），webview 保存时只收集有 checkbox 的 id → 保存一次就把
 * `system-include-windows` 从 `userAddFlags` 里**丢掉** → Windows SDK / MSVC
 * 的 `/imsvc` 全部消失 → clangd 找不到任何系统头 → 满屏 false-positive。
 *
 * ## 统一后的契约
 *
 * ctx 的五项来源固定（本模块的 `collectClangdFlagContext` 是唯一采集点）：
 *
 * | ctx 字段 | 来源 |
 * | --- | --- |
 * | `compatHeaderPath` | `workspace.ueClangdCompatPath` |
 * | `macroHelperPath` | `workspace.macroHelperPath` |
 * | `preparseHeaders` | `getPrepareIncludesList('slow', projectPath)` |
 * | `intermediateUhtDirs` | `collectIntermediateUhtDirs({ projectDir })` |
 * | `systemIncludeFlags` | 由 `clangd.msvcRoot` / `clangd.sdkRoot` 设置项用 `windowsSdk.renderClangdFlags` 重建 |
 *
 * 所有写入方（控制面板 / setSystemIncludes / completionMode）都必须走
 * `writeClangdAddFlags`，**禁止**自己拼 `resolveFlags` + `applyAddFlags`。
 */

import * as path from 'node:path';
import { type Config } from '@core/config';
import { type Logger } from '@core/logger';
import type { ClangdMutateResult, ClangdOps } from './clangdOps';
import { resolveFlags, type ResolveContext } from './flagGlossary';
import { getPrepareIncludesList } from './preparseIncludes';
import { collectIntermediateUhtDirs } from './intermediateUhtCollector';
import { renderClangdFlags } from './windowsSdk';

/** 渲染 ctx —— 与 flagGlossary.ResolveContext 同构 */
export type ClangdFlagRenderContext = ResolveContext;

/**
 * [D5] 需要触发 `.clangd` 重写的配置键 —— **单一真相源**。
 *
 * 这四个键共同决定 `.clangd` 的 `CompileFlags.Add` 内容，漏掉任何一个都会让
 * 「设置项已改、磁盘上的 `.clangd` 却没变」——用户看不到任何反馈，排查成本极高。
 *
 * 新增 `vscodeUEHelper.clangd.*` 设置项时必须同步登记到这里
 * （`test/unit/clangd/clangdRewriteTrigger.test.ts` 会拿 package.json 交叉核对）。
 */
export const CLANGD_REWRITE_CONFIG_KEYS = [
  'vscodeUEHelper.clangd.userAddFlags',
  'vscodeUEHelper.clangd.msvcRoot',
  'vscodeUEHelper.clangd.sdkRoot',
  'vscodeUEHelper.clangd.fmsCompatibilityVersion',
] as const;

/** `vscode.ConfigurationChangeEvent` 的最小结构 —— 本模块不依赖 vscode 运行时 */
export interface ConfigurationChangeLike {
  affectsConfiguration(section: string): boolean;
}

/**
 * [D5] 判断一次配置变更是否需要重写 `.clangd`。
 *
 * 判定依据只有 {@link CLANGD_REWRITE_CONFIG_KEYS} 这张清单 —— 新增
 * `vscodeUEHelper.clangd.*` 设置项时，先在清单里登记，这里自动生效。
 */
export function shouldRewriteClangd(event: ConfigurationChangeLike): boolean {
  return CLANGD_REWRITE_CONFIG_KEYS.some((key) => event.affectsConfiguration(key));
}

/** 统一写入入口所需的依赖 */
export interface ClangdFlagWriterDeps {
  /** .clangd 读写唯一入口（ClangdOps） */
  clangdOps: ClangdOps;
  /** 配置读取（userAddFlags + msvc/sdk 路径） */
  config: Config;
  /** 可选日志 */
  logger?: Logger;
}

/**
 * **渲染入口** —— ids + ctx → `.clangd` Add 字面串数组。
 *
 * 这是全仓库唯一允许调用 `flagGlossary.resolveFlags` 的地方（写入方一律走
 * `writeClangdAddFlags`）。
 */
export function renderClangdAddFlags(
  ids: readonly string[],
  ctx: ClangdFlagRenderContext,
): string[] {
  return resolveFlags(ids, ctx);
}

/**
 * **采集入口** —— 按统一契约收集 ctx 的五项。
 *
 * 任何一项拿不到就留空（`resolveFlags` 对应分支会跳过），
 * 不抛异常 —— ctx 不全不应该让整次写入失败。
 */
export async function collectClangdFlagContext(
  deps: ClangdFlagWriterDeps,
): Promise<ClangdFlagRenderContext> {
  const { clangdOps, config, logger } = deps;
  const ws = clangdOps.workspace;
  // 用可变结构体逐项填充（ResolveContext 的字段是 readonly，只能整体构造）
  const ctx: {
    compatHeaderPath?: string;
    macroHelperPath?: string;
    preparseHeaders?: readonly string[];
    systemIncludeFlags?: readonly string[];
    intermediateUhtDirs?: readonly string[];
  } = {};

  const compatHeaderPath = ws.ueClangdCompatPath;
  if (compatHeaderPath) {
    ctx.compatHeaderPath = compatHeaderPath;
  }

  const macroHelperPath = ws.macroHelperPath;
  if (macroHelperPath) {
    ctx.macroHelperPath = macroHelperPath;
  }

  // 项目路径：preparse 头 + UHT 目录都基于项目目录
  const projectPath = ws.projectFile;
  if (projectPath) {
    try {
      ctx.preparseHeaders = await getPrepareIncludesList('slow', projectPath);
    } catch (err) {
      logger?.warn(
        `[clangdFlagRenderer] getPrepareIncludesList failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    try {
      // [D5] intermediateUhtCollector 此前从未被生产代码调用 ——
      // 'uht-include-dirs' 词条因此永远渲染不出 /I<dir>。本轮接线。
      ctx.intermediateUhtDirs = await collectIntermediateUhtDirs({
        projectDir: path.dirname(projectPath),
      });
    } catch (err) {
      logger?.warn(
        `[clangdFlagRenderer] collectIntermediateUhtDirs failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const systemIncludeFlags = await buildSystemIncludeFlags(config, logger);
  if (systemIncludeFlags.length > 0) {
    ctx.systemIncludeFlags = systemIncludeFlags;
  }

  return ctx;
}

/**
 * 用持久化的 MSVC / SDK 路径重建系统头 flag 组。
 *
 * 持久化由 `setSystemIncludes` 命令在用户选定版本后写入；这里只负责重建。
 * 路径未配置（用户没跑过该命令）→ 返回空数组 → `system-include-windows`
 * 这个 id 渲染出零个 flag（与旧行为一致）。
 */
async function buildSystemIncludeFlags(
  config: Config,
  logger?: Logger,
): Promise<string[]> {
  const msvcRoot = config.clangdMsvcRoot;
  const sdkRoot = config.clangdSdkRoot;
  if (!msvcRoot || !sdkRoot) {
    return [];
  }
  try {
    return await renderClangdFlags({
      msvcRoot,
      sdkRoot,
      fmsCompatibilityVersion: config.clangdFmsCompatibilityVersion ?? null,
    });
  } catch (err) {
    logger?.warn(
      `[clangdFlagRenderer] renderClangdFlags failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/**
 * **写入入口** —— 采集 ctx → 渲染 → 整体替换 `.clangd` 的 `CompileFlags.Add`。
 *
 * 全仓库所有 `.clangd` Add 写入都必须走这个函数。
 *
 * @param ids - flag id 列表（来自 `config.userAddFlags` 或其子集）
 * @param overrides - ctx 覆盖项。用于「本次调用已经知道确切值」的场景
 *   （如 `setSystemIncludes` 刚渲染出的 systemFlags），避免依赖设置项持久化
 *   是否成功。覆盖项优先于采集到的值。
 * @returns ClangdOps.applyAddFlags 的结果
 */
export async function writeClangdAddFlags(
  deps: ClangdFlagWriterDeps,
  ids: readonly string[],
  overrides?: Partial<ClangdFlagRenderContext>,
): Promise<ClangdMutateResult> {
  const collected = await collectClangdFlagContext(deps);
  const ctx: ClangdFlagRenderContext = { ...collected, ...(overrides ?? {}) };
  const flags = renderClangdAddFlags(ids, ctx);
  deps.logger?.info(
    `[clangdFlagRenderer] writing ${flags.length} Add flags (ids=${ids.length}) to .clangd`,
  );
  return deps.clangdOps.applyAddFlags(flags);
}
