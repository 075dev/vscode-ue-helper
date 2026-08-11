/**
 * clangdConfig —— .clangd 默认内容工厂 + YAML 序列化
 *
 * 设计变更（per Plan Add 收束 —— 强化版）：
 * - `CompileFlags.Add` 字段**永远输出空数组** (`[]`)。所有 Add 由用户在控制面板
 *   「自定义 Add Flags」tab 显式勾选决定，或由 setSystemIncludes / createProject 命令
 *   通过 ClangdOps.applyAddFlags 写入。
 * - 系统零默认注入：defaultClangdConfig 不再内置任何 MSVC warning、/std:、
 *   -I、/FI、/imsvc 等 baseline flag。
 * - [Phase 9 SSoT] 唯一写入入口是 ClangdOps（writeFull / mutate / applyAddFlags）。
 *   本文件只产出"配置对象 + YAML 文本"，不直接 fs.writeFile（旧的 writeClangdConfig / findClangdConfig 已删除）。
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
 *   ParameterNames: Yes
 *   DeducedTypes: Yes
 *   Designators: Yes
 */

import * as yaml from 'yaml';
import { type ClangdConfig, type IfBlock } from './types';

// ===== 默认 .clangd 内容 =====

/** 选项（精简版） */
export interface ClangdConfigOptions {
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
  return doc.toString({ lineWidth: 0 }); // lineWidth=0 禁止自动折行（防止长路径被 yaml 库折行）
}
