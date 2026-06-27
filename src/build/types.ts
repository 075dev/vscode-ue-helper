/**
 * build 层共享类型定义
 */

import { BuildConfiguration, BuildPlatform } from '@core/config';

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
  /** Total duration in milliseconds. */
  durationMs: number;
  /** All stdout/stderr lines captured during the build. */
  output: string[];
  /** Parsed MSVC diagnostics, ready to push to the Problems panel. */
  diagnostics: ParsedDiagnostic[];
}

export interface ParsedDiagnostic {
  file: string;
  line: number;
  column?: number;
  severity: 'error' | 'warning' | 'note';
  code: string;
  message: string;
  /** Raw line for fallback display. */
  raw: string;
}

export interface BuildOptions {
  /** Cancel signal — when triggered, kills the spawned process. */
  signal?: AbortSignal;
  /** Build progress callback. */
  onProgress?: (chunk: string) => void;
  /** Build output callback (per-line). */
  onOutput?: (line: string) => void;
}
