/**
 * status.test.ts —— 状态模型与日志行为 单元测试
 *
 * 测试策略：
 * - buildStatus 为纯函数，不依赖 I/O，覆盖所有字段
 * - 验证状态可 JSON 序列化（无函数、无 class 实例）
 * - 验证 lastKnownProblem 可选字段
 * - 验证 CLI 日志写入配置的日志文件或 stderr，绝不写入 stdout
 * - 验证日志文件不可写时回退到 stderr
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildStatus, type ClangdProxyStatus, type StatusDependencies } from '@clangd/proxy/status';
import { runProxy, type CliIo } from '@clangd/proxy/cli';
import { EventEmitter } from 'node:events';
import { mkdtempSync, unlinkSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

// ===========================================================================
// buildStatus —— 纯函数状态构建
// ===========================================================================

describe('buildStatus — 状态构建', () => {
  const defaultDeps: StatusDependencies = {
    enabled: false,
    launcherPath: '/path/to/launcher',
    realClangdPath: undefined,
    keepaliveMax: 20,
    keepaliveTtlSec: 900,
    localizationEnabled: false,
    localizationMode: 'append',
    localizationTargets: ['diagnostics', 'codeActions', 'hover'],
    logPath: undefined,
    hasBackup: false,
  };

  // ─── 完整字段 ───────────────────────────────────────────────

  it('构建完整状态包含所有必填字段', () => {
    const status = buildStatus(defaultDeps);

    expect(status.enabled).toBe(false);
    expect(status.launcherPath).toBe('/path/to/launcher');
    expect(status.realClangdPath).toBeUndefined();
    expect(status.keepaliveMax).toBe(20);
    expect(status.keepaliveTtlSec).toBe(900);
    expect(status.localizationEnabled).toBe(false);
    expect(status.localizationMode).toBe('append');
    expect(status.localizationTargets).toEqual(['diagnostics', 'codeActions', 'hover']);
    expect(status.logPath).toBeUndefined();
    expect(status.backupExists).toBe(false);
    expect(status.lastKnownProblem).toBeUndefined();
  });

  // ─── 启用状态 ───────────────────────────────────────────────

  it('启用时 enabled 为 true', () => {
    const status = buildStatus({ ...defaultDeps, enabled: true });
    expect(status.enabled).toBe(true);
  });

  // ─── 真实 clangd 路径 ───────────────────────────────────────

  it('设置真实 clangd 路径时正确反映', () => {
    const status = buildStatus({ ...defaultDeps, realClangdPath: '/usr/bin/clangd' });
    expect(status.realClangdPath).toBe('/usr/bin/clangd');
  });

  // ─── 日志路径 ───────────────────────────────────────────────

  it('设置日志路径时正确反映', () => {
    const status = buildStatus({ ...defaultDeps, logPath: '/tmp/proxy.log' });
    expect(status.logPath).toBe('/tmp/proxy.log');
  });

  // ─── 备份存在 ───────────────────────────────────────────────

  it('备份存在时 backupExists 为 true', () => {
    const status = buildStatus({ ...defaultDeps, hasBackup: true });
    expect(status.backupExists).toBe(true);
  });

  // ─── lastKnownProblem ───────────────────────────────────────

  it('设置 lastKnownProblem 时正确反映', () => {
    const status = buildStatus({ ...defaultDeps, lastKnownProblem: '日志文件不可写' });
    expect(status.lastKnownProblem).toBe('日志文件不可写');
  });

  // ─── 本地化配置 ─────────────────────────────────────────────

  it('本地化启用时正确反映', () => {
    const status = buildStatus({
      ...defaultDeps,
      localizationEnabled: true,
      localizationMode: 'override',
      localizationTargets: ['diagnostics'],
    });
    expect(status.localizationEnabled).toBe(true);
    expect(status.localizationMode).toBe('override');
    expect(status.localizationTargets).toEqual(['diagnostics']);
  });

  // ─── JSON 可序列化 ──────────────────────────────────────────

  it('状态可 JSON 序列化（无函数、无 class 实例）', () => {
    const status = buildStatus({
      ...defaultDeps,
      enabled: true,
      realClangdPath: '/usr/bin/clangd',
      logPath: '/tmp/proxy.log',
      hasBackup: true,
      lastKnownProblem: '测试问题',
    });

    const json = JSON.stringify(status);
    const parsed = JSON.parse(json) as ClangdProxyStatus;

    expect(parsed.enabled).toBe(true);
    expect(parsed.launcherPath).toBe('/path/to/launcher');
    expect(parsed.realClangdPath).toBe('/usr/bin/clangd');
    expect(parsed.keepaliveMax).toBe(20);
    expect(parsed.keepaliveTtlSec).toBe(900);
    expect(parsed.localizationEnabled).toBe(false);
    expect(parsed.localizationMode).toBe('append');
    expect(parsed.localizationTargets).toEqual(['diagnostics', 'codeActions', 'hover']);
    expect(parsed.logPath).toBe('/tmp/proxy.log');
    expect(parsed.backupExists).toBe(true);
    expect(parsed.lastKnownProblem).toBe('测试问题');
  });

  // ─── 不可变 ─────────────────────────────────────────────────

  it('buildStatus 不修改输入对象', () => {
    const deps: StatusDependencies = { ...defaultDeps };
    const depsSnapshot = { ...deps, localizationTargets: [...deps.localizationTargets] };

    buildStatus(deps);

    expect(deps.enabled).toBe(depsSnapshot.enabled);
    expect(deps.launcherPath).toBe(depsSnapshot.launcherPath);
    expect(deps.localizationTargets).toEqual(depsSnapshot.localizationTargets);
  });
});

// ===========================================================================
// CLI 日志行为 —— 日志写入日志文件或 stderr，绝不写入 stdout
// ===========================================================================

describe('CLI 日志行为 — 日志写入文件或 stderr，绝不写入 stdout', () => {
  let tmpDir: string;
  let logFilePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'proxy-test-'));
    logFilePath = join(tmpDir, 'proxy.log');
  });

  afterEach(() => {
    try { unlinkSync(logFilePath); } catch { /* ignore */ }
    try { unlinkSync(join(tmpDir, 'proxy-unwritable.log')); } catch { /* ignore */ }
    try { unlinkSync(join(tmpDir, 'proxy-readonly.log')); } catch { /* ignore */ }
  });

  // ─── FakeChild ──────────────────────────────────────────────

  class FakeChild extends EventEmitter {
    public stdin = {
      writable: true,
      write: ((..._args: unknown[]) => true) as (...args: unknown[]) => boolean,
      end: (() => {}) as (...args: unknown[]) => void,
      on: () => this,
      once: () => this,
      emit: () => false,
    } as unknown as ChildProcessWithoutNullStreams['stdin'];
    public stdout = new EventEmitter() as ChildProcessWithoutNullStreams['stdout'];
    public stderr = new EventEmitter() as ChildProcessWithoutNullStreams['stderr'];
    public pid: number | undefined = 42;
    public killed = false;
    public exitCode: number | null = null;
    public signalCode: NodeJS.Signals | null = null;
    public stdinWriteCalls: Buffer[] = [];
    public stdinEndCalls = 0;

    kill(_signal?: NodeJS.Signals | number): boolean {
      this.killed = true;
      return true;
    }
  }

  function createFakeSpawn(fakeChild: FakeChild): typeof import('node:child_process').spawn {
    return ((_cmd: string, _args: string[], _options?: unknown) => {
      fakeChild.stdin.write = ((chunk: Buffer) => {
        fakeChild.stdinWriteCalls.push(Buffer.from(chunk));
        return true;
      }) as ChildProcessWithoutNullStreams['stdin']['write'];
      fakeChild.stdin.end = (() => {
        fakeChild.stdinEndCalls++;
      }) as unknown as ChildProcessWithoutNullStreams['stdin']['end'];
      return fakeChild as unknown as ChildProcessWithoutNullStreams;
    }) as unknown as typeof import('node:child_process').spawn;
  }

  // ─── 日志写入日志文件 ───────────────────────────────────────

  it('指定 --log-path 时日志写入文件而非 stderr', () => {
    const fakeChild = new FakeChild();
    const fakeSpawn = createFakeSpawn(fakeChild);
    const stderrLines: string[] = [];
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: () => { /* noop */ },
    };

    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
        '--log-path', logFilePath,
      ],
      io,
      fakeSpawn,
    );

    // 验证日志文件已创建且包含启动消息
    const logContent = readFileSync(logFilePath, 'utf-8');
    expect(logContent).toContain('[clangd-proxy] started');
    // stderr 不应包含日志消息（仅可能包含文件打开确认）
    expect(stderrLines.some((l) => l.includes('[clangd-proxy]'))).toBe(false);
  });

  // ─── 无日志路径时写入 stderr ────────────────────────────────

  it('未指定 --log-path 时日志写入 stderr', () => {
    const fakeChild = new FakeChild();
    const fakeSpawn = createFakeSpawn(fakeChild);
    const stderrLines: string[] = [];
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: () => { /* noop */ },
    };

    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
      ],
      io,
      fakeSpawn,
    );

    expect(stderrLines.some((l) => l.includes('[clangd-proxy]'))).toBe(true);
  });

  // ─── 日志不写入 stdout ──────────────────────────────────────

  it('日志绝不写入 stdout', () => {
    const fakeChild = new FakeChild();
    const fakeSpawn = createFakeSpawn(fakeChild);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrLines: string[] = [];
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: () => { /* noop */ },
    };

    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
        '--log-path', logFilePath,
      ],
      io,
      fakeSpawn,
    );

    expect(stdoutWrite).not.toHaveBeenCalled();
    stdoutWrite.mockRestore();
  });

  // ─── 日志文件不可写时回退到 stderr ──────────────────────────

  it('日志文件不可写时回退到 stderr 且不破坏 stdout', () => {
    const fakeChild = new FakeChild();
    const fakeSpawn = createFakeSpawn(fakeChild);
    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrLines: string[] = [];
    const io: CliIo = {
      stderrWrite: (msg: string) => { stderrLines.push(msg); },
      exit: () => { /* noop */ },
    };

    // 使用一个不可写的路径（如根目录下的文件）
    runProxy(
      [
        'node', 'proxy.js',
        '--real-clangd', '/fake/clangd',
        '--log-path', '/invalid-path/proxy.log',
      ],
      io,
      fakeSpawn,
    );

    // 应回退到 stderr
    expect(stderrLines.some((l) => l.includes('[clangd-proxy]'))).toBe(true);
    // stdout 不应被写入
    expect(stdoutWrite).not.toHaveBeenCalled();
    stdoutWrite.mockRestore();
  });
});
