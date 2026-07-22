/**
 * uhtGeneration.test.ts —— `runUhtCodegen` 单元测试
 *
 * 覆盖 4 个 QA 场景（per plan §Todo 1）：
 *   (a) happy path — mocked spawn 返回 code 0 + 写 3 个 stub .generated.h，
 *                    断言 generatedHeaderCount === 3 且 ran === true
 *   (b) UBT exit code 1 但已有 .generated.h 文件，断言 ran === true 且 exitCode === 1
 *   (c) AbortSignal 中途 abort，断言 child 被 kill 且不抛错
 *   (d) 无 dotnet 路径时 throw informative error
 *
 * Mock 策略：
 *   - `runUhtCodegen` 暴露 `spawnFn` 内部测试钩子，直接注入 FakeChild EventEmitter
 *     —— 与 `test/unit/clangd/proxy/processBridge.test.ts` 的 spawnFn 注入风格一致，
 *        避免 vi.mock('node:child_process') 在 vitest 中对 node: 前缀模块的兼容性陷阱
 *   - 用真实 fs.mkdtemp 创建临时项目（`Intermediate/Build/Win64/Test/Inc/.../UHT/*.generated.h`）
 *     让 `collectIntermediateUhtDirs` 真正能找到文件
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { runUhtCodegen, type UhtResult, type MinimalLogger } from '@clangd/uhtGeneration';

// ---------------------------------------------------------------------------
// FakeChild —— 模拟 ChildProcessWithoutNullStreams 的最小可用子集
// ---------------------------------------------------------------------------

/**
 * FakeChild 是 ChildProcessWithoutNullStreams 的最小可用子集：stdout/stderr 是
 * EventEmitter（实现 on('data') 监听），kill() 记录所有信号调用便于断言。
 *
 * 不 implements ChildProcess：实现完整 ChildProcess 接口需要 [Symbol.dispose] /
 * disconnect / send 等非可选方法，写起来烦。我们在 spawnFn 里直接 cast 到
 * ChildProcessWithoutNullStreams，绕过完整性检查。
 */
class FakeChild extends EventEmitter {
  public pid = 12345;
  public killed = false;
  public killCalls: Array<NodeJS.Signals | undefined> = [];
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public stdin = new EventEmitter();

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    // 把 number 数字 signal（用户传 0 / -1 之类）转成 undefined；FakeChild
    // 测试只关心是否被调用，不在意具体信号名。
    this.killCalls.push(typeof signal === 'number' ? undefined : signal);
    return true;
  }
}

/**
 * 构造一个 fake spawnFn：返回传入的 FakeChild 实例。
 *
 * 重要：`exitCode` 在 spawnFn 调用**之后**通过 setImmediate 派发 emit。
 * 这是修复 [bug 2026-07-20] 的关键:先前实现把 `setImmediate(emit)`
 * 安排在 `runUhtCodegen` 调用**之前**,fs.readdir 的 microtask 让
 * setImmediate 抢先在 `child.on('close', ...)` 注册前触发,emit 丢失,
 * Promise 永久 pending。
 *
 * 现在在 spawnFn 内部 setImmediate,保证:
 *   1. spawnFn 同步返回 FakeChild
 *   2. runUhtCodegen 内部同步注册 listener
 *   3. 微任务队列空后,setImmediate 在 check 阶段 emit
 *   4. listener 已注册,emit 生效
 */
function makeFakeSpawn(
  child: FakeChild,
  exitCode: number | null = 0,
  closeSignal: NodeJS.Signals | null = null,
  emitDelay = 0,
): typeof import('node:child_process').spawn {
  return ((_cmd: string, _args: string[], _options?: unknown) => {
    // 重置状态以便复用
    child.killed = false;
    child.killCalls = [];
    child.stdout.removeAllListeners();
    child.stderr.removeAllListeners();
    // 在 listener 注册后才 emit —— spawnFn 返回后,runUhtCodegen 同步注册
    // child.on('close', ...),然后 await 挂起;微任务空后 setImmediate 触发。
    if (emitDelay > 0) {
      setTimeout(() => child.emit('close', exitCode, closeSignal), emitDelay);
    } else {
      setImmediate(() => child.emit('close', exitCode, closeSignal));
    }
    return child as unknown as ChildProcessWithoutNullStreams;
  }) as unknown as typeof import('node:child_process').spawn;
}

// ---------------------------------------------------------------------------
// 测试 fixture 辅助
// ---------------------------------------------------------------------------

const silentLogger: MinimalLogger = {
  info: () => {
    /* silent */
  },
  warn: () => {
    /* silent */
  },
  error: () => {
    /* silent */
  },
};

/**
 * 创建临时项目骨架：
 *   <tmp>/Engine/Engine/Binaries/ThirdParty/DotNet/<v>/win-x64/dotnet.exe
 *   <tmp>/Project/MyProject.uproject
 * 返回 tmpDir / engineRoot / projectFile。
 */
async function setupProjectSkeleton(): Promise<{
  tmpDir: string;
  engineRoot: string;
  projectDir: string;
  projectFile: string;
}> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uht-test-'));
  const engineRoot = path.join(tmpDir, 'Engine');
  const projectDir = path.join(tmpDir, 'Project');

  await fs.mkdir(projectDir, { recursive: true });
  const projectFile = path.join(projectDir, 'MyProject.uproject');
  await fs.writeFile(projectFile, '{}', 'utf-8');

  // 创建虚假的 dotnet.exe，让 resolveDotnet 找到它（Case (d) 除外，那 case 不创建）
  const dotnetDir = path.join(
    engineRoot,
    'Engine',
    'Binaries',
    'ThirdParty',
    'DotNet',
    '6.0.0',
    'win-x64',
  );
  await fs.mkdir(dotnetDir, { recursive: true });
  await fs.writeFile(path.join(dotnetDir, 'dotnet.exe'), '', 'utf-8');

  return { tmpDir, engineRoot, projectDir, projectFile };
}

/**
 * 在 projectDir 下创建 `Intermediate/Build/Win64/Test/Inc/MyModule/UHT/*.generated.h`。
 * 返回创建的文件绝对路径列表。
 */
async function writeStubGeneratedHeaders(
  projectDir: string,
  files: ReadonlyArray<string>,
): Promise<string[]> {
  const uhtDir = path.join(
    projectDir,
    'Intermediate',
    'Build',
    'Win64',
    'Test',
    'Inc',
    'MyModule',
    'UHT',
  );
  await fs.mkdir(uhtDir, { recursive: true });
  const written: string[] = [];
  for (const name of files) {
    const full = path.join(uhtDir, name);
    await fs.writeFile(full, `// stub for ${name}\n`, 'utf-8');
    written.push(full);
  }
  return written;
}

/**
 * case (a)(b) 由 `makeFakeSpawn(child, exitCode)` 在内部自动 emit。
 * case (c) 通过 `makeFakeSpawn(child, null, null, /* emitDelay *\/ 150)` 延迟 emit，
 * 让 abort 先触发后子进程才收到 close —— 不再需要外部工具函数。
 */

// ---------------------------------------------------------------------------
// 测试套件
// ---------------------------------------------------------------------------

describe('runUhtCodegen', () => {
  let tmpDirs: string[] = [];
  let fakeChild: FakeChild;
  let spawnFn: typeof import('node:child_process').spawn;

  beforeEach(() => {
    fakeChild = new FakeChild();
    spawnFn = makeFakeSpawn(fakeChild);
    tmpDirs = [];
  });

  afterEach(async () => {
    await Promise.all(
      tmpDirs.map((d) =>
        fs.rm(d, { recursive: true, force: true }).catch(() => {
          /* ignore */
        }),
      ),
    );
  });

  function trackTmp(d: string): void {
    tmpDirs.push(d);
  }

  // ─── (a) happy path ─────────────────────────────────────────
  it('(a) happy path: code 0 + 3 stub .generated.h → generatedHeaderCount === 3 && ran === true', async () => {
    const { tmpDir, engineRoot, projectDir, projectFile } = await setupProjectSkeleton();
    trackTmp(tmpDir);
    await writeStubGeneratedHeaders(projectDir, [
      'A.generated.h',
      'B.generated.h',
      'C.generated.h',
    ]);

    // spawnFn 会在 listener 注册后自动 emit(0) —— 见 makeFakeSpawn 注释
    const result: UhtResult = await runUhtCodegen({
      project: projectFile,
      engineRoot,
      buildTargetName: 'MyProjectEditor',
      buildType: 'Development',
      logger: silentLogger,
      spawnFn,
    });

    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.generatedHeaderCount).toBe(3);
    expect(result.generatedHeaderPaths).toHaveLength(3);
    for (const p of result.generatedHeaderPaths) {
      expect(p.endsWith('.generated.h')).toBe(true);
    }
    expect(result.errorMessage).toBeUndefined();
  });

  // ─── (b) UBT exit code 1 + 部分产物已存在 ─────────────────
  it('(b) UBT exit code 1 but already has .generated.h files → ran === true && exitCode === 1', async () => {
    const { tmpDir, engineRoot, projectDir, projectFile } = await setupProjectSkeleton();
    trackTmp(tmpDir);
    // 关键：产物先于 close 存在 → UBT 退出非 0 时仍认为 ran
    await writeStubGeneratedHeaders(projectDir, ['P1.generated.h', 'P2.generated.h']);

    // 重新构造 spawnFn 让它 emit exit code 1
    spawnFn = makeFakeSpawn(fakeChild, 1);

    const result = await runUhtCodegen({
      project: projectFile,
      engineRoot,
      buildTargetName: 'MyProjectEditor',
      buildType: 'Development',
      logger: silentLogger,
      spawnFn,
    });

    expect(result.ran).toBe(true);
    expect(result.exitCode).toBe(1);
    expect(result.generatedHeaderCount).toBe(2);
    expect(result.generatedHeaderPaths).toHaveLength(2);
    // 退出非 0 不算 error；只有 spawn 失败/被 abort 才设 errorMessage
    expect(result.errorMessage).toBeUndefined();
  });

  // ─── (c) AbortSignal 中途 abort ────────────────────────────
  it('(c) AbortSignal mid-abort kills child and does not throw', async () => {
    const { tmpDir, engineRoot, projectFile } = await setupProjectSkeleton();
    trackTmp(tmpDir);

    const controller = new AbortController();

    // 不让 spawnFn 自动 emit —— 用 emitDelay 推后,先让 abort 触发
    spawnFn = makeFakeSpawn(fakeChild, null, null, /* emitDelay */ 150);

    // 在 spawn 完成后调度 abort（确保 runUhtCodegen 内部已注册 listener）
    setImmediate(() => {
      controller.abort();
    });

    const result = await runUhtCodegen({
      project: projectFile,
      engineRoot,
      buildTargetName: 'MyProjectEditor',
      buildType: 'Development',
      logger: silentLogger,
      signal: controller.signal,
      // 给超时留大一点的窗口，避免 timeout 抢先 abort
      timeoutMs: 60_000,
      spawnFn,
    });

    // 不抛错（resolves with ran:true）
    expect(result.ran).toBe(true);
    expect(result.errorMessage).toBe('UBT aborted by signal or timeout');
    expect(fakeChild.killed).toBe(true);
    // 至少调用过一次 kill（要么 SIGTERM，要么升级到 SIGKILL）
    expect(fakeChild.killCalls.length).toBeGreaterThanOrEqual(1);
  });

  // ─── (d) 找不到 dotnet 时 throw informative error ─────────
  it('(d) no bundled dotnet throws informative error', async () => {
    // 故意建空 engineRoot，没有 DotNet 目录
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'uht-test-'));
    trackTmp(tmpDir);
    const engineRoot = path.join(tmpDir, 'EmptyEngine');
    await fs.mkdir(engineRoot, { recursive: true });
    const projectFile = path.join(tmpDir, 'Project', 'P.uproject');
    await fs.mkdir(path.dirname(projectFile), { recursive: true });
    await fs.writeFile(projectFile, '{}', 'utf-8');

    await expect(
      runUhtCodegen({
        project: projectFile,
        engineRoot,
        buildTargetName: 'MyProjectEditor',
        buildType: 'Development',
        logger: silentLogger,
        spawnFn,
      }),
    ).rejects.toThrow(/bundled dotnet not found under .*DotNet/);

    // 找不到 dotnet 时根本不该 spawn
    expect(fakeChild.killCalls).toHaveLength(0);
  });
});
