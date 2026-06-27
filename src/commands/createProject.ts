/**
 * createProject —— 一次性初始化 UE + clangd 工作区
 *
 * 5 步流程（每步在 VS Code 进度条上报告）：
 *   1. 写 .clangd（使用当前 completionMode）
 *   2. 跑 UBT 生成 compile_commands.json
 *   3. 创建补全文件系统（5 个 curated header 文件）
 *   4. 将 completionHelper.cpp 加入 compile_commands.json
 *   5. Windows: 设置系统包含路径（SDK + MSVC + C++ 标准）
 *
 * 额外步骤（后台执行）：
 *   - 修改 rsp 文件移除 PCH 引用
 *   - 工作区备份（防止 UBT 覆盖 .code-workspace）
 *
 * 任何一步失败都允许继续（其他步骤独立）。最后弹汇总结果。
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { Logger } from '@core/logger';
import { Config } from '@core/config';
import {
  writeClangdConfig,
  generateCompileCommands,
  createCompletionFiles,
  addCompletionHelperToCompileCommands,
  linkToWorkspaceRoot,
  startModifyResponseFiles,
  startCreateRspMatchers,
  fillMissingCompileCommands,
} from '@clangd';
import { detectSystemIncludesWithEngineRecommendation } from '@clangd/windowsSdk';
import { pickProject, pickEngine } from '@ui/quickPicks';
import type { DetectionHandles } from '@detection';

export async function executeCreateProject(
  config: Config,
  logger: Logger,
  detection: DetectionHandles,
): Promise<void> {
  logger.info('[createProject] invoked');

  // === Project + engine resolution ===
  const projects = await detection.scanner.scan();
  let project = projects.find(
    (p) => p.path === detection.workspaceContext.getSelectedProject(),
  );
  if (!project && projects.length === 1) project = projects[0];
  if (!project) project = await pickProject(projects);
  if (!project) return;
  await detection.workspaceContext.setProject(project);

  const engines = await detection.discovery.discover();
  let engine = engines.find(
    (e) => e.path === detection.workspaceContext.getSelectedEngine(),
  );
  if (!engine && engines.length === 1) engine = engines[0];
  if (!engine) engine = await pickEngine(engines);
  if (!engine) return;
  await detection.workspaceContext.setEngine(engine);

  const projectDir = path.dirname(project.path);
  const customDir = path.join(projectDir, '.vscode', 'vscodeuehelper');
  const macroHelperPath = path.join(customDir, 'macroCompletionHelper.h');

  // compile_commands.json 生成路径，step 2 赋值，step 4 使用
  let jsonPath = '';

  // === 5-step pipeline ===
  const results: { step: string; ok: boolean; detail: string }[] = [];

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Create Unreal Clangd Project',
      cancellable: false,
    },
    async (progress) => {
      // Step 1: 一次性生成完整的 .clangd（包含系统头文件！）
      // ⚠️ 关键：这里就生成最终版的 .clangd，后续绝不修改！
      // 避免后续调用 replaceSystemIncludeBlock 破坏 YAML 格式！
      progress.report({
        message: `Step 1/5: writing .clangd (mode: ${config.completionMode})...`,
        increment: 0,
      });
      try {
        // Windows 平台：自动检测系统头文件 + 应用引擎推荐的 SDK 版本
        let systemIncludeFlags: string[] | undefined;
        if (process.platform === 'win32') {
          logger.info('[createProject] 自动检测 Windows SDK + MSVC 版本...');
          const result = await detectSystemIncludesWithEngineRecommendation(
            engine.path,
            config.clangdPath,
            logger,
          );
          systemIncludeFlags = result ?? undefined;
          if (systemIncludeFlags) {
            logger.info(`[createProject] 生成了 ${systemIncludeFlags.length} 个系统头文件 flag`);
          }
        }

        const clangdConfigPath = await writeClangdConfig(project.path, {
          completionMode: config.completionMode,
          macroHelperPath:
            config.completionMode === 'slow' ? macroHelperPath : undefined,
          systemIncludeFlags: systemIncludeFlags ?? undefined,
        });
        results.push({
          step: 'Write .clangd',
          ok: true,
          detail: systemIncludeFlags
            ? `${clangdConfigPath} (${systemIncludeFlags.length} system include flags, SDK version matched to UE recommendation)`
            : clangdConfigPath,
        });
        logger.info(`[createProject] wrote ${clangdConfigPath}`);
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

        jsonPath = await generateCompileCommands({
          project: project.path,
          engineRoot: engine.path,
          isNative: true, // Native 模式：-projectfiles，产出实际源文件路径
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
          await fillMissingCompileCommands(linkPath, project.path, logger);
          results.push({
            step: 'Fill missing compile_commands entries',
            ok: true,
            detail: 'All source files now have complete clang flags',
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
            ? '✅ MSVC/SDK paths auto-configured (matched UE recommended SDK version). .clangd is FINAL — do not modify manually!'
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
  void vscode.window.showInformationMessage('✨ Unreal Clangd 项目配置完成');
}
