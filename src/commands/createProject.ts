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
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import {
  generateCompileCommands,
  createCompletionFiles,
  addCompletionHelperToCompileCommands,
  linkToWorkspaceRoot,
  startModifyResponseFiles,
  startCreateRspMatchers,
  fillMissingCompileCommands,
  runUhtCodegen,
  type UhtResult,
} from '@clangd';
import type { FillResult } from '@clangd/compileCommands';
import type { ClangdOps } from '@clangd/clangdOps';
import { pickProject, pickEngine } from '@ui/quickPicks';
import { t } from '@i18n';
import type { DetectionHandles } from '@detection';

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
): Promise<void> {
  logger.info('[createProject] invoked');

  // === Project + engine resolution ===
  const projects = await detection.scanner.scan();
  let project = projects.find(
    (p) => p.path === detection.workspaceContext.getSelectedProject(),
  );
  if (!project && projects.length === 1) {project = projects[0];}
  if (!project) {project = await pickProject(projects);}
  if (!project) {return;}
  await detection.workspaceContext.setProject(project);

  const engines = await detection.discovery.discover();
  let engine = engines.find(
    (e) => e.path === detection.workspaceContext.getSelectedEngine(),
  );
  if (!engine && engines.length === 1) {engine = engines[0];}
  if (!engine) {engine = await pickEngine(engines);}
  if (!engine) {return;}
  await detection.workspaceContext.setEngine(engine);

  const projectDir = path.dirname(project.path);

  // compile_commands.json 生成路径，step 2 赋值，step 4 使用
  let jsonPath = '';
  // 仅用于日志信息（createCompletionFiles 内部已有自己的路径派生）
  const customDir = path.join(projectDir, '.vscode', 'vscodeuehelper');

  // === 5-step pipeline ===
  const results: { step: string; ok: boolean; detail: string }[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
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
            `project=${project.path}, projectDir=${projectDirForLink}, engine=${engine.path}`
        );

        // [UHT pre-codegen] 主动跑 UBT -Mode=UnrealHeaderTool 预生成 .generated.h。
        // 即便后续 UBT 主链路失败（unresolved symbol / 缺类型），partial headers 仍能让
        // clangd 给出基本提示；UHT 抛错（无 dotnet / 非法 buildTargetName 等）仅
        // logger.warn，不阻断 step 2 —— 与 fillMissingCompileCommands / startModifyResponseFiles
        // / startCreateRspMatchers 三个"非阻断"子步骤同模式。
        try {
          const buildTargetName = project.name ? `${project.name}Editor` : '';
          if (!buildTargetName) {
            logger.warn(
              '[createProject] step 2 UHT pre-codegen skipped: project.name is empty',
            );
            results.push({
              step: 'Run UHT pre-codegen',
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
              step: 'Run UHT pre-codegen',
              ok: uhtResult.ran || uhtResult.generatedHeaderCount > 0,
              detail: `generated ${uhtResult.generatedHeaderCount} .generated.h (UBT exit ${uhtResult.exitCode ?? 'null'})`,
            });
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn('[createProject] step 2 UHT pre-codegen failed:', msg);
          results.push({
            step: 'Run UHT pre-codegen',
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

        // [LOG] step 2 调用 linkToWorkspaceRoot 前：明确打印 jsonPath + 目标 projectDir
        // 注意：传入 project.path（.uproject 文件路径），函数内部 path.dirname() 得到
        // projectDir，即 .uproject 所在目录
        logger.info(
          `[createProject] step 2 calling linkToWorkspaceRoot: ` +
            `jsonPath=${jsonPath}, projectPath=${project.path} (projectDir will be ${projectDirForLink})`
        );
        const linkPath = await linkToWorkspaceRoot(jsonPath, project.path, logger);

        // [LOG] step 2 调用后：打印 linkPath，便于对照 target 是否真的到了
        // .vscode/vscodeuehelper/compile_commands.json
        logger.info(`[createProject] step 2 linkToWorkspaceRoot returned linkPath=${linkPath}`);

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

      // Step 4: add completionHelper.cpp to compile_commands.json (80%)
      progress.report({
        message: 'Step 4/5: adding completion helper to compile_commands.json...',
        increment: 0,
      });
      try {
        const added = await addCompletionHelperToCompileCommands(
          project.path,
          jsonPath,
        );
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
        logger.error(
          '[createProject] addCompletionHelperToCompileCommands failed:',
          msg,
        );
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
        detail:
          process.platform === 'win32'
            ? 'Use "Set System Includes" to add MSVC/SDK paths. Otherwise ready.'
            : 'Project ready to use',
      });
      progress.report({ increment: 20 });
    },
  );

  // === Summary ===
  const ok = results.filter((r) => r.ok).length;
  const total = results.length;
  const lines = results.map(
    (r) => `${r.ok ? 'OK ' : 'FAIL'} ${r.step}: ${r.detail}`,
  );
  logger.info(`[createProject] ${ok}/${total} steps OK\n${lines.join('\n')}`);

  // 简化弹窗：只显示成功提示
  void vscode.window.showInformationMessage(t('createProject.success'));
}
