/**
 * clangdIndexCache —— clangd 索引缓存的定位、量算与清理
 *
 * ## 借鉴来源
 *
 * **[Incanta/vscode-cpp-unreal](https://github.com/Incanta/vscode-cpp-unreal)** 提供
 * `Clear clangd Index` 命令,并把「首开索引需要数分钟、之后走缓存」写进 README。
 * 这正对应 UE + clangd 最常见的一类故障:**索引损坏或与引擎版本不匹配后,
 * clangd 的跳转/补全集体失灵,重建索引是唯一出路**。
 *
 * 本插件原有 `Diagnose Clangd Project` 只能「报告」问题,不给 remedy。
 * 本模块补上「可执行的补救动作」这一环:定位索引目录 → 量算体积 → 用户确认后清理。
 *
 * ## 索引位置
 *
 * clangd 的持久化索引放在其 profile 目录下的 `index/` 子目录:
 * - Windows: `%LOCALAPPDATA%\clangd\index`
 * - 其他平台: `~/.cache\clangd\index`
 *
 * 另有部分环境以工作区为 cwd 启动 clangd,索引会落在
 * `<projectDir>\.cache\clangd\index`。三者都列为候选,只有**实际存在**的才提示用户。
 *
 * ## 设计约束
 *
 * - **fs 可注入**:所有 IO 走 `IndexCacheFs` 接口,单测用假实现,不需要真实磁盘。
 * - **不猜不删**:不存在就报「未找到」;存在则先报体积,由用户确认后再删。
 * - **删除范围可控**:只删 `index` 子目录本身,不碰 clangd 的其他 profile 数据。
 */

import * as path from 'node:path';

/** 索引缓存目录的量算结果 */
export interface IndexCacheCandidate {
  /** 目录绝对路径 */
  readonly path: string;
  /** 目录是否存在 */
  readonly exists: boolean;
  /** 递归合计字节数(不存在时为 0) */
  readonly sizeBytes: number;
  /** 递归文件数(不存在时为 0) */
  readonly fileCount: number;
}

/** 可注入的文件系统接口(单测用假实现) */
export interface IndexCacheFs {
  stat(target: string): Promise<{ size: number; isDirectory(): boolean }>;
  readdir(target: string): Promise<readonly string[]>;
  rm(target: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

/** 进程环境(可注入,便于单测) */
export type IndexCacheEnv = {
  readonly LOCALAPPDATA?: string | undefined;
  readonly USERPROFILE?: string | undefined;
  readonly HOME?: string | undefined;
};

/**
 * 列出 clangd 索引缓存的候选目录(按优先级排序,可能重复,调用方需去重)。
 *
 * @param projectDir 项目根目录(`.uproject` 所在目录);null 表示未检测到项目
 * @param env 进程环境变量
 */
export function clangdIndexCacheCandidates(
  projectDir: string | null | undefined,
  env: IndexCacheEnv,
): string[] {
  const candidates: string[] = [];

  const localAppData = env.LOCALAPPDATA;
  if (typeof localAppData === 'string' && localAppData.length > 0) {
    candidates.push(path.join(localAppData, 'clangd', 'index'));
  }

  const userProfile = env.USERPROFILE;
  if (typeof userProfile === 'string' && userProfile.length > 0) {
    candidates.push(path.join(userProfile, '.cache', 'clangd', 'index'));
  }

  const home = env.HOME;
  if (typeof home === 'string' && home.length > 0) {
    candidates.push(path.join(home, '.cache', 'clangd', 'index'));
  }

  if (typeof projectDir === 'string' && projectDir.length > 0) {
    candidates.push(path.join(projectDir, '.cache', 'clangd', 'index'));
  }

  // 去重(Windows 路径大小写不敏感;用 toLowerCase 归一后去重)
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    const key = path.normalize(candidate).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }
  return unique;
}

/**
 * 递归量算目录:返回合计字节数与文件数。
 *
 * 读不到 / 无权限的条目按 0 计(不因单个坏条目让整次诊断失败)。
 */
async function measureDirectory(
  dir: string,
  fs: IndexCacheFs,
  accumulator: { size: number; files: number },
): Promise<void> {
  let entries: readonly string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const stat = await fs.stat(full);
      if (stat.isDirectory()) {
        await measureDirectory(full, fs, accumulator);
      } else {
        accumulator.size += stat.size;
        accumulator.files += 1;
      }
    } catch {
      // 单条目读取失败(权限/竞态删除)——跳过,不中断整体量算
    }
  }
}

/**
 * 量算单个候选目录。
 *
 * 目录不存在时返回 `exists: false` / size 0 / fileCount 0,不抛错。
 */
export async function inspectIndexCache(
  dir: string,
  fs: IndexCacheFs,
): Promise<IndexCacheCandidate> {
  try {
    const stat = await fs.stat(dir);
    if (!stat.isDirectory()) {
      return { path: dir, exists: false, sizeBytes: 0, fileCount: 0 };
    }
  } catch {
    return { path: dir, exists: false, sizeBytes: 0, fileCount: 0 };
  }
  const accumulator = { size: 0, files: 0 };
  await measureDirectory(dir, fs, accumulator);
  return {
    path: dir,
    exists: true,
    sizeBytes: accumulator.size,
    fileCount: accumulator.files,
  };
}

/**
 * 探测全部候选目录,返回**实际存在**的那些。
 *
 * @param candidates 候选目录列表
 * @param fs 可注入文件系统
 */
export async function discoverIndexCaches(
  candidates: readonly string[],
  fs: IndexCacheFs,
): Promise<IndexCacheCandidate[]> {
  const found: IndexCacheCandidate[] = [];
  for (const candidate of candidates) {
    const inspected = await inspectIndexCache(candidate, fs);
    if (inspected.exists) {
      found.push(inspected);
    }
  }
  return found;
}

/**
 * 清理单个索引目录(递归删除)。
 *
 * 调用方负责在调用前取得用户确认 —— 本函数不做任何确认逻辑。
 */
export async function clearIndexCache(dir: string, fs: IndexCacheFs): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * 人类可读的体积串。
 *
 * 例:`12.4 MB`、`812 KB`、`0 B`。
 */
export function formatIndexCacheSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rendered = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${rendered} ${units[unitIndex] ?? 'B'}`;
}
