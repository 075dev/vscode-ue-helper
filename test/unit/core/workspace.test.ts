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

    // [F2-15/W17] selection 变更事件:setSelected* 成功后必须 fire,UI 靠它重绘状态栏
    it('setSelectedProject 成功后 fire onDidChangeSelection', async () => {
      const listener = vi.fn();
      const sub = workspace.onDidChangeSelection(listener);
      await workspace.setSelectedProject(fakeProject2);
      expect(listener).toHaveBeenCalledTimes(1);
      sub.dispose();
    });

    it('setSelectedEngine 成功后 fire onDidChangeSelection', async () => {
      const listener = vi.fn();
      const sub = workspace.onDidChangeSelection(listener);
      await workspace.setSelectedEngine(fakeEngine2);
      expect(listener).toHaveBeenCalledTimes(1);
      sub.dispose();
    });

    it('dispose 释放 emitter,setSelected* 不再触发事件且不抛错', async () => {
      const listener = vi.fn();
      const sub = workspace.onDidChangeSelection(listener);
      await workspace.setSelectedProject(fakeProject2);
      expect(listener).toHaveBeenCalledTimes(1);
      workspace.dispose();
      // dispose 后 setter 是 no-op(无 workspaceContext),不会 fire,也不会抛错
      await expect(workspace.setSelectedProject(fakeProject2)).resolves.toBeUndefined();
      expect(listener).toHaveBeenCalledTimes(1);
      sub.dispose();
    });

    // [F2-18/W25] Windows 路径大小写不敏感:持久化路径大小写与检测路径不同也能匹配
    it('resolveSelectedProject 大小写不敏感匹配', async () => {
      await workspace.setSelectedProject({ ...fakeProject2, path: fakeProject2.path.toLowerCase() });
      const found = workspace.resolveSelectedProject([fakeProject2]);
      expect(found?.path).toBe(fakeProject2.path);
    });

    it('resolveSelectedEngine 大小写不敏感匹配', async () => {
      await workspace.setSelectedEngine({ ...fakeEngine2, path: fakeEngine2.path.toLowerCase() });
      const found = workspace.resolveSelectedEngine([fakeEngine2]);
      expect(found?.path).toBe(fakeEngine2.path);
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

    it('ready 后无项目 → 字段缺失静音(只日志,不弹窗)', async () => {
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
        // [用户决策] 未检测到 .uproject 是正常场景(非 UE 工作区),
        // 派生字段缺失属预期 —— 只记日志,绝不弹"从 .uproject 重新生成工作区"
        void workspace.projectDir;
        void workspace.projectName;
        expect(warningSpy).not.toHaveBeenCalled();
      } finally {
        warningSpy.mockRestore();
      }
    });

    it('ready 后检测到了项目但派生字段仍缺失 → 弹窗提示重新生成工作区', async () => {
      const warningSpy = vi.spyOn(vscode.window, 'showWarningMessage');
      warningSpy.mockClear();
      // 有项目(projectFolder 为 null,projectDir 只能从 project.path 派生 → 不缺失)
      // 这里构造真实异常:projectFolder 与 project 都有,但 workspaceFile 缺失 →
      // workspaceRoot 无法派生 → 应弹窗
      const workspace = new WorkspaceState({
        detection: {
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
        logger: noopLogger,
      });

      try {
        await Promise.resolve();
        await Promise.resolve();
        expect(workspace.project).not.toBeNull();
        void workspace.workspaceRoot;
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

// ===== A7: Level 0/1 派生 getter 单测 =====

// 关键陷阱:WorkspaceState 构造时**会**订阅 detection.ready 并在 ready 解析时自动 setResult,
// 覆盖我后续的 setResult。解决:在 setResult 之前用 never-resolving Promise 阻止自动注入,
// setResult 之后再 resolve 来"无缝替换"——但更简单的是,绕开构造时注入:用一个永不 resolve
// 的 ready,等 setResult 完成后手动 resolve 即可覆盖。
function makePendingDetection() {
  let resolve!: (r: import('@detection').DetectionResult) => void;
  const ready = new Promise<import('@detection').DetectionResult>((r) => {
    resolve = r;
  });
  return {
    detection: {
      ready,
      workspaceContext: null as unknown as WorkspaceContext,
    },
    resolve,
  };
}

describe('WorkspaceState — Level 0 根源 getter', () => {
  function makeInjected(overrides: {
    projectFolder?: { name: string; path: string; absPath: string; role: 'project' } | null;
    engineFolder?: { name: string; path: string; absPath: string; role: 'engine' } | null;
    workspaceFile?: string;
    project?: ProjectInfo;
    engine?: EngineInstall;
  } = {}): WorkspaceState {
    const { detection } = makePendingDetection();
    const workspace = new WorkspaceState({ detection, logger: noopLogger });
    // [关键] ready 永远不 resolve,不会覆盖我后续的 setResult
    // 用 === undefined 区分"未传" vs "显式传 null"——项目 folder 显式 null 是合法场景
    // (例如:没有 .uproject 但打开了 .code-workspace)。不可用 'in' 判断:TS 对可选属性
    // 的 in 收窄不会去除 | undefined,直接传给 setResult 会 TS2322。
    const defaultProjectFolder = { name: 'MyGame', path: 'D:/proj/MyGame', absPath: 'D:/proj/MyGame', role: 'project' as const };
    const defaultEngineFolder = { name: 'UE5', path: 'D:/UE_5.5', absPath: 'D:/UE_5.5', role: 'engine' as const };
    const projectFolder = overrides.projectFolder === undefined
      ? defaultProjectFolder
      : overrides.projectFolder;
    const engineFolder = overrides.engineFolder === undefined
      ? defaultEngineFolder
      : overrides.engineFolder;
    workspace.setResult({
      projects: [overrides.project ?? fakeProject],
      engines: [overrides.engine ?? fakeEngine],
      workspaceFile: overrides.workspaceFile,
      workspaceRoot: undefined,
      workspaceFolders: [projectFolder, engineFolder].filter((f): f is NonNullable<typeof f> => f !== null),
      projectFolder,
      engineFolder,
    });
    return workspace;
  }

  describe('isInjected / workspaceFile / workspaceFolders', () => {
    it('isInjected 在 setResult 后为 true', () => {
      const ws = makeInjected();
      expect(ws.isInjected).toBe(true);
    });

    it('isInjected 在构造但未 setResult 前为 false', () => {
      const { detection } = makePendingDetection();
      const ws = new WorkspaceState({ detection, logger: noopLogger });
      expect(ws.isInjected).toBe(false);
    });

    it('workspaceFile 反映 setResult 传入值', () => {
      const ws = makeInjected({ workspaceFile: 'D:/ws/MyGame.code-workspace' });
      expect(ws.workspaceFile).toBe('D:/ws/MyGame.code-workspace');
    });

    it('workspaceFile 为 undefined 时返回 null', () => {
      const ws = makeInjected({ workspaceFile: undefined });
      expect(ws.workspaceFile).toBeNull();
    });

    it('workspaceFolders 返回 setResult 注入的数组', () => {
      const ws = makeInjected();
      const folders = ws.workspaceFolders;
      expect(folders).toHaveLength(2);
      expect(folders[0]?.name).toBe('MyGame');
      expect(folders[1]?.name).toBe('UE5');
    });
  });

  describe('projectFolder / engineFolder / project / engine', () => {
    it('projectFolder 反映 role=project 的 folder', () => {
      const ws = makeInjected();
      expect(ws.projectFolder).toEqual({
        name: 'MyGame',
        path: 'D:/proj/MyGame',
        absPath: 'D:/proj/MyGame',
        role: 'project',
      });
    });

    it('engineFolder 反映 role=engine 的 folder', () => {
      const ws = makeInjected();
      expect(ws.engineFolder).toEqual({
        name: 'UE5',
        path: 'D:/UE_5.5',
        absPath: 'D:/UE_5.5',
        role: 'engine',
      });
    });

    it('project 返回首个 project', () => {
      const ws = makeInjected();
      expect(ws.project?.name).toBe('MyGame');
    });

    it('engine 返回首个 engine', () => {
      const ws = makeInjected();
      expect(ws.engine?.version).toBe('5.5.0');
    });
  });
});

describe('WorkspaceState — Level 1 派生路径 getter', () => {
  function makeInjected(overrides: {
    projectFolder?: { name: string; path: string; absPath: string; role: 'project' } | null;
    engineFolder?: { name: string; path: string; absPath: string; role: 'engine' } | null;
    workspaceFile?: string;
    project?: ProjectInfo;
    engine?: EngineInstall;
  } = {}): WorkspaceState {
    const { detection } = makePendingDetection();
    const workspace = new WorkspaceState({ detection, logger: noopLogger });
    const defaultProjectFolder = { name: 'MyGame', path: 'D:/proj/MyGame', absPath: 'D:/proj/MyGame', role: 'project' as const };
    const defaultEngineFolder = { name: 'UE5', path: 'D:/UE_5.5', absPath: 'D:/UE_5.5', role: 'engine' as const };
    const projectFolder = overrides.projectFolder === undefined
      ? defaultProjectFolder
      : overrides.projectFolder;
    const engineFolder = overrides.engineFolder === undefined
      ? defaultEngineFolder
      : overrides.engineFolder;
    workspace.setResult({
      projects: [overrides.project ?? fakeProject],
      engines: [overrides.engine ?? fakeEngine],
      workspaceFile: overrides.workspaceFile,
      workspaceRoot: undefined,
      workspaceFolders: [projectFolder, engineFolder].filter((f): f is NonNullable<typeof f> => f !== null),
      projectFolder,
      engineFolder,
    });
    return workspace;
  }

  describe('workspaceRoot', () => {
    it('有 workspaceFile 时返回其 dirname', () => {
      const ws = makeInjected({ workspaceFile: 'D:/ws/MyGame.code-workspace' });
      // 平台相关——只要包含上级目录名 'ws' 即可
      expect(ws.workspaceRoot).toBe('D:/ws');
    });

    it('无 workspaceFile 时返回 null', () => {
      const ws = makeInjected({ workspaceFile: undefined });
      expect(ws.workspaceRoot).toBeNull();
    });
  });

  describe('projectDir / projectFile / projectName', () => {
    it('projectDir 优先用 projectFolder.absPath', () => {
      const ws = makeInjected({
        projectFolder: { name: 'MyGame', path: 'D:/detected/MyGame', absPath: 'D:/detected/MyGame', role: 'project' },
      });
      expect(ws.projectDir).toBe('D:/detected/MyGame');
    });

    it('projectDir fallback 到 project.path 的 dirname', () => {
      const ws = makeInjected({ projectFolder: null });
      // fakeProject.path = D:/proj/MyGame/MyGame.uproject
      expect(ws.projectDir).toBe('D:/proj/MyGame');
    });

    it('projectDir 两者都缺失时返回 null', () => {
      const { detection } = makePendingDetection();
      const workspace = new WorkspaceState({ detection, logger: noopLogger });
      workspace.setResult({
        projects: [],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      });
      expect(workspace.projectDir).toBeNull();
    });

    it('projectFile 优先用 project.path(完整 .uproject 路径)', () => {
      const ws = makeInjected();
      expect(ws.projectFile).toBe(fakeProject.path);
    });

    it('projectFile 缺失 project 时由 projectDir + projectFolder.name 拼接', () => {
      const { detection } = makePendingDetection();
      const workspace = new WorkspaceState({ detection, logger: noopLogger });
      workspace.setResult({
        projects: [],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [
          { name: 'MyGame', path: 'D:/detected/MyGame', absPath: 'D:/detected/MyGame', role: 'project' },
        ],
        projectFolder: { name: 'MyGame', path: 'D:/detected/MyGame', absPath: 'D:/detected/MyGame', role: 'project' },
        engineFolder: null,
      });
      // 平台相关 path——只断言"以 MyGame.uproject 结尾 + 含 detected"
      expect(workspace.projectFile).toMatch(/MyGame\.uproject$/);
      expect(workspace.projectFile).toContain('detected');
    });

    it('projectName 优先用 projectFolder.name', () => {
      const ws = makeInjected({
        projectFolder: { name: 'DetectedName', path: 'D:/x', absPath: 'D:/x', role: 'project' },
      });
      expect(ws.projectName).toBe('DetectedName');
    });

    it('projectName fallback 到 project.path basename 去掉 .uproject 后缀', () => {
      const ws = makeInjected({ projectFolder: null });
      expect(ws.projectName).toBe('MyGame');
    });

    it('projectName 两者都缺失时返回 null', () => {
      const { detection } = makePendingDetection();
      const workspace = new WorkspaceState({ detection, logger: noopLogger });
      workspace.setResult({
        projects: [],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      });
      expect(workspace.projectName).toBeNull();
    });
  });

  describe('engineRoot / engineVersion', () => {
    it('engineRoot 优先用 engineFolder.absPath', () => {
      const ws = makeInjected({
        engineFolder: { name: 'UE5', path: 'D:/detected/UE', absPath: 'D:/detected/UE', role: 'engine' },
      });
      expect(ws.engineRoot).toBe('D:/detected/UE');
    });

    it('engineRoot fallback 到 engine.path', () => {
      const ws = makeInjected({ engineFolder: null });
      expect(ws.engineRoot).toBe(fakeEngine.path);
    });

    it('engineRoot 两者都缺失时返回 null', () => {
      const { detection } = makePendingDetection();
      const workspace = new WorkspaceState({ detection, logger: noopLogger });
      workspace.setResult({
        projects: [],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      });
      expect(workspace.engineRoot).toBeNull();
    });

    it('engineVersion 返回 engine.version', () => {
      const ws = makeInjected();
      expect(ws.engineVersion).toBe('5.5.0');
    });

    it('engineVersion engine 缺失时返回 null', () => {
      const { detection } = makePendingDetection();
      const workspace = new WorkspaceState({ detection, logger: noopLogger });
      workspace.setResult({
        projects: [],
        engines: [],
        workspaceFile: undefined,
        workspaceRoot: undefined,
        workspaceFolders: [],
        projectFolder: null,
        engineFolder: null,
      });
      expect(workspace.engineVersion).toBeNull();
    });
  });
});
