/**
 * workspace.test.ts —— WorkspaceState 公共 surface 行为测试
 *
 * 覆盖范围：
 *   - selectedProject / selectedEngine getter + setter（持久化）
 *   - 选择不存在 / undefined 时的回退（null）
 *   - dispose 后 getter 回到 null
 *   - workspaceContext 可选依赖的兼容路径
 *
 * [Phase 9 SSoT 收尾] 这些方法是 29 处 selection 调用的真实 SSoT 入口。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as vscode from 'vscode';
import { Logger } from '@core/logger';
import { WorkspaceState } from '@core/workspace';
import { WorkspaceContext } from '@detection/workspaceContext';
import type { DetectionResult } from '@detection';
import type { ProjectInfo, EngineInstall } from '@detection/types';

const noopLogger = new Logger('ssot-workspace-test');

function makeProject(name: string, path: string): ProjectInfo {
  return { name, path, engineAssociation: '5.4', modules: [name], raw: {} };
}
function makeEngine(version: string, path: string): EngineInstall {
  return { path, version, isLauncherInstall: false };
}

const fakeProject = makeProject('MyGame', 'D:/proj/MyGame/MyGame.uproject');
const fakeProject2 = makeProject('MyGame2', 'D:/proj/MyGame2/MyGame2.uproject');
const fakeEngine = makeEngine('5.5.0', 'D:/UE_5.5');
const fakeEngine2 = makeEngine('5.4.2', 'D:/UE_5.4');

/** 模拟 vscode.Memento（持久化 map） */
function makeFakeMemento(): vscode.Memento {
  const store = new Map<string, unknown>();
  return {
    keys: () => Array.from(store.keys()),
    get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
    update: (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
      return Promise.resolve();
    },
  };
}

/** 构造最小可用 detection.handle（mock Memento + scanner + discovery） */
function makeFakeDetection(
  opts: {
    workspaceContext?: WorkspaceContext;
  } = {},
) {
  const memento = makeFakeMemento();
  const workspaceContext = opts.workspaceContext ?? new WorkspaceContext(memento);
  return {
    detection: {
      workspaceContext,
      ready: Promise.resolve({
        projects: [fakeProject],
        engines: [fakeEngine],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      }),
    },
  };
}

describe('WorkspaceState.selected* (Phase 9 SSoT)', () => {
  describe('注入 workspaceContext 后', () => {
    let mementoStore: Map<string, unknown>;
    let memento: vscode.Memento;
    let workspaceContext: WorkspaceContext;
    let workspace: WorkspaceState;

    beforeEach(() => {
      mementoStore = new Map<string, unknown>();
      memento = {
        keys: () => Array.from(mementoStore.keys()),
        get: <T>(key: string): T | undefined => mementoStore.get(key) as T | undefined,
        update: (key: string, value: unknown): Promise<void> => {
          mementoStore.set(key, value);
          return Promise.resolve();
        },
      };
      workspaceContext = new WorkspaceContext(memento);
      void workspaceContext.setProject(fakeProject);
      void workspaceContext.setEngine(fakeEngine);

      const { detection } = makeFakeDetection({ workspaceContext });
      workspace = new WorkspaceState({ detection, logger: noopLogger, workspaceContext });
    });

    it('selectedProject 返回持久化的 .uproject 路径', () => {
      expect(workspace.selectedProject).toBe(fakeProject.path);
    });

    it('selectedEngine 返回持久化的引擎根路径', () => {
      expect(workspace.selectedEngine).toBe(fakeEngine.path);
    });

    it('setSelectedProject(value) 持久化新值', async () => {
      await workspace.setSelectedProject(fakeProject2);
      expect(workspace.selectedProject).toBe(fakeProject2.path);
    });

    it('setSelectedProject 持久化跨实例可见', async () => {
      await workspace.setSelectedProject(fakeProject2);
      const { detection } = makeFakeDetection({ workspaceContext });
      const ws2 = new WorkspaceState({ detection, logger: noopLogger, workspaceContext });
      expect(ws2.selectedProject).toBe(fakeProject2.path);
    });

    it('setSelectedEngine(value) 持久化新值', async () => {
      await workspace.setSelectedEngine(fakeEngine2);
      expect(workspace.selectedEngine).toBe(fakeEngine2.path);
    });

    it('setSelectedEngine 持久化跨实例可见', async () => {
      await workspace.setSelectedEngine(fakeEngine2);
      const { detection } = makeFakeDetection({ workspaceContext });
      const ws2 = new WorkspaceState({ detection, logger: noopLogger, workspaceContext });
      expect(ws2.selectedEngine).toBe(fakeEngine2.path);
    });

    it('setSelectedProject(undefined) 显式清除选择', async () => {
      await workspace.setSelectedProject(fakeProject2);
      expect(workspace.selectedProject).toBe(fakeProject2.path);
      await workspace.setSelectedProject(undefined);
      expect(workspace.selectedProject).toBeNull();
    });

    it('setSelectedEngine(undefined) 显式清除选择', async () => {
      await workspace.setSelectedEngine(fakeEngine2);
      expect(workspace.selectedEngine).toBe(fakeEngine2.path);
      await workspace.setSelectedEngine(undefined);
      expect(workspace.selectedEngine).toBeNull();
    });
  });

  describe('detection.ready 时序', () => {
    it('ready 前访问派生 getter 不误报，ready 后恢复真实项目和引擎信息', async () => {
      let resolveReady!: (result: DetectionResult) => void;
      const ready = new Promise<DetectionResult>((resolve) => {
        resolveReady = resolve;
      });
      const warningSpy = vi.spyOn(vscode.window, 'showWarningMessage');
      warningSpy.mockClear();
      const workspace = new WorkspaceState({ detection: { ready }, logger: noopLogger });

      try {
        expect(workspace.projectFile).toBeNull();
        expect(workspace.engineRoot).toBeNull();
        expect(warningSpy).not.toHaveBeenCalled();

        resolveReady({
          projects: [fakeProject],
          engines: [fakeEngine],
          workspaceFile: 'D:/proj/MyGame/MyGame.code-workspace',
          workspaceRoot: 'D:/proj/MyGame',
          workspaceFolders: [],
          projectFolder: null,
          engineFolder: null,
        });
        await ready;
        await Promise.resolve();

        expect(workspace.projectFile).toBe(fakeProject.path);
        expect(workspace.engineRoot).toBe(fakeEngine.path);
        expect(warningSpy).not.toHaveBeenCalled();
      } finally {
        warningSpy.mockRestore();
      }
    });

    it('ready 后确实缺失时仍提示重新生成工作区', async () => {
      const warningSpy = vi.spyOn(vscode.window, 'showWarningMessage');
      warningSpy.mockClear();
      const workspace = new WorkspaceState({
        detection: {
          ready: Promise.resolve({
            projects: [],
            engines: [],
            workspaceFile: undefined,
            workspaceRoot: undefined,
            workspaceFolders: [],
            projectFolder: null,
            engineFolder: null,
          }),
        },
        logger: noopLogger,
      });

      try {
        await Promise.resolve();
        await Promise.resolve();
        expect(workspace.project).toBeNull();
        expect(warningSpy).toHaveBeenCalledWith('从 .uproject 重新生成工作区');
      } finally {
        warningSpy.mockRestore();
      }
    });
  });

  describe('未注入 workspaceContext 的边角场景', () => {
    it('setter 是 no-op，getter 返回 null', async () => {
      // 工作区 state 接受完整的 detection handle；但这里只关心 _workspaceContext=null 时 setter 走 no-op
      // 用 unknown 转型简化 stub；提供一个最小有效的 ready 来满足 setResult 的内部索引（避免 unhandled rejection）
      const stubDetection = {
        workspaceContext: null as unknown as WorkspaceContext,
        ready: Promise.resolve({
          projects: [] as ProjectInfo[],
          engines: [] as EngineInstall[],
          workspaceFolders: [],
          projectFolder: null,
          engineFolder: null,
        }),
      } as unknown as ConstructorParameters<typeof WorkspaceState>[0]['detection'];
      const workspace = new WorkspaceState({ detection: stubDetection, logger: noopLogger });

      await expect(workspace.setSelectedProject(fakeProject)).resolves.toBeUndefined();
      await expect(workspace.setSelectedEngine(fakeEngine)).resolves.toBeUndefined();

      expect(workspace.selectedProject).toBeNull();
      expect(workspace.selectedEngine).toBeNull();
    });

    it('setter 输出 warning 提示 no-op', async () => {
      const warnSpy = vi.fn();
      const stubLogger = {
        info: () => {},
        warn: warnSpy,
        error: () => {},
        show: () => {},
      } as unknown as Logger;

      const stubDetection = {
        workspaceContext: null as unknown as WorkspaceContext,
        ready: Promise.resolve({
          projects: [] as ProjectInfo[],
          engines: [] as EngineInstall[],
          workspaceFolders: [],
          projectFolder: null,
          engineFolder: null,
        }),
      } as unknown as ConstructorParameters<typeof WorkspaceState>[0]['detection'];
      const workspace = new WorkspaceState({ detection: stubDetection, logger: stubLogger });

      await workspace.setSelectedProject(fakeProject);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('setSelectedProject'));

      warnSpy.mockClear();
      await workspace.setSelectedEngine(fakeEngine);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('setSelectedEngine'));
    });
  });

  describe('dispose 后', () => {
    it('getter 返回 null（不再访问旧 _workspaceContext）', async () => {
      const memento = makeFakeMemento();
      const workspaceContext = new WorkspaceContext(memento);
      await workspaceContext.setProject(fakeProject);
      await workspaceContext.setEngine(fakeEngine);

      const { detection } = makeFakeDetection({ workspaceContext });
      const workspace = new WorkspaceState({ detection, logger: noopLogger, workspaceContext });
      expect(workspace.selectedProject).toBe(fakeProject.path);

      workspace.dispose();
      expect(workspace.selectedProject).toBeNull();
      expect(workspace.selectedEngine).toBeNull();
    });

    it('setter 是 no-op（不抛错）', async () => {
      const { detection } = makeFakeDetection();
      const workspace = new WorkspaceState({ detection, logger: noopLogger });
      workspace.dispose();
      await expect(workspace.setSelectedProject(fakeProject)).resolves.toBeUndefined();
    });
  });
});
