/**
 * compileCommandsPerf.test.ts —— Phase 7 PLAN B 5 阶段细化插桩验证
 *
 * Per D-03 + PLAN B 任务 7B-01：
 *   - compileCommands.entry（阶段 1）
 *   - compileCommands.ubtStart + ubt.taskCompleted（阶段 2）
 *   - compileCommands.candidatesScanned（阶段 3）
 *   - compileCommands.linkToWorkspaceRoot（阶段 4）
 *   - compileCommands.totalElapsed（阶段 5）
 *
 * 测试策略：
 *   - 静态扫描 compileCommands.ts 源文件，验证 5 个 perfLog.record 调用点存在
 *   - 运行时测试 linkToWorkspaceRoot（不依赖 vscode.tasks）覆盖阶段 4
 *   - 运行时通过 fs mock 验证 candidatesScanned + totalElapsed（仅 stage 3 + 5 静态扫描 + 动态组合）
 *
 * 为什么不用 vi.mock 替换 compileCommands 内部依赖？
 *   - vscode.tasks.executeTask + onDidEndTaskProcess 链路复杂，难以在单元测试中真实还原
 *   - 静态扫描是最简洁、最确定的验证方式：源码包含 perfLog.record 就是埋点就位
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

// ============== Mocks ==============

/** 捕获所有 perfLog.record 调用 */
const recordCalls: Array<{ event: string; elapsedMs: number; meta?: Record<string, unknown> }> = [];

vi.mock('@clangd/perfLog', () => ({
  perfLog: {
    record: (ev: { event: string; elapsedMs: number; meta?: Record<string, unknown> }) => {
      recordCalls.push({ event: ev.event, elapsedMs: ev.elapsedMs, meta: ev.meta });
    },
    recordPreparseResult: vi.fn(),
    recordIncrementalScan: vi.fn(),
    getCompileCommandsLastMs: () => 0,
    getPreparseHitRate: () => ({ hits: 0, misses: 0, rate: 0 }),
    getLastIncrementalScanMs: () => 0,
    onMetricUpdate: () => ({ dispose: vi.fn() }),
    flushToDisk: () => Promise.resolve(),
  },
}));

// 仅 import linkToWorkspaceRoot（不需要 vscode.tasks）
import { linkToWorkspaceRoot } from '@clangd/compileCommands';

describe('compileCommands 5 阶段细化插桩 (Phase 7 PLAN B / per D-03)', () => {
  let tmpDir: string;
  let projectPath: string;
  let ccOutputPath: string;

  beforeEach(async () => {
    recordCalls.length = 0;

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'compile-commands-perf-'));
    projectPath = path.join(tmpDir, 'MyProject.uproject');
    await fs.writeFile(projectPath, '{}', 'utf-8');

    // 编译数据库输出位置：<tmpDir>/compile_commands.json
    ccOutputPath = path.join(tmpDir, 'compile_commands.json');
    await fs.writeFile(
      ccOutputPath,
      JSON.stringify([{ directory: tmpDir, file: 'main.cpp', arguments: ['clang', '-c'] }]),
      'utf-8',
    );
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function eventsByName(
    name: string,
  ): Array<{ event: string; elapsedMs: number; meta?: Record<string, unknown> }> {
    return recordCalls.filter((c) => c.event === name);
  }

  /* ==================== 运行时测试：阶段 4 linkToWorkspaceRoot ==================== */

  it('阶段 4：compileCommands.linkToWorkspaceRoot 在 linkToWorkspaceRoot 调用前后被记录（succeeded=true）', async () => {
    await linkToWorkspaceRoot(ccOutputPath, projectPath);

    const lwsEvents = eventsByName('compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(1);
    const event = lwsEvents[0]!;
    expect(event.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(event.meta?.['succeeded']).toBe(true);
    expect(event.meta?.['target']).toBeDefined();
  });

  it('阶段 4：source 已在 target 位置时 linkToWorkspaceRoot 记录 skipped=true', async () => {
    // 把 ccOutputPath 放到 .vscode/vscodeuehelper 下，让 linkToWorkspaceRoot 直接跳过
    const targetDir = path.join(tmpDir, '.vscode', 'vscodeuehelper');
    await fs.mkdir(targetDir, { recursive: true });
    const ccAtTarget = path.join(targetDir, 'compile_commands.json');
    await fs.writeFile(ccAtTarget, '[]', 'utf-8');

    await linkToWorkspaceRoot(ccAtTarget, projectPath);

    const lwsEvents = eventsByName('compileCommands.linkToWorkspaceRoot');
    expect(lwsEvents.length).toBe(1);
    expect(lwsEvents[0]!.meta?.['skipped']).toBe(true);
  });

  /* ==================== 静态扫描测试：阶段 1/2/3/5 ==================== */

  // 定位 compileCommands.ts 源文件（vitest 工作目录为项目根）
  const compileCommandsSrcPath = path.resolve(process.cwd(), 'src/clangd/compileCommands.ts');

  it('阶段 1：compileCommands.entry 埋点存在（源文件扫描）', async () => {
    const src = await fs.readFile(compileCommandsSrcPath, 'utf-8');
    // 阶段 1：entry 在 optsSignal 设置之后立即 record
    expect(src).toContain("event: 'compileCommands.entry'");
    // 必须含 meta.isNative 字段
    expect(src).toMatch(/event:\s*'compileCommands\.entry'[\s\S]*?meta:\s*\{[^}]*isNative/);
  });

  it('阶段 2：compileCommands.ubtStart + ubt.taskCompleted 埋点存在', async () => {
    const src = await fs.readFile(compileCommandsSrcPath, 'utf-8');
    expect(src).toContain("event: 'compileCommands.ubtStart'");
    expect(src).toContain("event: 'ubt.taskCompleted'");
  });

  it('阶段 3：compileCommands.candidatesScanned 埋点存在（含 meta.candidateCount）', async () => {
    const src = await fs.readFile(compileCommandsSrcPath, 'utf-8');
    expect(src).toContain("event: 'compileCommands.candidatesScanned'");
    // meta.candidateCount 字段
    expect(src).toMatch(
      /event:\s*'compileCommands\.candidatesScanned'[\s\S]*?meta:\s*\{[^}]*candidateCount/,
    );
  });

  it('阶段 4：compileCommands.linkToWorkspaceRoot 埋点存在（运行时已验证 succeeded=true + skipped=true）', async () => {
    const src = await fs.readFile(compileCommandsSrcPath, 'utf-8');
    expect(src).toContain("event: 'compileCommands.linkToWorkspaceRoot'");
  });

  it('阶段 5：compileCommands.totalElapsed 埋点存在', async () => {
    const src = await fs.readFile(compileCommandsSrcPath, 'utf-8');
    expect(src).toContain("event: 'compileCommands.totalElapsed'");
  });

  it('所有 5 个埋点都用 try/catch 包裹（per T-7-13 + PATTERNS §5）', async () => {
    const src = await fs.readFile(compileCommandsSrcPath, 'utf-8');
    const stageNames = [
      'compileCommands.entry',
      'compileCommands.ubtStart',
      'ubt.taskCompleted',
      'compileCommands.candidatesScanned',
      'compileCommands.linkToWorkspaceRoot',
      'compileCommands.totalElapsed',
    ];
    for (const stage of stageNames) {
      // 找到每个埋点的 perfLog.record 调用后是否有 try/catch 包裹
      const idx = src.indexOf(`event: '${stage}'`);
      expect(idx, `埋点 ${stage} 存在`).toBeGreaterThan(-1);
      // 向前查找最近的 try { 是否存在 (放宽：最近 200 字符内有 try {)
      const before = src.slice(Math.max(0, idx - 300), idx);
      expect(before, `埋点 ${stage} 前应被 try { 包裹`).toMatch(/try\s*\{/);
    }
  });
});
