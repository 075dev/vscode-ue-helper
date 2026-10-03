/**
 * build 层共享类型定义
 *
 * ParsedDiagnostic 已抽离到 @core/types/diagnostic（Wave 4 T4.2），
 * parser 层不再依赖本文件 —— 这里只保留 build 模块自身关心的类型。
 */

import type { BuildConfiguration, BuildPlatform } from '@core/config';
import type { ParsedDiagnostic } from '@core/types/diagnostic';

export interface UBTArgs {
  /** .uproject 绝对路径 */
  project: string;
  /**
   * UBT 实际期望的 target 名(如 XianDreamwalkingEditor),
   * 已经由 resolveUBTTarget 从 Config.target + project basename 转换好。
   * UBT 按这个精确名找 rules 文件。
   */
  target: string;
  /** Platform (e.g., "Win64"). */
  platform: BuildPlatform;
  /** Configuration (e.g., "Development"). */
  configuration: BuildConfiguration;
  /** UBT executable to invoke (full path). */
  ubtPath: string;
  /**
   * [add-002] UBT -Module= 单模块过滤:只编译该模块到 .obj 级(不链接、不产出 DLL),
   * 定位是快速验证编译错误;仅 mode=build 语义。全 target 构建时缺省。
   */
  module?: string;
}

export interface UBTCommand {
  file: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface BuildResult {
  /** Exit code from the build process. 0 = success. */
  exitCode: number;
  /**
   * [F2-1] 用户取消时为 true(AbortSignal abort 后 close 到达)。
   * 命令层据此区分"用户取消"与"真实构建失败",取消时只弹中性提示。
   */
  cancelled?: boolean;
  /** Total duration in milliseconds. */
  durationMs: number;
  /** All stdout/stderr lines captured during the build. */
  output: string[];
  /** Parsed MSVC diagnostics, ready to push to the Problems panel. */
  diagnostics: ParsedDiagnostic[];
}

export interface BuildOptions {
  /** Cancel signal — when triggered, kills the spawned process. */
  signal?: AbortSignal;
  /** Build progress callback. */
  onProgress?: (chunk: string) => void;
  /** Build output callback (per-line). */
  onOutput?: (line: string) => void;
}
