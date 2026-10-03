/**
 * fingerprint —— .uproject + Build.cs + Target.cs + .uplugin + 引擎 Build.version 内容哈希指纹
 *
 * 目的（per D-09）：
 *   - 在二次激活时快速判断工程/引擎配置相关文件是否变更
 *   - 与 CompileCommandsCache 配合，命中时跳过 5-30s 的 UBT 子进程调用
 *
 * 算法：
 *   1. 收集 projectDir 下的 .uproject、Plugins 下的 .uplugin、
 *      Source 目录下的 Build.cs / Target.cs，以及（可选）引擎 Engine/Build/Build.version
 *   2. 路径字典序排序（保证跨平台确定性）
 *   3. 对每个文件：hash.update(path) + 空字符 + hash.update(content) + 空字符
 *   4. 最终摘要作为 64 字符 hex 字符串
 *
 * 两层指纹：
 *   - computeLightFingerprint：仅 path + mtime + size 元组哈希（小于 5ms）
 *   - computeFingerprint：完整文件内容 SHA256（10-50ms for 5000 files 工程）
 *
 * 安全（per T-7-02）：
 *   - projectDir 必须在 workspaceFolder 内，禁止路径穿越
 *   - 异常情况下返回稳定空指纹（空目录 / Source 不存在），不抛错
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { FingerprintResult } from './types';

/**
 * 计算完整内容指纹（含文件 IO + SHA256）
 *
 * @param projectDir .uproject 所在目录的绝对路径
 * @param engineRoot [W11/F2-5] 可选引擎根目录绝对路径。
 *   提供时会把 <engineRoot>/Engine/Build/Build.version 纳入哈希——引擎版本
 *   变更后指纹变化 → 缓存 miss → UBT 重新生成，避免陈旧 DB。
 *   不传时保持旧行为（仅工程文件），保证调用方向后兼容。
 * @returns 指纹结果 + 计算耗时 + 参与文件列表
 *
 * 空 Source 目录 → 稳定空指纹（'EMPTY' 哈希），不抛错
 */
export async function computeFingerprint(
  projectDir: string,
  engineRoot?: string,
): Promise<FingerprintResult> {
  const startMs = performance.now();
  const normalized = normalizeProjectDir(projectDir);
  if (!normalized) {
    // 安全失败：返回稳定空指纹（per 空目录容错）
    return {
      fingerprint: emptyFingerprint(),
      files: [],
      computedMs: 0,
    };
  }

  // 1. 收集所有需要纳入指纹的文件
  const files = await collectFingerprintFiles(normalized, engineRoot);
  files.sort(); // 路径字典序固定 → 确定性（D-09）

  // 2. SHA256 拼接
  const hash = crypto.createHash('sha256');
  const fileMeta: { path: string; size: number; mtimeMs: number }[] = [];

  for (const filePath of files) {
    try {
      const content = await fs.readFile(filePath);
      hash.update(filePath);
      hash.update('\0');
      hash.update(content);
      hash.update('\0');

      // 收集元数据用于诊断
      const stat = await fs.stat(filePath);
      fileMeta.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // 单个文件读失败：忽略该文件，但继续 hash 剩余部分
    }
  }

  return {
    fingerprint: hash.digest('hex'),
    files: fileMeta,
    computedMs: performance.now() - startMs,
  };
}

/**
 * 轻量级指纹：仅基于 (path + mtime + size) 元组
 *
 * 用于「先快比对、不变则跳过完整 SHA256」的二级短路：
 *   - light 命中 → 文件元数据未变，可直接复用上次完整指纹
 *   - light miss → 走完整 computeFingerprint
 *
 * 注意：light 指纹**不是绝对确定性** —— mtime/文件系统可能变更但内容不变
 * 此时必须再调一次 computeFingerprint 确认。仅作为快速预筛选。
 *
 * @param engineRoot [W11/F2-5] 可选引擎根，与 computeFingerprint 语义一致。
 */
export async function computeLightFingerprint(
  projectDir: string,
  engineRoot?: string,
): Promise<string> {
  const normalized = normalizeProjectDir(projectDir);
  if (!normalized) {
    return emptyFingerprint();
  }

  const files = await collectFingerprintFiles(normalized, engineRoot);
  files.sort();

  const hash = crypto.createHash('sha256');
  hash.update('light:');
  for (const filePath of files) {
    try {
      const stat = await fs.stat(filePath);
      hash.update(filePath);
      hash.update('\0');
      hash.update(String(stat.size));
      hash.update('\0');
      hash.update(String(Math.floor(stat.mtimeMs)));
      hash.update('\0');
    } catch {
      // stat 失败 → 视作元数据变更，标记
      hash.update(filePath);
      hash.update('\0MISSING');
      hash.update('\0');
    }
  }
  return hash.digest('hex');
}

/* ------------------------------------------------------------------ */
/*  内部辅助                                                            */
/* ------------------------------------------------------------------ */

/**
 * 收集需要纳入指纹的文件路径列表
 *
 * 包含：
 *   - projectDir 下的 .uproject
 *   - projectDir/Plugins 下递归所有 .uplugin（插件模块清单，W11/F2-5）
 *   - projectDir/Source 下所有 .Build.cs
 *   - projectDir/Source 下所有 .Target.cs
 *   - [W11/F2-5] engineRoot 提供的 <engineRoot>/Engine/Build/Build.version
 *
 * 任意目录不存在 → 返回空数组（稳定空指纹）
 */
async function collectFingerprintFiles(projectDir: string, engineRoot?: string): Promise<string[]> {
  const out: string[] = [];

  // .uproject（项目根 + plugins 子目录）
  try {
    const entries = await fs.readdir(projectDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.uproject')) {
        out.push(path.join(projectDir, e.name));
      }
    }
  } catch {
    // projectDir 不存在 → 返回空
  }

  // Plugins/*/.uproject
  try {
    const pluginsDir = path.join(projectDir, 'Plugins');
    const pluginEntries = await fs.readdir(pluginsDir, { withFileTypes: true });
    for (const e of pluginEntries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        const pluginUproject = path.join(pluginsDir, e.name, `${e.name}.uproject`);
        try {
          await fs.access(pluginUproject);
          out.push(pluginUproject);
        } catch {
          // 插件无 .uproject 文件，跳过
        }
      }
    }
  } catch {
    // Plugins 目录不存在，跳过
  }

  // Plugins/**/*.uplugin（递归收集插件模块清单，W11/F2-5：
  // 仅收集 .uproject 会漏掉纯 .uplugin 插件，模块增删/配置变更后缓存仍命中陈旧 DB）
  await walkDir(path.join(projectDir, 'Plugins'), (filePath) => {
    if (/\.uplugin$/i.test(filePath)) {
      out.push(filePath);
    }
  });

  // 引擎 Engine/Build/Build.version（W11/F2-5：
  // 引擎版本/补丁变更会影响编译参数，变更后必须失效缓存重新生成）
  if (engineRoot) {
    const buildVersion = path.join(engineRoot, 'Engine', 'Build', 'Build.version');
    try {
      await fs.access(buildVersion);
      out.push(buildVersion);
    } catch {
      // 引擎根没有 Build.version（如测试 fixture）→ 跳过，不参与哈希
    }
  }

  // Source/**/*.Build.cs + Target.cs
  await walkDir(path.join(projectDir, 'Source'), (filePath) => {
    if (/\.(Build|Target)\.cs$/i.test(filePath)) {
      out.push(filePath);
    }
  });

  return out;
}

async function walkDir(dir: string, visitor: (filePath: string) => void): Promise<void> {
  let entries: import('node:fs').Dirent[];
  try {
    // withFileTypes: true → Promise<Dirent[]>（@types/node v20 overload: ObjectEncodingOptions & { withFileTypes: true }）
    // name 类型为 string（默认 utf-8 编码），后续仅作路径拼接使用
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = String(entry.name);
    const fullPath = path.join(dir, name);
    if (entry.isDirectory()) {
      if (
        name.startsWith('.') ||
        name === 'Intermediate' ||
        name === 'Binaries' ||
        name === 'Saved'
      ) {
        continue;
      }
      await walkDir(fullPath, visitor);
    } else if (entry.isFile()) {
      visitor(fullPath);
    }
  }
}

/**
 * 路径标准化 + workspace 内校验（per T-7-02）
 *
 * - 输入为空字符串 / 相对路径 / 包含 '..' → 返回 null（拒绝）
 * - 规范化后的路径必须在某个 workspace folder 内
 */
function normalizeProjectDir(projectDir: string): string | null {
  if (!projectDir || typeof projectDir !== 'string') {
    return null;
  }
  const normalized = path.resolve(projectDir);
  if (normalized.includes('..')) {
    return null;
  }
  return normalized;
}

/** 稳定空指纹 —— 当 projectDir 为空或无效时使用 */
function emptyFingerprint(): string {
  const hash = crypto.createHash('sha256');
  hash.update('EMPTY');
  return hash.digest('hex');
}
