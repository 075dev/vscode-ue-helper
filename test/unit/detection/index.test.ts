/**
 * index.test.ts —— detection 模块入口 activateDetection 行为测试
 *
 * 覆盖 F1-3 修复:
 *   1. .code-workspace 是 JSONC(注释/尾逗号),JSON5.parse 能解析出 folders(旧 JSON.parse 会失败)
 *   2. folders 含 null 条目不崩,产出空 name/path(W20 空值守卫)
 *   3. Build.version 缺失时引擎不 push,engines = [](W21 修复:不再 push version='unknown')
 *   4. JSON5 都解析不了的语法错误 → resolve 全空 + logger.error 含具体错误信息(含行号列号)
 *
 * Mock 策略:
 *   - 不 mock node:fs —— 用真实临时目录写入 .code-workspace 文件(参考 workspaceEngines.test.ts)
 *   - vi.mock('@detection/uprojectScanner') 控制 parseFromPath 返回值
 *   - vi.mock('@detection/workspaceFolders') 控制 readBuildVersion 返回值
 *   - Object.defineProperty 覆盖 vscode.workspace.workspaceFile(setup.ts mock 默认 undefined)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as vscode from 'vscode';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { activateDetection } from '@detection';
import type { ProjectInfo } from '@detection';
import type { Logger } from '@core/logger';
import type { Config } from '@core/config';

// vi.mock 工厂会被 hoist 到 import 之前,工厂内不能引用外层 const,故用 vi.hoisted 提升 mock 引用
const { mockParseFromPath, mockReadBuildVersion } = vi.hoisted(() => ({
  mockParseFromPath: vi.fn(),
  mockReadBuildVersion: vi.fn(),
}));

// 拦截 index.ts 里 `import { UprojectScanner } from './uprojectScanner'`,
// 用 mock 控制 parseFromPath,避免真实读 .uproject 文件。
vi.mock('@detection/uprojectScanner', () => ({
  UprojectScanner: vi.fn(() => ({ parseFromPath: mockParseFromPath })),
}));

// 拦截 index.ts 里 `import { readBuildVersion } from './workspaceFolders'`,
// 用 mock 控制 Build.version 解析结果。
vi.mock('@detection/workspaceFolders', () => ({
  readBuildVersion: mockReadBuildVersion,
}));

let tmpDir: string;

const mockLoggerError = vi.fn();
const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: mockLoggerError,
  debug: vi.fn(),
  show: vi.fn(),
  setLevel: vi.fn(),
  dispose: vi.fn(),
} as unknown as Logger;

/** 最小 ExtensionContext 假体:仅 activateDetection 用到的 workspaceState */
function makeContext(): vscode.ExtensionContext {
  return {
    workspaceState: { get: vi.fn(() => ({})), update: vi.fn() },
  } as unknown as vscode.ExtensionContext;
}

/** 用 defineProperty 覆盖 setup.ts mock 的 workspaceFile(setup 默认 undefined) */
function setWorkspaceFile(wsPath: string): void {
  Object.defineProperty(vscode.workspace, 'workspaceFile', {
    value: vscode.Uri.file(wsPath),
    configurable: true,
  });
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'detection-index-test-'));
  vi.clearAllMocks();
  mockParseFromPath.mockResolvedValue(null);
  mockReadBuildVersion.mockResolvedValue(null);
  Object.defineProperty(vscode.workspace, 'workspaceFile', {
    value: undefined,
    configurable: true,
  });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('activateDetection —— F1-3 .code-workspace JSONC 解析', () => {
  it('含注释/尾逗号的 .code-workspace 能解析出 folders(JSONC 场景)', async () => {
    // 引擎目录真实存在,让 role 识别与绝对路径有意义
    const engineDir = path.join(tmpDir, 'UE5Root');
    await fs.mkdir(engineDir, { recursive: true });

    const wsPath = path.join(tmpDir, 'XianDreamwalking.code-workspace');
    // JSONC 文本:注释 + 尾逗号,旧 JSON.parse 在此会抛错导致检测整体降级
    const jsonc = [
      '{',
      '  // 项目根文件夹',
      '  "folders": [',
      '    { "name": "XianDreamwalking", "path": ".", },',
      '    { "name": "UE5", "path": "UE5Root", },',
      '  ],',
      '}',
    ].join('\n');
    await fs.writeFile(wsPath, jsonc, 'utf-8');

    const fakeProject: ProjectInfo = {
      path: path.join(tmpDir, 'XianDreamwalking.uproject'),
      name: 'XianDreamwalking',
      engineAssociation: '5.8',
      modules: [],
      raw: {},
    };
    mockParseFromPath.mockResolvedValue(fakeProject);
    mockReadBuildVersion.mockResolvedValue('5.8.0');
    setWorkspaceFile(wsPath);

    const handles = activateDetection(makeContext(), {} as Config, logger);
    const result = await handles.ready;

    expect(result.workspaceFile).toBe(wsPath);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]?.name).toBe('XianDreamwalking');
    expect(result.engines).toHaveLength(1);
    expect(result.engines[0]?.version).toBe('5.8.0');
    expect(result.workspaceFolders).toHaveLength(2);
    expect(result.projectFolder?.role).toBe('project');
    expect(result.engineFolder?.role).toBe('engine');
  });

  it('folders 含 null 条目不崩,产出空 name/path(W20 空值守卫)', async () => {
    const wsPath = path.join(tmpDir, 'nulls.code-workspace');
    // null 条目在旧代码 `f.name` 处抛 TypeError → catch-all 全空
    const jsonc = [
      '{',
      '  "folders": [',
      '    null,',
      '    { "name": "Proj", "path": "." },',
      '    null,',
      '  ],',
      '}',
    ].join('\n');
    await fs.writeFile(wsPath, jsonc, 'utf-8');
    setWorkspaceFile(wsPath);

    const handles = activateDetection(makeContext(), {} as Config, logger);
    const result = await handles.ready;

    expect(result.workspaceFolders).toHaveLength(3);
    // path.resolve(workspaceRoot, '') 归一化后等于 workspaceRoot
    expect(result.workspaceFolders[0]).toEqual({
      name: '',
      path: '',
      role: 'unknown',
      absPath: tmpDir,
    });
    expect(result.workspaceFolders[2]).toEqual({
      name: '',
      path: '',
      role: 'unknown',
      absPath: tmpDir,
    });
    expect(result.workspaceFolders[1]?.name).toBe('Proj');
    expect(result.projectFolder?.role).toBe('project');
  });

  it('Build.version 缺失时引擎不 push,engines = [](W21/F2-13 修复)', async () => {
    // 引擎目录真实存在,但 Engine/Build/Build.version 不存在(即缺失)
    const engineDir = path.join(tmpDir, 'UE5Empty');
    await fs.mkdir(engineDir, { recursive: true });

    const wsPath = path.join(tmpDir, 'no-buildversion.code-workspace');
    await fs.writeFile(
      wsPath,
      JSON.stringify({
        folders: [{ name: 'UE5', path: 'UE5Empty' }],
      }),
      'utf-8',
    );
    mockReadBuildVersion.mockResolvedValue(null);
    setWorkspaceFile(wsPath);

    const handles = activateDetection(makeContext(), {} as Config, logger);
    const result = await handles.ready;

    // 修复后:Build.version 读不到 → 不 push 引擎(空数组),并 log error
    expect(result.engines).toHaveLength(0);
    expect(mockLoggerError).toHaveBeenCalled();
  });

  it('JSON5 都解析不了的语法错误 → resolve 全空且 logger.error 含具体信息', async () => {
    const wsPath = path.join(tmpDir, 'broken.code-workspace');
    // 连 JSON5 都解析不了:数组中途截断(JSON5 错误消息含行号列号)
    await fs.writeFile(wsPath, '{ "folders": [ { "name": "A", } ', 'utf-8');
    setWorkspaceFile(wsPath);

    const handles = activateDetection(makeContext(), {} as Config, logger);
    const result = await handles.ready;

    expect(result.workspaceFile).toBeUndefined();
    expect(result.workspaceFolders).toEqual([]);
    expect(result.projects).toEqual([]);
    expect(mockLoggerError).toHaveBeenCalled();
    const msg = mockLoggerError.mock.calls.flat().join(' ');
    expect(msg).toContain('failed to parse');
    expect(msg).toContain(wsPath);
  });
});
