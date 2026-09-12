/**
 * createProject —— 一次性初始化 UE + clangd 工作区
 *
 * 5 步流程（每步在 VS Code 进度条上报告）：
 *   1. 写 .clangd（模板风格：If/Compiler/Add → 调用方注入）/ [Plan Add 收束]
 *      实际为「先 writeFull（项目模板）+ applyAddFlags（系统/用户解算结果）」两步
 *   2. 跑 UBT GenerateClangDatabase 生成 compile_commands.json
 *   3. 创建补全文件系统（5 个 curated header 文件）
 *   4. 将 completionHelper.cpp 加入 compile_commands.json
 *   5. 完成提示
 *
 * 额外步骤（后台执行）：
 *   - 修改 rsp 文件移除 PCH 引用
 *   - 创建 RSP 匹配器（引擎源码导航用）
 *   - 补全缺失的 compile_commands.json 条目
 *   - 工作区备份（防止 UBT 覆盖 .code-workspace）
 *
 * 系统头文件（/X + /imsvc + -fms-compatibility-version）在本任务中作为
 * `system-include-windows` 的解析结果写入 Add，由 flagGlossary.resolveFlags 完成字面拼接。
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { type Logger } from '@core/logger';
import { type Config } from '@core/config';
import {
  generateCompileCommands,
  createCompletionFiles,
  addCompletionHelperToCompileCommands,
  linkToWorkspaceRoot,
  startModifyResponseFiles,
  startCreateRspMatchers,
  fillMissingCompileCommands,
  runUhtCodegen,
  scaffoldClangFormatAndTidy,
  type UhtResult,
} from '@clangd';
import type { FillResult } from '@clangd/compileCommands';
import type { ClangdOps } from '@clangd/clangdOps';
import { t } from '@i18n';
import { resolveProgressLocation } from '@ui/notifications';
import type { DetectionHandles } from '@detection';
import type { WorkspaceState } from '@core/workspace';
import { resolveProjectOrPick, resolveEngineOrPick, persistSelection } from '@commands/_resolve';

/**
 * 将 fillMissingCompileCommands 的结构化结果格式化为人类可读的摘要文本
 *
 * @param result - FillResult 对象或 undefined（读取失败时）
 * @returns 格式化的摘要字符串
 */
export function formatFillResultDetail(result: FillResult | undefined): string {
  if (!result) {
    return 'compile_commands.json not found or empty, skipped';
  }
  if (result.skippedReason) {
    return `skipped: ${result.skippedReason}`;
  }
  if (result.added.length === 0) {
    return `all scanned source files already covered (${result.scanned} files across ${result.roots.length} source root${result.roots.length !== 1 ? 's' : ''})`;
  }
  const rootLabel = result.roots.length === 1 ? 'source root' : 'source roots';
  return `added ${result.added.length} missing entries from ${result.roots.length} ${rootLabel}`;
}

export async function executeCreateProject(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
  clangdOps?: ClangdOps,
  // [Phase 9 SSoT] 可选——为老调用方/test 留 fallback；生产 index.ts 必传
  workspace?: WorkspaceState,
): Promise<void> {
  logger.info('[createProject] invoked');

  // [Phase 11 SSoT] 选目标逻辑收敛到 @commands/_resolve
  const project = await resolveProjectOrPick({ detection, workspace });
  if (!project) {
    return;
  }
  await persistSelection(workspace, detection, project, undefined);

  const engine = await resolveEngineOrPick({ detection, workspace });
  if (!engine) {
    return;
  }
  await persistSelection(workspace, detection, undefined, engine);

  const projectDir = path.dirname(project.path);

  // compile_commands.json 生成路径，step 2 赋值，step 4 使用
  let jsonPath = '';
  // 仅用于日志信息（createCompletionFiles 内部已有自己的路径派生）
  // [Phase 11 SSoT] 走 WorkspaceState.clangdHelperDir；fallback 留给测试兼容
  const customDir =
    workspace?.clangdHelperDir ?? path.join(projectDir, '.vscode', 'vscodeuehelper');

  // === 5-step pipeline ===
  const results: { step: string; ok: boolean; detail: string }[] = [];

  await vscode.window.withProgress(
    {
      // 进度位置走统一配置(progressLocation):默认状态栏 spinner 自动消失,
      // 设为 notification 才回右下角弹窗(见 src/ui/notifications.ts)
      location: resolveProgressLocation(),
      title: 'Create Unreal Clangd Project',
      cancellable: false,
    },
    async (progress) => {
      // Step 1: 写入 .clangd 项目模板（系统零默认注入 → Add: []）。
      // 用户后续在控制面板「自定义 Add Flags」勾选 flag，或运行 setSystemIncludes 让 SDK flag
      // 自动写入。createProject 自身不主动注入任何 flag —— 满足"完全不让 add 默认注入"。
      progress.report({
        message: 'Step 1/5: writing .clangd...',
        increment: 0,
      });
      try {
        if (!clangdOps) {
          throw new Error(
            '[createProject] ClangdOps is required but not injected. ' +
              'Phase 8 architecture mandates going through ClangdOps for all .clangd mutations.',
          );
        }
        // 推断 compiler 路径（从 clangd 路径或默认 LLVM 安装目录）
        let compilerPath: string | undefined;
        if (config.clangdPath) {
          compilerPath = path.join(path.dirname(config.clangdPath), 'clang-cl.exe');
        } else {
          const defaultPaths = [
            'C:\\Program Files\\LLVM\\bin\\clang-cl.exe',
            'C:\\Program Files (x86)\\LLVM\\bin\\clang-cl.exe',
          ];
          for (const p of defaultPaths) {
            try {
              await fs.access(p);
              compilerPath = p;
              break;
            } catch {
              /* not exist */
            }
          }
        }

        const writeResult = await clangdOps.writeFull({
          compilerPath,
          projectPath: project.path,
        });
        if (!writeResult) {
          throw new Error('ClangdOps.writeFull failed');
        }
        const clangdConfigPath = writeResult.path;

        // ⚠️ 故意**不**调 applyAddFlags —— "系统零默认注入"承诺。
        // 旧实现会主动 push compat-header/macro-helper/std-c++20/preparse-headers/
        // uht-include-dirs/system-include-windows 等到 Add，已彻底删除。

        results.push({
          step: 'Write .clangd',
          ok: true,
          detail: clangdConfigPath,
        });
        logger.info(
          `[createProject] wrote ${clangdConfigPath} ` +
            `(CompileFlags.Add = []，由用户在控制面板勾选或 setSystemIncludes 触发)`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ step: 'Write .clangd', ok: false, detail: msg });
        logger.error('[createProject] .clangd write failed:', msg);
      }
      progress.report({ increment: 20 });

      // Step 2: generate compile_commands.json (40%)
      progress.report({
        message: 'Step 2/5: generating compile_commands.json...',
        increment: 0,
      });
      try {
        // [LOG] step 2 入参：明确打印 .uproject 路径、projectDir（= .uproject 同级目录）、
        // engine 路径，便于和 linkToWorkspaceRoot 内部的 ENTRY 日志对照
        const projectDirForLink = path.dirname(project.path);
        logger.info(
          `[createProject] step 2 invoke generateCompileCommands: ` +
            `project=${project.path}, projectDir=${projectDirForLink}, engine=${engine.path}`,
        );

        // [UHT pre-codegen] 主动跑 UBT -Mode=UnrealHeaderTool 预生成 .generated.h。
        // 即便后续 UBT 主链路失败（unresolved symbol / 缺类型），partial headers 仍能让
        // clangd 给出基本提示；UHT 抛错（无 dotnet / 非法 buildTargetName 等）仅
        // logger.warn，不阻断 step 2 —— 与 fillMissingCompileCommands / startModifyResponseFiles
        // / startCreateRspMatchers 三个"非阻断"子步骤同模式。
        // [i18n 迁移] results.push 的 step 字段统一改用 t() 包装
        // （createProject.uhtPreCodegen key 在 zh/en locale 中带 {count} 占位符），
        // 便于在中文/英文环境下分别展示"UHT 预生成 .generated.h (N 个)"等本地化文本；
        // detail 字段保留为原始英文/数字调试串，不强制走 i18n。
        try {
          const buildTargetName = project.name ? `${project.name}Editor` : '';
          if (!buildTargetName) {
            logger.warn('[createProject] step 2 UHT pre-codegen skipped: project.name is empty');
            results.push({
              step: t('createProject.uhtPreCodegen', { count: 0 }),
              ok: false,
              detail: 'project.name is empty',
            });
          } else {
            const uhtResult: UhtResult = await runUhtCodegen({
              project: project.path,
              engineRoot: engine.path,
              buildTargetName,
              buildType: config.configuration,
              logger,
            });
            results.push({
              step: t('createProject.uhtPreCodegen', {
                count: uhtResult.generatedHeaderCount,
              }),
              ok: uhtResult.ran || uhtResult.generatedHeaderCount > 0,
              detail: `generated ${uhtResult.generatedHeaderCount} .generated.h (UBT exit ${uhtResult.exitCode ?? 'null'})`,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('[createProject] step 2 UHT pre-codegen failed:', msg);
          results.push({
            step: t('createProject.uhtPreCodegen', { count: 0 }),
            ok: false,
            detail: msg,
          });
        }

        jsonPath = await generateCompileCommands({
          project: project.path,
          engineRoot: engine.path,
          buildType: config.configuration,
          progress,
          // GenerateClangDatabase 模式：实际生成 compile_commands.json
          // 参考：UE 5.x 用 -mode=GenerateClangDatabase，需要 LLVM/clang
          // isNative: true 用的是 -projectfiles，不会生成 compile_commands.json！
          isNative: false,
        });

        logger.info(`[createProject] step 2 generateCompileCommands returned jsonPath=${jsonPath}`);

        // [Step 2] 检测 jsonPath 是否已经落在 fallback 目标位置（.vscode/vscodeuehelper/compile_commands.json）。
        // fallback 路径下无需调用 linkToWorkspaceRoot：linkToWorkspaceRoot 内部虽已短路返回 target
        // （compileCommands.ts 496-509: path.resolve(jsonPath) === path.resolve(target) 早返），
        // 但在调用层显式跳过更清晰——fallback 路径不存在"符号链接"动作，
        // 显式分支让 step 2 的控制流与 UBT 正常路径对称。
        // [Phase 11 SSoT] 走 WorkspaceState.compileCommandsPath（单一真相源）
        const expectedFallbackPath =
          workspace?.compileCommandsPath ??
          path.join(projectDir, '.vscode', 'vscodeuehelper', 'compile_commands.json');
        const isFallbackPath = path.resolve(jsonPath) === path.resolve(expectedFallbackPath);

        let linkPath: string;
        if (isFallbackPath) {
          logger.info(
            `[createProject] step 2 fallback path detected, skipping linkToWorkspaceRoot: ` +
              `jsonPath=${jsonPath} === ${expectedFallbackPath}`,
          );
          linkPath = jsonPath;
          // 上报 fallback 状态：UI 看到此条即知 IntelliSense 可能不完整。
          results.push({
            step: t('createProject.fallbackUsed'),
            ok: true,
            detail: jsonPath,
          });
        } else {
          // [LOG] step 2 调用 linkToWorkspaceRoot 前：明确打印 jsonPath + 目标 projectDir
          // 注意：传入 project.path（.uproject 文件路径），函数内部 path.dirname() 得到
          // projectDir，即 .uproject 所在目录
          logger.info(
            `[createProject] step 2 calling linkToWorkspaceRoot: ` +
              `jsonPath=${jsonPath}, projectPath=${project.path} (projectDir will be ${projectDirForLink})`,
          );
          linkPath = await linkToWorkspaceRoot(jsonPath, project.path, logger);

          // [LOG] step 2 调用后：打印 linkPath，便于对照 target 是否真的到了
          // .vscode/vscodeuehelper/compile_commands.json
          logger.info(`[createProject] step 2 linkToWorkspaceRoot returned linkPath=${linkPath}`);
        }

        // 🔧 补全缺失的 compile_commands.json 条目（新文件、头文件等）
        try {
          const fillResult = await fillMissingCompileCommands(linkPath, project.path, logger);
          results.push({
            step: 'Fill missing compile_commands entries',
            ok: true,
            detail: formatFillResultDetail(fillResult),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            step: 'Fill missing compile_commands entries',
            ok: false,
            detail: msg,
          });
          logger.warn('[createProject] fillMissingCompileCommands skipped:', msg);
        }

        results.push({
          step: 'Generate compile_commands.json',
          ok: true,
          detail: jsonPath,
        });
        logger.info(`[createProject] compile_commands.json → ${jsonPath}`);

        // Step 2.1: 从 .rsp 文件中移除 PCH 预编译头引用（加速 clangd 索引）
        try {
          const rspResult = await startModifyResponseFiles(project.path, logger);
          results.push({
            step: 'Modify response files (PCH removal)',
            ok: true,
            detail: `${rspResult.replaced} modified, ${rspResult.unchanged} unchanged`,
          });
          logger.info(
            `[createProject] modifyRspFiles: ${rspResult.replaced} modified, ${rspResult.unchanged} unchanged`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            step: 'Modify response files (PCH removal)',
            ok: false,
            detail: msg,
          });
          logger.warn('[createProject] modifyRspFiles skipped:', msg);
        }

        // Step 2.2: 创建 RSP 文件匹配器（用于引擎源码导航）
        try {
          const matchers = await startCreateRspMatchers(project.path, engine.path, logger);
          results.push({
            step: 'Create RSP matchers',
            ok: true,
            detail: `${matchers.length} matchers created`,
          });
          logger.info(`[createProject] createRspMatchers: ${matchers.length} matchers`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results.push({
            step: 'Create RSP matchers',
            ok: false,
            detail: msg,
          });
          logger.warn('[createProject] createRspMatchers skipped:', msg);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          step: 'Generate compile_commands.json',
          ok: false,
          detail: msg,
        });
        logger.error('[createProject] compile_commands.json failed:', msg);
      }
      progress.report({ increment: 20 });

      // Step 3: create curated completion files (60%)
      progress.report({
        message: 'Step 3/5: creating completion files...',
        increment: 0,
      });
      try {
        const fileResults = await createCompletionFiles(project.path);
        const created = fileResults.filter((f) => f.created).length;
        results.push({
          step: 'Create completion files',
          ok: true,
          detail: `${fileResults.length} files (${created} new) in ${customDir}`,
        });
        logger.info(
          `[createProject] completion files: ${fileResults.map((f) => `${f.name}=${f.created ? 'new' : 'kept'}`).join(', ')}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          step: 'Create completion files',
          ok: false,
          detail: msg,
        });
        logger.error('[createProject] completion files failed:', msg);
      }
      progress.report({ increment: 20 });

      // Step 3.5（借鉴 boocs/unreal-clangd）:可选生成 .clang-format / .clang-tidy 基础文件。
      // 只创建缺失项（已存在不覆盖）;两个开关由 scaffold.clangFormat / scaffold.clangTidy 控制。
      // 非阻断 —— 失败仅记 result,不影响主流程。
      try {
        const scaffold = await scaffoldClangFormatAndTidy(projectDir, {
          clangFormat: config.scaffoldClangFormat,
          clangTidy: config.scaffoldClangTidy,
        });
        const fmt = scaffold.clangFormat.created
          ? 'created'
          : `skipped (${scaffold.clangFormat.skippedReason ?? 'exists'})`;
        const tidy = scaffold.clangTidy.created
          ? 'created'
          : `skipped (${scaffold.clangTidy.skippedReason ?? 'exists'})`;
        results.push({
          step: 'Scaffold .clang-format / .clang-tidy',
          ok: true,
          detail: `format=${fmt}, tidy=${tidy}`,
        });
        logger.info(`[createProject] scaffold format=${fmt}, tidy=${tidy}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          step: 'Scaffold .clang-format / .clang-tidy',
          ok: false,
          detail: msg,
        });
        logger.warn('[createProject] scaffold clang-format/tidy skipped:', msg);
      }

      // Step 4: add completionHelper.cpp to compile_commands.json (80%)
      progress.report({
        message: 'Step 4/5: adding completion helper to compile_commands.json...',
        increment: 0,
      });
      try {
        const added = await addCompletionHelperToCompileCommands(project.path, jsonPath);
        results.push({
          step: 'Add to compile_commands.json',
          ok: true,
          detail: added
            ? 'completionHelper.cpp added'
            : 'compile_commands.json not found or empty (skipped)',
        });
        logger.info(
          `[createProject] addCompletionHelperToCompileCommands: ${added ? 'added' : 'skipped'}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({
          step: 'Add to compile_commands.json',
          ok: false,
          detail: msg,
        });
        logger.error('[createProject] addCompletionHelperToCompileCommands failed:', msg);
      }
      progress.report({ increment: 20 });

      // Step 5: 完成提示 (100%)
      progress.report({
        message: 'Step 5/5: finalizing...',
        increment: 0,
      });
      results.push({
        step: 'Complete',
        ok: true,
        detail: 'Use "Set System Includes" to add MSVC/SDK paths. Otherwise ready.',
      });
      progress.report({ increment: 20 });
    },
  );

  // === Summary ===
  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  const lines = results.map((r) => `${r.ok ? 'OK ' : 'FAIL'} ${r.step}: ${r.detail}`);
  logger.info(`[createProject] ${ok}/${total} steps OK\n${lines.join('\n')}`);

  // 简化弹窗：只显示成功提示
  void vscode.window.showInformationMessage(t('createProject.success'));
}
