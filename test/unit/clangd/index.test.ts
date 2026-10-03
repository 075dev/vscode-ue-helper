/**
 * index.test.ts —— `@clangd` barrel export 烟雾测试
 *
 * 覆盖范围：
 *   - 现有核心 API 仍可从 `@clangd` 导入（防止 barrel 重构误删历史 export）
 *   - UHT pre-codegen 相关新增 export 存在且类型正确：
 *     - `runUhtCodegen`：函数
 *     - `UhtResult`：接口（用类型守卫 + fake 实例验证结构）
 *     - `RunUhtCodegenOptions`：接口（用 typeof 验证对象字面量赋值合法）
 *     - `MinimalLogger`：接口（结构上兼容 `info/warn/error` 即可）
 *
 * 为什么这里只做"barrel export + 类型烟雾"测试（不做 createProject 集成测试）：
 *   - `src/commands/createProject.ts` 内部 `runUhtCodegen` 调用是真实的 fs/spawn，
 *     集成测试改造范围较大（需要 mock generateCompileCommands 整条链路 OR
 *     vi.mock('@clangd') 重定向到 fake）。
 *   - 真实集成验证留给 plan Todo 6 全栈 UAT。
 *   - 但只要 barrel 暴露了正确类型 + createProject.ts 通过 typecheck，
 *     `runUhtCodegen` 调用点的入参/出参类型就一定是合法的，
 *     单元测试只防"barrel 误删"这一类回归即可。
 *
 * 参考：plan §Todo 2 acceptance criteria 中的"简化方案"。
 */

import { describe, it, expect } from 'vitest';
import {
  // 现有核心 API（防误删回归）
  generateCompileCommands,
  linkToWorkspaceRoot,
  isClangdAvailable,
  fillMissingCompileCommands,
  type FillResult,
  createCompletionFiles,
  addCompletionHelperToCompileCommands,
  defaultClangdConfig,
  renderClangdConfig,
  WorkspaceBackup,
  CompletionModeController,
  discoverSystemIncludes,
  // UHT pre-codegen（Todo 2 新增）
  runUhtCodegen,
  // 注：UhtResult / RunUhtCodegenOptions / MinimalLogger 是 type-only export，
  //     运行时不可见；用 typeof 强制在编译期断言这些类型在 barrel 中存在。
  type UhtResult,
  type RunUhtCodegenOptions,
  type MinimalLogger,
} from '@clangd';

describe('@clangd barrel exports', () => {
  describe('历史 API（防误删回归）', () => {
    it('generateCompileCommands 是函数', () => {
      expect(typeof generateCompileCommands).toBe('function');
    });

    it('linkToWorkspaceRoot 是函数', () => {
      expect(typeof linkToWorkspaceRoot).toBe('function');
    });

    it('isClangdAvailable 是函数', () => {
      expect(typeof isClangdAvailable).toBe('function');
    });

    it('fillMissingCompileCommands 是函数', () => {
      expect(typeof fillMissingCompileCommands).toBe('function');
    });

    it('FillResult 类型在 barrel 中存在且字段匹配', () => {
      const result: FillResult = {
        roots: ['C:/proj/Source'],
        scanned: 1,
        missing: [],
        added: [],
      };
      expect(result.roots).toEqual(['C:/proj/Source']);
      expect(result.scanned).toBe(1);
    });

    it('createCompletionFiles 是函数', () => {
      expect(typeof createCompletionFiles).toBe('function');
    });

    it('addCompletionHelperToCompileCommands 是函数', () => {
      expect(typeof addCompletionHelperToCompileCommands).toBe('function');
    });

    // [Phase 9 SSoT] writeClangdConfig / findClangdConfig 已删除——唯一写入走 ClangdOps
    it('.clangd 配置 API 仅 defaultClangdConfig + renderClangdConfig（写入由 ClangdOps 统一）', () => {
      expect(typeof defaultClangdConfig).toBe('function');
      expect(typeof renderClangdConfig).toBe('function');
    });

    it('WorkspaceBackup 是类', () => {
      expect(typeof WorkspaceBackup).toBe('function');
    });

    it('CompletionModeController 是类', () => {
      expect(typeof CompletionModeController).toBe('function');
    });

    it('discoverSystemIncludes 是函数', () => {
      expect(typeof discoverSystemIncludes).toBe('function');
    });
  });

  describe('UHT pre-codegen（Todo 2 新增）', () => {
    it('runUhtCodegen 是函数', () => {
      expect(typeof runUhtCodegen).toBe('function');
    });

    /**
     * 类型烟雾测试：
     * - UhtResult 是 interface，运行时不可见，但 TS 编译器能在编译期断言
     *   fake 对象"结构上等价于 UhtResult"。
     * - 若 barrel 漏 export UhtResult，下面的 const _check 会 TS 报错；
     *   若 export 名字打错（例如 UHTResult），同样报错。
     * - 用 `void` 避免 ESLint no-unused-vars 警告。
     */
    it('UhtResult 类型在 barrel 中存在且字段匹配', () => {
      const fakeResult: UhtResult = {
        ran: true,
        exitCode: 0,
        generatedHeaderCount: 0,
        generatedHeaderPaths: [],
      };
      expect(fakeResult.ran).toBe(true);
      expect(fakeResult.exitCode).toBe(0);
      expect(fakeResult.generatedHeaderCount).toBe(0);
      expect(fakeResult.generatedHeaderPaths).toEqual([]);
    });

    it('RunUhtCodegenOptions 类型在 barrel 中存在且字段匹配', () => {
      const fakeOptions: RunUhtCodegenOptions = {
        project: 'C:/proj/Foo.uproject',
        engineRoot: 'C:/UE5',
        buildTargetName: 'FooEditor',
        buildType: 'Development',
        // MinimalLogger 烟雾：传结构上兼容的 console 即可
        logger: {
          info: () => {},
          warn: () => {},
          error: () => {},
        },
      };
      expect(fakeOptions.project).toMatch(/\.uproject$/);
      expect(fakeOptions.buildTargetName).toBe('FooEditor');
    });

    it('MinimalLogger 类型在 barrel 中存在', () => {
      // MinimalLogger 是 type-only export，运行时无值；
      // 但若 export 缺失，下面 fakeLogger 的类型会失败（编译期）。
      const fakeLogger: MinimalLogger = {
        info: () => {},
        warn: () => {},
        error: () => {},
      };
      expect(typeof fakeLogger.info).toBe('function');
      expect(typeof fakeLogger.warn).toBe('function');
      expect(typeof fakeLogger.error).toBe('function');
    });
  });
});
