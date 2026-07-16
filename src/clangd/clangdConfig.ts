/**
 * clangdConfig —— 在项目根写 .clangd 文件
 *
 * 设计变更（per Plan Add 收束 —— 强化版）：
 * - `CompileFlags.Add` 字段**永远输出空数组** (`[]`)。所有 Add 由用户在控制面板
 *   「自定义 Add Flags」tab 显式勾选决定，或由 setSystemIncludes / createProject 命令
 *   通过 ClangdOps.applyAddFlags 写入。
 * - 系统零默认注入：defaultClangdConfig 不再内置任何 MSVC warning、/std:、
 *   -I、/FI、/imsvc 等 baseline flag。
 * - 旧 API（writeClangdConfig / findClangdConfig）保留以兼容仍直调它们的命令路径。
 *
 * 典型生成的 .clangd:
 *
 * CompileFlags:
 *   CompilationDatabase: .vscode/vscodeuehelper
 *   Compiler: D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe
 *   Add: []
 * Diagnostics:
 *   UnusedIncludes: None
 * InlayHints:
 *   Enabled: Yes
 * ...
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { ClangdConfig, IfBlock } from './types';

// ===== 默认 .clangd 内容 =====

/** 选项（精简版） */
export interface ClangdConfigOptions {
  /** 完成模式（保留兼容）；不再影响 Add 内容 */
  completionMode?: 'fast' | 'slow';
  /** 编译器路径（模板风格，如 D:/scoop/apps/llvm/22.1.8/bin/clang-cl.exe） */
  compilerPath?: string;
  /** 项目路径（用于生成 If.PathMatch 规则） */
  projectPath?: string;
}

/**
 * 默认配置 —— 输出 CompileFlags.Add 为**空数组**。
 *
 * ⚠️ Plan Add 收束(强化版)：之前保留 `MSVC_BASE_FLAGS` 作为隐式 baseline,
 * 但用户明确"系统完全不让 add 默认注入",因此 Add 现在永远 `[]`。
 *
 * 不再注入 compatHeader / systemInclude / /std:c++20 / macroHelper /
 * preparseHeaders / intermediateUhtDirs / MSVC warning —— 这些全交给 flagGlossary
 * 与 ClangdOps.applyAddFlags。
 *
 * @param opts - 见 `ClangdConfigOptions`
 */
export function defaultClangdConfig(opts: ClangdConfigOptions = {}): ClangdConfig {
  const addFlags: string[] = [];

  // 构建 If.PathMatch 规则（模板风格）
  const pathMatch: string[] = [];
  if (opts.projectPath) {
    pathMatch.push('.vscode/vscodeuehelper/completionHelper.cpp');
    pathMatch.push('Source/.*\\.(cpp|h|hpp|c)');
    pathMatch.push('Plugins/.*/Source/.*\\.(cpp|h|hpp|c)');
  }

  // If 块必须放在对象字面量的第一个属性位置，确保 YAML 序列化时 If 在 CompileFlags 之前
  const result: ClangdConfig = {
    ...(pathMatch.length > 0 ? { If: { PathMatch: pathMatch } as IfBlock } : {}),
    CompileFlags: {
      CompilationDatabase: '.vscode/vscodeuehelper',
      Compiler: opts.compilerPath,
      Add: addFlags,
    },
    InlayHints: {
      Enabled: 'Yes',
      ParameterNames: 'Yes',
      DeducedTypes: 'Yes',
      Designators: 'Yes',
    },
    Diagnostics: {
      UnusedIncludes: 'None',
      MissingIncludes: 'None',
    },
    // [Phase 7 D-12] 与 vscodeUEHelper perf-cache 共享 .cache/clangd/ 目录
    // 启用 Background Build 模式：clangd 在空闲时后台构建索引，不阻塞编辑
    // ⚠️ 22.x 不支持 Index 在 If 块中（types.ts 第 33 行），所以放在根级别
    Index: {
      Background: 'Build',
    },
  };

  return result;
}

// ===== 序列化 =====

/** 把 ClangdConfig 对象渲染为 YAML 文本 */
export function renderClangdConfig(config: ClangdConfig): string {
  const doc = new yaml.Document(config);
  return doc.toString({ lineWidth: 0 });  // lineWidth=0 禁止自动折行（防止长路径被 yaml 库折行）
}

// ===== 写文件 =====

/**
 * 把 .clangd 写入项目根目录（兼容旧 API，内部走 ClangdOps 风格）
 *
 * 重写整个文件（非增量），保证只有一个 CompileFlags 块。
 *
 * @deprecated 推荐用 ClangdOps.writeFull 与 applyAddFlags，避免重复传 projectPath。
 */
export async function writeClangdConfig(
  projectPath: string,
  opts: ClangdConfigOptions = {},
): Promise<string> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  const yamlText = renderClangdConfig(defaultClangdConfig(opts));
  // 原子写入：temp + rename（per PATTERNS §3 第 280-285 行）
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, yamlText, 'utf-8');
  try {
    await fs.rename(tmp, target);
  } catch (err) {
    try { await fs.unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
  return target;
}

/** 查找 .clangd（兼容旧 API） */
export async function findClangdConfig(projectPath: string): Promise<string | null> {
  const target = path.join(path.dirname(projectPath), '.clangd');
  try {
    await fs.access(target);
    return target;
  } catch {
    return null;
  }
}
