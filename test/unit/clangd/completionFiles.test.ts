/**
 * completionFiles.test.ts —— createCompletionFiles 单元测试
 *
 * TDD: 红测阶段，先写断言再实现。
 * 覆盖 createCompletionFiles 创建 ueClangdCompat.h 的行为。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createCompletionFiles,
  getAddMacroCompletionsContent,
  FILENAME_ADD_MACRO_COMPLETIONS,
} from '@clangd/completionFiles';
import {
  FILENAME_UE_CLANGD_COMPAT,
  getUeClangdCompatContent,
} from '@clangd/ueClangdCompat';

describe('createCompletionFiles (ueClangdCompat.h)', () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    // 创建临时目录作为项目根
    tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'completion-files-test-'));
    projectPath = path.join(tmpDir, 'MyProject.uproject');
    // 创建 .uproject 文件（空文件即可，仅用于路径解析）
    await fs.writeFile(projectPath, '', 'utf-8');
  });

  afterEach(async () => {
    // 清理临时目录
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('返回数组中包含 ueClangdCompat.h 条目', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();
    expect(entry!.name).toBe(FILENAME_UE_CLANGD_COMPAT);
    expect(entry!.created).toBe(true);
  });

  it('ueClangdCompat.h 路径以 .vscode/vscodeuehelper/ueClangdCompat.h 结尾', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();
    const expectedSuffix = path.join('.vscode', 'vscodeuehelper', FILENAME_UE_CLANGD_COMPAT);
    expect(entry!.path.endsWith(expectedSuffix)).toBe(true);
  });

  it('ueClangdCompat.h 文件实际存在', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();

    const fileExists = await fs.access(entry!.path).then(() => true).catch(() => false);
    expect(fileExists).toBe(true);
  });

  it('ueClangdCompat.h 文件内容匹配 getUeClangdCompatContent()', async () => {
    const results = await createCompletionFiles(projectPath);

    const entry = results.find((r) => r.name === FILENAME_UE_CLANGD_COMPAT);
    expect(entry).toBeDefined();

    const content = await fs.readFile(entry!.path, 'utf-8');
    expect(content).toBe(getUeClangdCompatContent());
  });
});

/**
 * getAddMacroCompletionsContent() —— UE 宏签名 stub 测试
 *
 * 验证 addMacroCompletions.h 的内容包含：
 *   1) UE 宏 stub 标识符（UFUNCTION/UPROPERTY/UCLASS/USTRUCT/UENUM/UMETA 各至少一个）
 *   2) 已有的 #include 头文件行保留
 */
describe('getAddMacroCompletionsContent (UE 宏 stub)', () => {
  let content: string;

  beforeAll(() => {
    content = getAddMacroCompletionsContent();
  });

  // ---- 宏 stub 标识符存在性 ----

  it('包含 UFUNCTION stub 标识符', () => {
    expect(content).toContain('UE_UFUNCTION_Stub_BlueprintPure');
  });

  it('包含 UPROPERTY stub 标识符', () => {
    expect(content).toContain('UE_UPROPERTY_Stub_EditAnywhere');
  });

  it('包含 UCLASS stub 标识符', () => {
    expect(content).toContain('UE_UCLASS_Stub');
  });

  it('包含 USTRUCT stub 标识符', () => {
    expect(content).toContain('UE_USTRUCT_Stub');
  });

  it('包含 UENUM stub 标识符', () => {
    expect(content).toContain('UE_UENUM_Stub_BlueprintType');
  });

  it('包含 UMETA stub 标识符', () => {
    expect(content).toContain('UE_UMETA_Stub');
  });

  // ---- 已有 include 行保留 ----

  it('保留 ObjectMacros.h include 行', () => {
    expect(content).toContain('#include "UObject/ObjectMacros.h"');
  });

  it('保留 LogMacros.h include 行', () => {
    expect(content).toContain('#include "Logging/LogMacros.h"');
  });

  it('保留至少一个用户自定义示例注释', () => {
    expect(content).toContain('GameplayAbilities');
  });

  // ---- 文件生成完整性 ----

  it('createCompletionFiles 生成的 addMacroCompletions.h 包含 stub 标识符', async () => {
    const tmpDir2 = await fs.mkdtemp(
      path.join(tmpdir(), 'macro-stub-test-'),
    );
    const projectPath2 = path.join(tmpDir2, 'MyProject.uproject');
    await fs.writeFile(projectPath2, '', 'utf-8');

    try {
      const results = await createCompletionFiles(projectPath2);

      const entry = results.find(
        (r) => r.name === FILENAME_ADD_MACRO_COMPLETIONS,
      );
      expect(entry).toBeDefined();

      const fileContent = await fs.readFile(entry!.path, 'utf-8');
      expect(fileContent).toContain('UE_UFUNCTION_Stub_BlueprintPure');
      expect(fileContent).toContain('UE_UPROPERTY_Stub_EditAnywhere');
      expect(fileContent).toContain('#include "UObject/ObjectMacros.h"');
    } finally {
      await fs.rm(tmpDir2, { recursive: true, force: true });
    }
  });
});
