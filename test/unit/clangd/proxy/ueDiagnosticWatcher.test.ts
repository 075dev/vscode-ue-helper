/**
 * ueDiagnosticWatcher 测试 —— 验证 UBT 参数白名单校验（T5.2）
 *
 * buildTargetName 与 projectFile 在 runUbt() 中被拼入 `-Target=...` argv，传给 dotnet → UBT。
 * UBT 的 ParseCommandLine 会按空格分割含空格的 argv；如果 buildTargetName 含 shell
 * metacharacter 或控制字符，可能导致 UBT 解析错乱（即便 spawn 用 array 形式不让 shell 执行，
 * 仍会让 UBT 误读参数）。
 *
 * 白名单 `[\w./\\:-]` 确保：
 * - 只允许字母数字下划线（合法 UE target/project 名）
 * - 路径分隔符 `/`、`\`（uproject 路径）
 * - `:`（Windows 盘符）
 * - `.`（文件扩展名）
 */

import { describe, it, expect } from 'vitest';
import {
  validateUbtArgs,
  UBTArgsValidationError,
} from '@clangd/proxy/ueDiagnosticWatcher';

describe('validateUbtArgs (T5.2)', () => {
  it('accepts plain UE target name', () => {
    expect(() => validateUbtArgs('MyProjectEditor', 'C:/path/to/MyProject.uproject')).not.toThrow();
  });

  it('accepts target with underscore and digits', () => {
    expect(() => validateUbtArgs('XianDreamwalking_Editor_v2', '/tmp/x.uproject')).not.toThrow();
  });

  it('accepts Windows path with drive letter', () => {
    expect(() => validateUbtArgs('Foo', 'D:\\GameProj\\Game.uproject')).not.toThrow();
  });

  it('rejects target with shell metacharacter &', () => {
    expect(() => validateUbtArgs('MyTarget&rm -rf /', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects target with shell pipe |', () => {
    expect(() => validateUbtArgs('MyTarget|cat /etc/passwd', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects target with command substitution $()', () => {
    expect(() => validateUbtArgs('MyTarget$(whoami)', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects target with backticks (command substitution)', () => {
    expect(() => validateUbtArgs('MyTarget`whoami`', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects target with newline (argv injection)', () => {
    expect(() => validateUbtArgs('MyTarget\n--injected-flag', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects target with quote characters', () => {
    expect(() => validateUbtArgs('MyTarget"--inject', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects projectFile with shell metacharacter', () => {
    expect(() => validateUbtArgs('Good', '/tmp/x.uproject;rm')).toThrow(UBTArgsValidationError);
  });

  it('rejects empty buildTargetName', () => {
    expect(() => validateUbtArgs('', 'C:/x.uproject')).toThrow(UBTArgsValidationError);
  });

  it('rejects empty projectFile', () => {
    expect(() => validateUbtArgs('Good', '')).toThrow(UBTArgsValidationError);
  });

  it('error message includes the offending field name', () => {
    try {
      validateUbtArgs('Bad&', 'C:/x.uproject');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UBTArgsValidationError);
      expect((err as UBTArgsValidationError).message).toMatch(/buildTargetName/);
    }
  });
});