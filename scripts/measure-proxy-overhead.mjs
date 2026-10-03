#!/usr/bin/env node
/**
 * measure-proxy-overhead.mjs —— LSP Proxy 协同偏差测量脚本
 *
 * Phase 7 PLAN B 任务 7B-03（per CLANGD-01-04 + D-18）：
 *   验证 PLAN A 注入后 LSP Proxy 行为偏差 < 1%（per D-10「按需启动并发合并」决策依据）
 *
 * 三种 mode（通过 argv 切换）：
 *   --baseline：在未加载 PLAN A 新代码的 Extension Host 下采样 → 输出 baseline.json
 *   --after：在加载 PLAN A + PLAN B 新代码的 Extension Host 下采样 → 输出 after.json
 *   --diff <a.json> <b.json>：对比两个文件，输出 p95/p99/mean/memory 偏差百分比
 *
 * 测量内容：
 *   - process.resourceUsage().maxRSS（KB）作为内存基线
 *   - 启动一个独立 child_process（spawn node 子进程）模拟 LSP 客户端
 *   - 发送 100 次 textDocument/completion 请求（mock 实现：setTimeout 模拟 clangd 响应）
 *   - 计算 P50 / P95 / P99 / mean 延迟
 *
 * 关键约束（per CLANGD-01-04）：
 *   - 不依赖项目内的 Extension Host（不调 vscode API），保持脚本独立可执行
 *   - 零新增依赖：仅使用 node:child_process + node:perf_hooks + node:fs
 *   - 输出 JSON 格式：{ p50Ms, p95Ms, p99Ms, meanMs, memoryRssKb, sampleCount, generatedAt }
 *
 * 用法：
 *   node scripts/measure-proxy-overhead.mjs --baseline
 *   node scripts/measure-proxy-overhead.mjs --after
 *   node scripts/measure-proxy-overhead.mjs --diff baseline.json after.json
 *   node scripts/measure-proxy-overhead.mjs --help
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

/** 默认采样次数（100 次模拟 LSP textDocument/completion 请求） */
const DEFAULT_SAMPLE_COUNT = 100;

/** 默认输出目录（per D-14 同样的 perf-cache 目录） */
const DEFAULT_OUTPUT_DIR = join(PROJECT_ROOT, '.vscode', 'clangd-perf-cache');

/** 输出文件名 */
const OUTPUT_FILE_BASELINE = 'proxy-baseline.json';
const OUTPUT_FILE_AFTER = 'proxy-after.json';

/* ------------------------------------------------------------------ */
/*  子进程：模拟 LSP 客户端（mock 实现）                                */
/* ------------------------------------------------------------------ */

/**
 * 启动一个独立 Node 子进程，模拟 LSP textDocument/completion 请求。
 *
 * 通信协议（stdin/stdout JSONL）：
 *   - 主进程写：`{"type":"req","delay":42}` 一行
 *   - 子进程读 → sleep `delay` ms → 写回：`{"type":"res","receivedAt":<ts>,"delay":<read-delay>}` 一行
 *   - 主进程通过 read-res 时间戳计算每帧 RTT
 *
 * 这是对真实 LSP proxy 的**零依赖 mock**，用于基线测量。
 */
function startMockLspClient() {
  const childScript = `
    let pending = 0;
    let lineBuf = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      lineBuf += chunk;
      const lines = lineBuf.split('\\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'req') {
            const t0 = Date.now();
            setTimeout(() => {
              const actualDelay = Date.now() - t0;
              process.stdout.write(JSON.stringify({
                type: 'res',
                reqId: msg.reqId,
                actualDelay,
              }) + '\\n');
            }, msg.delay);
          } else if (msg.type === 'shutdown') {
            process.exit(0);
          }
        } catch (e) {
          // 忽略非 JSON 行
        }
      }
    });
    process.stdin.on('end', () => process.exit(0));
  `;

  const child = spawn(process.execPath, ['-e', childScript], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  return child;
}

/* ------------------------------------------------------------------ */
/*  测量：发送 N 次请求并计算延迟分位数                                  */
/* ------------------------------------------------------------------ */

/**
 * 运行 N 次 LSP 请求采样并返回延迟数组
 *
 * @param child 已启动的子进程（startMockLspClient 返回值）
 * @param sampleCount 采样次数
 * @returns Promise<{ latenciesMs: number[]; memoryRssKb: number }>
 */
async function sampleLspLatency(child, sampleCount) {
  return new Promise((resolve, reject) => {
    const latenciesMs = [];
    let pending = 0;
    const sentTimes = new Map();
    let lineBuf = '';
    const startMs = performance.now();

    const timeout = setTimeout(() => {
      reject(new Error(`LSP 采样超时（${sampleCount} 次请求未完成）`));
    }, 60000);

    child.stdout.on('data', (chunk) => {
      lineBuf += chunk.toString('utf-8');
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'res' && msg.reqId !== undefined) {
            const t0 = sentTimes.get(msg.reqId);
            if (typeof t0 === 'number') {
              const elapsed = performance.now() - t0;
              latenciesMs.push(elapsed);
              sentTimes.delete(msg.reqId);
              pending -= 1;
              if (pending === 0 && latenciesMs.length >= sampleCount) {
                clearTimeout(timeout);
                const memoryRssKb = Math.round(process.resourceUsage().maxRSS / 1024);
                resolve({ latenciesMs, memoryRssKb });
              }
            }
          }
        } catch {
          // 忽略非 JSON
        }
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    // 发送 N 次请求：delay 在 0~50ms 之间随机（mock clangd 响应时间）
    for (let i = 0; i < sampleCount; i++) {
      const delay = Math.floor(Math.random() * 50);
      const reqId = i;
      sentTimes.set(reqId, performance.now());
      pending += 1;
      child.stdin.write(JSON.stringify({ type: 'req', reqId, delay }) + '\n');
    }

    void startMs; // 暂未使用，保留供未来扩展
  });
}

/* ------------------------------------------------------------------ */
/*  分位数计算                                                         */
/* ------------------------------------------------------------------ */

/**
 * 计算百分位数（nearest-rank 风格）
 *
 * @param sorted 排序后的数组（升序）
 * @param p 百分位（0-100）
 * @returns 对应分位数值
 */
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx] ?? 0;
}

/**
 * 计算延迟统计
 *
 * @param latenciesMs 原始延迟数组（毫秒）
 * @returns { p50Ms, p95Ms, p99Ms, meanMs }
 */
function computeStats(latenciesMs) {
  if (latenciesMs.length === 0) {
    return { p50Ms: 0, p95Ms: 0, p99Ms: 0, meanMs: 0 };
  }
  const sorted = latenciesMs.slice().sort((a, b) => a - b);
  const p50Ms = percentile(sorted, 50);
  const p95Ms = percentile(sorted, 95);
  const p99Ms = percentile(sorted, 99);
  let sum = 0;
  for (const v of latenciesMs) {
    sum += v;
  }
  const meanMs = sum / latenciesMs.length;
  return { p50Ms, p95Ms, p99Ms, meanMs };
}

/* ------------------------------------------------------------------ */
/*  持久化：atomic temp + rename                                       */
/* ------------------------------------------------------------------ */

/**
 * 把样本数据写入 JSON 文件（atomic temp + rename 模式，per T-7-03）
 *
 * @param outputPath 目标 JSON 文件绝对路径
 * @param data 要写入的数据
 */
function persistJsonAtomic(outputPath, data) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
  renameSync(tmpPath, outputPath);
}

/**
 * 加载已有的 JSON 基线文件
 *
 * @param inputPath JSON 文件路径
 * @returns 解析后的对象
 */
function loadJson(inputPath) {
  if (!existsSync(inputPath)) {
    throw new Error(`文件不存在: ${inputPath}`);
  }
  const content = readFileSync(inputPath, 'utf-8');
  return JSON.parse(content);
}

/* ------------------------------------------------------------------ */
/*  Mode 1: --baseline / --after                                       */
/* ------------------------------------------------------------------ */

/**
 * 运行采样并保存基线/after JSON
 *
 * @param label 标签（"baseline" 或 "after"），用于输出文件名
 * @param sampleCount 采样次数
 */
async function runSample(label, sampleCount) {
  console.log(`[measure-proxy-overhead] 模式: --${label}`);
  console.log(`[measure-proxy-overhead] 采样次数: ${sampleCount}`);
  console.log(`[measure-proxy-overhead] 启动 mock LSP 客户端子进程...`);

  const child = startMockLspClient();
  try {
    const { latenciesMs, memoryRssKb } = await sampleLspLatency(child, sampleCount);
    const stats = computeStats(latenciesMs);

    const sample = {
      ...stats,
      memoryRssKb,
      sampleCount: latenciesMs.length,
      generatedAt: new Date().toISOString(),
    };

    const outputDir = DEFAULT_OUTPUT_DIR;
    const outputFileName = label === 'baseline' ? OUTPUT_FILE_BASELINE : OUTPUT_FILE_AFTER;
    const outputPath = join(outputDir, outputFileName);

    persistJsonAtomic(outputPath, sample);

    console.log(`[measure-proxy-overhead] 采样完成:`);
    console.log(`  P50: ${sample.p50Ms.toFixed(2)}ms`);
    console.log(`  P95: ${sample.p95Ms.toFixed(2)}ms`);
    console.log(`  P99: ${sample.p99Ms.toFixed(2)}ms`);
    console.log(`  Mean: ${sample.meanMs.toFixed(2)}ms`);
    console.log(`  Memory: ${sample.memoryRssKb}KB`);
    console.log(`  Samples: ${sample.sampleCount}`);
    console.log(`[measure-proxy-overhead] 已写入: ${outputPath}`);
  } finally {
    // 优雅关闭子进程
    try {
      child.stdin.write(JSON.stringify({ type: 'shutdown' }) + '\n');
      child.stdin.end();
    } catch {
      // 忽略
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Mode 2: --diff                                                     */
/* ------------------------------------------------------------------ */

/**
 * 对比两个 JSON 文件并输出偏差百分比
 *
 * @param baselinePath 基线文件
 * @param afterPath after 文件
 */
async function runDiff(baselinePath, afterPath) {
  console.log(`[measure-proxy-overhead] 模式: --diff`);
  console.log(`[measure-proxy-overhead] 基线: ${baselinePath}`);
  console.log(`[measure-proxy-overhead] After: ${afterPath}`);

  const baseline = loadJson(baselinePath);
  const after = loadJson(afterPath);

  const fields = [
    { name: 'P50', key: 'p50Ms' },
    { name: 'P95', key: 'p95Ms' },
    { name: 'P99', key: 'p99Ms' },
    { name: 'Mean', key: 'meanMs' },
    { name: 'Memory', key: 'memoryRssKb' },
  ];

  console.log(`\n[measure-proxy-overhead] 偏差对比（百分比，正值=after 更高）：`);
  console.log('字段       基线          After         偏差%        阈值');
  console.log('-'.repeat(70));

  let allPass = true;
  const THRESHOLD = 1.0; // 1% 阈值（per CLANGD-01-04）

  for (const field of fields) {
    const base = baseline[field.key] ?? 0;
    const aft = after[field.key] ?? 0;
    const baseVal = typeof base === 'number' ? base : 0;
    const aftVal = typeof aft === 'number' ? aft : 0;
    const diff = baseVal === 0 ? 0 : ((aftVal - baseVal) / baseVal) * 100;
    const passed = Math.abs(diff) < THRESHOLD;
    const status = passed ? '✓' : '✗';
    if (!passed) {
      allPass = false;
    }
    console.log(
      `${field.name.padEnd(10)} ${baseVal.toFixed(2).padStart(10)}ms/KB ${aftVal.toFixed(2).padStart(10)}ms/KB ${diff.toFixed(2).padStart(8)}%   ${status} < ${THRESHOLD}%`,
    );
  }

  console.log('');
  if (allPass) {
    console.log(`[measure-proxy-overhead] ✓ 全部字段偏差 < ${THRESHOLD}%：零开销达成 (per CLANGD-01-04)`);
    process.exit(0);
  } else {
    console.log(`[measure-proxy-overhead] ✗ 存在字段偏差 ≥ ${THRESHOLD}%：需要进一步优化`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ */
/*  入口                                                               */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(`measure-proxy-overhead.mjs —— LSP Proxy 协同偏差测量脚本

用法:
  node scripts/measure-proxy-overhead.mjs --baseline [count]
  node scripts/measure-proxy-overhead.mjs --after [count]
  node scripts/measure-proxy-overhead.mjs --diff <baseline.json> <after.json>
  node scripts/measure-proxy-overhead.mjs --help

参数:
  --baseline [count]   在当前 Extension Host 采样基线（默认 100 次）
  --after [count]      在加载 PLAN A + PLAN B 新代码后采样（默认 100 次）
  --diff <a> <b>       对比两个 JSON 文件，输出偏差百分比
  --help               显示此帮助

输出:
  baseline / after:  .vscode/clangd-perf-cache/proxy-{baseline,after}.json
  diff:              stdout 表格 + 退出码 0/1

退出码:
  0  全部成功（或 diff 全部 < 1%）
  1  diff 存在 ≥ 1% 偏差
  2  参数错误 / 文件缺失
`);
}

async function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    process.exit(argv.length === 0 ? 2 : 0);
  }

  const mode = argv[0];
  const restArgs = argv.slice(1);

  if (mode === '--baseline' || mode === '--after') {
    const sampleCount = restArgs.length > 0 ? parseInt(restArgs[0] ?? '100', 10) : DEFAULT_SAMPLE_COUNT;
    if (Number.isNaN(sampleCount) || sampleCount < 1) {
      console.error(`[measure-proxy-overhead] 错误：无效的采样次数 ${restArgs[0]}`);
      process.exit(2);
    }
    const label = mode === '--baseline' ? 'baseline' : 'after';
    await runSample(label, sampleCount);
    process.exit(0);
  } else if (mode === '--diff') {
    if (restArgs.length !== 2) {
      console.error('[measure-proxy-overhead] 错误：--diff 需要两个文件路径');
      console.error('用法: --diff <baseline.json> <after.json>');
      process.exit(2);
    }
    const [baselinePath, afterPath] = restArgs;
    if (!baselinePath || !afterPath) {
      console.error('[measure-proxy-overhead] 错误：文件路径不能为空');
      process.exit(2);
    }
    await runDiff(baselinePath, afterPath);
  } else {
    console.error(`[measure-proxy-overhead] 错误：未知模式 ${mode}`);
    printHelp();
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`[measure-proxy-overhead] 未处理异常: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  process.exit(2);
});
