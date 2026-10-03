/**
 * completionFiles.test.ts —— createCompletionFiles 单元测试
 *
 * TDD: 红测阶段，先写断言再实现。
 * 覆盖 createCompletionFiles 创建 ueClangdCompat.h 的行为。
 * 覆盖 addMacroCompletions.h 的托管区域刷新 + 用户区保留。
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import {
  createCompletionFiles,
  getAddMacroCompletionsContent,
  FILENAME_ADD_MACRO_COMPLETIONS,
  MANAGED_BEGIN_MARKER,
  MANAGED_END_MARKER,
  USER_BEGIN_MARKER,
  USER_END_MARKER,
  parseManagedRegions,
} from '@clangd/completionFiles';
import { FILENAME_UE_CLANGD_COMPAT, getUeClangdCompatContent } from '@clangd/ueClangdCompat';

// ---- 辅助函数 ----

/** 在临时目录创建 .uproject 文件并返回 projectPath */
async function setupTempProject(): Promise<{ tmpDir: string; projectPath: string }> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), 'completion-files-test-'));
  const projectPath = path.join(tmpDir, 'MyProject.uproject');
  await fs.writeFile(projectPath, '', 'utf-8');
  return { tmpDir, projectPath };
}

/** 获取 addMacroCompletions.h 的文件路径 */
function getMacroFilePath(projectPath: string): string {
  return path.join(
    path.dirname(projectPath),
    '.vscode',
    'vscodeuehelper',
    FILENAME_ADD_MACRO_COMPLETIONS,
  );
}

/**
 * 构建带托管标记的旧版 addMacroCompletions.h（模拟旧版本内容）。
 * managedContent 是旧版托管区内容，userContent 是用户自定义内容。
 */
function buildOldManagedFile(managedContent: string, userContent: string): string {
  return [
    '/* old header comment */',
    '',
    MANAGED_BEGIN_MARKER,
    managedContent,
    MANAGED_END_MARKER,
    '',
    USER_BEGIN_MARKER,
    userContent,
    USER_END_MARKER,
    '',
  ].join('\n');
}

// ---- 现有测试：ueClangdCompat.h ----

describe('createCompletionFiles (ueClangdCompat.h)', () => {
  let tmpDir: string;
  let projectPath: string;

  beforeEach(async () => {
    const setup = await setupTempProject();
    tmpDir = setup.tmpDir;
    projectPath = setup.projectPath;
  });

  afterEach(async () => {
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

    const fileExists = await fs
      .access(entry!.path)
      .then(() => true)
      .catch(() => false);
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

// ---- 现有测试：getAddMacroCompletionsContent 宏 stub ----

describe('getAddMacroCompletionsContent (UE 宏 stub)', () => {
  let content: string;

  beforeAll(() => {
    content = getAddMacroCompletionsContent();
  });

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

  it('保留 ObjectMacros.h include 行', () => {
    expect(content).toContain('#include "UObject/ObjectMacros.h"');
  });

  it('保留 LogMacros.h include 行', () => {
    expect(content).toContain('#include "Logging/LogMacros.h"');
  });

  it('保留至少一个用户自定义示例注释', () => {
    expect(content).toContain('GameplayAbilities');
  });

  it('createCompletionFiles 生成的 addMacroCompletions.h 包含 stub 标识符', async () => {
    const setup = await setupTempProject();
    try {
      const results = await createCompletionFiles(setup.projectPath);

      const entry = results.find((r) => r.name === FILENAME_ADD_MACRO_COMPLETIONS);
      expect(entry).toBeDefined();

      const fileContent = await fs.readFile(entry!.path, 'utf-8');
      expect(fileContent).toContain('UE_UFUNCTION_Stub_BlueprintPure');
      expect(fileContent).toContain('UE_UPROPERTY_Stub_EditAnywhere');
      expect(fileContent).toContain('#include "UObject/ObjectMacros.h"');
    } finally {
      await fs.rm(setup.tmpDir, { recursive: true, force: true });
    }
  });
});

// ---- 新增测试：托管区域刷新与用户区保留 (T3) ----

describe('createCompletionFiles —— 托管区域刷新 (T3)', () => {
  // allow: SIZE_OK — T3 验收要求集中覆盖升级、刷新、保留与迁移矩阵，拆文件会削弱同一 fixture 的可读性。
  let tmpDir: string;
  let projectPath: string;
  let macroFilePath: string;

  beforeEach(async () => {
    const setup = await setupTempProject();
    tmpDir = setup.tmpDir;
    projectPath = setup.projectPath;
    macroFilePath = getMacroFilePath(projectPath);
    // 预先创建 .vscode/vscodeuehelper/ 目录
    await fs.mkdir(path.dirname(macroFilePath), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  // ---- T3.1: 旧托管内容可刷新 ----

  it('已有托管标记的旧文件：managed 区刷新为当前内容，user 区保留', async () => {
    // Given: 存在一个带托管标记的旧版 addMacroCompletions.h
    const oldManaged = '// old managed include\n#include "OldHeader.h"\n';
    const userCustom = '// 用户自定义 include\n#include "MyCustomModule.h"\n';
    const oldFile = buildOldManagedFile(oldManaged, userCustom);
    await fs.writeFile(macroFilePath, oldFile, 'utf-8');

    // When: 运行 createCompletionFiles
    const results = await createCompletionFiles(projectPath);

    // Then: managed 区已刷新为当前生成内容
    const fileContent = await fs.readFile(macroFilePath, 'utf-8');
    const regions = parseManagedRegions(fileContent);
    expect(regions.hasManagedMarkers).toBe(true);
    expect(regions.managedContent).not.toContain('#include "OldHeader.h"');
    expect(regions.managedContent).toContain('#include "UObject/ObjectMacros.h"');
    expect(regions.managedContent).toContain('UE_UFUNCTION_Stub_BlueprintPure');

    // Then: 用户自定义 include 只保留在 user 区
    expect(regions.userContent).toContain('#include "MyCustomModule.h"');
    expect(regions.userContent).toContain('用户自定义 include');
    expect(regions.userContent).not.toContain('#include "OldHeader.h"');

    // Then: 标记仍然存在
    expect(fileContent).toContain(MANAGED_BEGIN_MARKER);
    expect(fileContent).toContain(MANAGED_END_MARKER);
    expect(fileContent).toContain(USER_BEGIN_MARKER);
    expect(fileContent).toContain(USER_END_MARKER);

    // Then: 结果中 reported 为 refreshed
    const entry = results.find((r) => r.name === FILENAME_ADD_MACRO_COMPLETIONS);
    expect(entry).toBeDefined();
    expect(entry!.created).toBe(false); // 已存在，非首次创建
  });

  // ---- T3.2: 无托管标记的旧文件安全迁移 ----

  it('无托管标记的旧文件：原内容移入 user 区，managed 区追加当前内容', async () => {
    // Given: 存在一个没有托管标记的旧版 addMacroCompletions.h（模拟升级前版本）
    const legacyContent = [
      '/* old header */',
      '',
      '// 用户的老 include',
      '#include "LegacyModule.h"',
      '',
    ].join('\n');
    await fs.writeFile(macroFilePath, legacyContent, 'utf-8');

    // When: 运行 createCompletionFiles
    await createCompletionFiles(projectPath);

    // Then: 文件包含新的托管区内容
    const fileContent = await fs.readFile(macroFilePath, 'utf-8');
    const regions = parseManagedRegions(fileContent);
    expect(regions.hasManagedMarkers).toBe(true);
    expect(regions.managedContent).toContain('#include "UObject/ObjectMacros.h"');
    expect(regions.managedContent).toContain('UE_UFUNCTION_Stub_BlueprintPure');

    // Then: 旧内容被移入 user 区（保留）
    expect(regions.userContent).toContain('#include "LegacyModule.h"');
    expect(regions.userContent).toContain('用户的老 include');

    // Then: 现在文件有托管标记
    expect(fileContent).toContain(MANAGED_BEGIN_MARKER);
    expect(fileContent).toContain(MANAGED_END_MARKER);
    expect(fileContent).toContain(USER_BEGIN_MARKER);
    expect(fileContent).toContain(USER_END_MARKER);
  });

  // ---- T3.3: 用户区内容多次刷新后仍然保留 ----

  it('多次刷新：用户区内容持续保留，managed 区每次更新', async () => {
    // Given: 第一次创建带用户区内容的文件
    const userCustom = '#include "PersistentModule.h"\n';
    const initialFile = buildOldManagedFile('// initial managed\n', userCustom);
    await fs.writeFile(macroFilePath, initialFile, 'utf-8');

    // When: 第一次刷新
    await createCompletionFiles(projectPath);
    const afterFirst = await fs.readFile(macroFilePath, 'utf-8');
    expect(afterFirst).toContain('#include "PersistentModule.h"');
    expect(afterFirst).not.toContain('// initial managed');

    // When: 第二次刷新
    await createCompletionFiles(projectPath);
    const afterSecond = await fs.readFile(macroFilePath, 'utf-8');

    // Then: 用户区内容仍然存在
    expect(afterSecond).toContain('#include "PersistentModule.h"');
    // Then: managed 区是当前内容
    expect(afterSecond).toContain('UE_UFUNCTION_Stub_BlueprintPure');
  });

  // ---- T3.4: 新创建的文件包含托管标记 ----

  it('首次创建：addMacroCompletions.h 包含 managed + user 标记', async () => {
    // Given: 目录不存在 addMacroCompletions.h（由 beforeEach 保证）

    // When: 创建补全文件
    await createCompletionFiles(projectPath);

    // Then: 文件存在且包含标记
    const fileContent = await fs.readFile(macroFilePath, 'utf-8');
    expect(fileContent).toContain(MANAGED_BEGIN_MARKER);
    expect(fileContent).toContain(MANAGED_END_MARKER);
    expect(fileContent).toContain(USER_BEGIN_MARKER);
    expect(fileContent).toContain(USER_END_MARKER);

    // Then: managed 区包含生成内容
    expect(fileContent).toContain('#include "UObject/ObjectMacros.h"');
    expect(fileContent).toContain('UE_UFUNCTION_Stub_BlueprintPure');
  });

  // ---- T3.5: addCompletions.h 不覆盖 ----

  it('addCompletions.h 已存在时不被覆盖', async () => {
    // Given: 先创建补全文件（生成 addCompletions.h 模板）
    await createCompletionFiles(projectPath);

    // Given: 用户修改 addCompletions.h 添加自定义内容
    const addCompletionsPath = path.join(
      path.dirname(projectPath),
      '.vscode',
      'vscodeuehelper',
      'addCompletions.h',
    );
    const userContent = '// 用户修改\n#include "UserHeader.h"\n';
    await fs.writeFile(addCompletionsPath, userContent, 'utf-8');

    // When: 再次运行 createCompletionFiles
    await createCompletionFiles(projectPath);

    // Then: addCompletions.h 内容未被覆盖
    const finalContent = await fs.readFile(addCompletionsPath, 'utf-8');
    expect(finalContent).toBe(userContent);
  });

  // ---- T3.7: safe migration 保留 include 但不重复旧样板头 ----

  it('无标记旧文件迁移：保留旧 include，丢弃旧版样板说明头', async () => {
    // Given: 旧文件包含扩展旧版样板说明和用户 include
    const legacyTemplateContent = [
      '/*',
      '* addMacroCompletions.h — 添加宏补全和非宏补全头文件',
      '* 此文件中的 #include 在 slow 模式下被 clangd 预包含。',
      '*/',
      '',
      '// 用户自定义旧 include',
      '#include "LegacyGameplayTags.h"',
      '',
    ].join('\n');
    await fs.writeFile(macroFilePath, legacyTemplateContent, 'utf-8');

    // When: 运行 createCompletionFiles
    await createCompletionFiles(projectPath);

    // Then: 旧 include 保留在用户区，但旧样板头不会重复进用户区
    const fileContent = await fs.readFile(macroFilePath, 'utf-8');
    const regions = parseManagedRegions(fileContent);
    expect(regions.hasManagedMarkers).toBe(true);
    expect(regions.userContent).toContain('#include "LegacyGameplayTags.h"');
    expect(regions.userContent).toContain('用户自定义旧 include');
    expect(regions.userContent).not.toContain('addMacroCompletions.h — 添加宏补全和非宏补全头文件');
  });
});

// ---- parseManagedRegions 单元测试 ----

describe('parseManagedRegions', () => {
  it('解析含完整标记的内容：返回 managed 和 user 区域', () => {
    const content = [
      '/* header */',
      '',
      MANAGED_BEGIN_MARKER,
      'managed line 1',
      'managed line 2',
      MANAGED_END_MARKER,
      '',
      USER_BEGIN_MARKER,
      'user line 1',
      'user line 2',
      USER_END_MARKER,
      '',
    ].join('\n');

    const result = parseManagedRegions(content);

    expect(result.hasManagedMarkers).toBe(true);
    expect(result.managedContent).toContain('managed line 1');
    expect(result.managedContent).toContain('managed line 2');
    expect(result.managedContent).not.toContain(MANAGED_BEGIN_MARKER);
    expect(result.managedContent).not.toContain(MANAGED_END_MARKER);

    expect(result.userContent).toContain('user line 1');
    expect(result.userContent).toContain('user line 2');
    expect(result.userContent).not.toContain(USER_BEGIN_MARKER);
    expect(result.userContent).not.toContain(USER_END_MARKER);
  });

  it('无标记内容：hasManagedMarkers=false，userContent 为全内容', () => {
    const content = 'legacy content\nno markers here\n';

    const result = parseManagedRegions(content);

    expect(result.hasManagedMarkers).toBe(false);
    expect(result.managedContent).toBe('');
    expect(result.userContent).toBe(content);
  });

  it('只有 managed begin 无 end：hasManagedMarkers=false', () => {
    const content = [MANAGED_BEGIN_MARKER, 'incomplete'].join('\n');

    const result = parseManagedRegions(content);

    expect(result.hasManagedMarkers).toBe(false);
    expect(result.userContent).toBe(content);
  });

  it('managed 区为空字符串时正确解析', () => {
    const content = [
      MANAGED_BEGIN_MARKER,
      MANAGED_END_MARKER,
      '',
      USER_BEGIN_MARKER,
      'only user content',
      USER_END_MARKER,
    ].join('\n');

    const result = parseManagedRegions(content);

    expect(result.hasManagedMarkers).toBe(true);
    expect(result.managedContent.trim()).toBe('');
    expect(result.userContent).toContain('only user content');
  });

  it('user 区为空字符串时正确解析', () => {
    const content = [
      MANAGED_BEGIN_MARKER,
      'only managed',
      MANAGED_END_MARKER,
      '',
      USER_BEGIN_MARKER,
      USER_END_MARKER,
    ].join('\n');

    const result = parseManagedRegions(content);

    expect(result.hasManagedMarkers).toBe(true);
    expect(result.managedContent).toContain('only managed');
    expect(result.userContent.trim()).toBe('');
  });
});
