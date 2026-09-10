/**
 * diagnostics/io —— clangd 诊断的文件/YAML/JSON 读取与解析
 *
 * 纯只读，不含任何写入操作。
 * 从 diagnoseProject.ts 拆分。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as yaml from 'yaml';
import {
  type DiagnosticCheck,
  type CompileCommandsEntry,
  type ParsedClangd,
  EXPECTED_COMPILATION_DATABASE,
  COMPILE_COMMANDS_FILE,
} from './types';

// ---- 字符串工具 ----

export function stripQuotes(value: string): string {
  return value.replace(/^["'](.*)["']$/, '$1');
}

export function normalizePath(value: string): string {
  return stripQuotes(value).replace(/\\/g, '/').toLowerCase();
}

// ---- 文件存在性 ----

export async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(
    () => true,
    () => false,
  );
}

// ---- 类型守卫与数组 ----

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

// ---- YAML 解析 ----

export function parseClangdYaml(text: string): ParsedClangd {
  // yaml.parse 返回 any，用类型注解窄化到 unknown，下游走 isRecord 类型守卫
  const root: unknown = yaml.parse(text);
  if (!isRecord(root)) {
    return { addFlags: [] };
  }
  const compileFlags = isRecord(root.CompileFlags) ? root.CompileFlags : {};
  const diagnostics = isRecord(root.Diagnostics) ? root.Diagnostics : {};
  return {
    addFlags: stringArray(compileFlags.Add),
    ...(typeof compileFlags.CompilationDatabase === 'string'
      ? { compilationDatabase: compileFlags.CompilationDatabase }
      : {}),
    ...(typeof diagnostics.MissingIncludes === 'string'
      ? { missingIncludes: diagnostics.MissingIncludes }
      : {}),
    ...(typeof diagnostics.UnusedIncludes === 'string'
      ? { unusedIncludes: diagnostics.UnusedIncludes }
      : {}),
  };
}

// ---- compile_commands.json 路径与解析 ----

export function resolveCompileCommandsPath(
  projectDir: string,
  compilationDatabase?: string,
): string {
  return path.join(
    projectDir,
    compilationDatabase ?? EXPECTED_COMPILATION_DATABASE,
    COMPILE_COMMANDS_FILE,
  );
}

export async function parseCompileCommands(
  jsonPath: string,
): Promise<readonly CompileCommandsEntry[] | undefined> {
  const text = await fs.readFile(jsonPath, 'utf-8');
  // JSON.parse 返回 any，用类型注解窄化到 unknown，下游走 Array.isArray + isRecord 类型守卫
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    return undefined;
  }
  return parsed.filter(isRecord).map((entry) => ({
    ...(typeof entry.file === 'string' ? { file: entry.file } : {}),
  }));
}

// ---- compile_commands.json 存在性/有效性检查 ----

export async function appendCompileCommandsJsonCheck(
  checks: DiagnosticCheck[],
  compileCommandsPath: string,
): Promise<readonly CompileCommandsEntry[] | undefined> {
  if (!(await pathExists(compileCommandsPath))) {
    checks.push({
      name: 'compileCommandsJson',
      status: 'fail',
      severity: 'error',
      message: 'compile_commands.json 不存在',
      path: compileCommandsPath,
    });
    return undefined;
  }
  try {
    const entries = await parseCompileCommands(compileCommandsPath);
    if (entries === undefined || entries.length === 0) {
      checks.push({
        name: 'compileCommandsJson',
        status: 'fail',
        severity: 'error',
        message: 'compile_commands.json 不是非空数组',
        path: compileCommandsPath,
      });
      return undefined;
    }
    checks.push({
      name: 'compileCommandsJson',
      status: 'pass',
      severity: 'info',
      message: `compile_commands.json 可解析 (${entries.length} 条)`,
      path: compileCommandsPath,
    });
    return entries;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    checks.push({
      name: 'compileCommandsJson',
      status: 'fail',
      severity: 'error',
      message: `compile_commands.json 解析失败: ${message}`,
      path: compileCommandsPath,
    });
    return undefined;
  }
}
