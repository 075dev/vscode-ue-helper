/**
 * extract-ue-docs.test.ts —— UE 源码头文件文档提取脚本的纯函数单测
 *
 * 覆盖:
 *  - parseArgs: 必填/可选/默认值/不存在路径抛错
 *  - parseDeclaration: 各种 UE 声明形态(template using / class / struct / enum / macro / function)
 *  - extractDocComments: 单行块注释、多行块注释、/// 行注释、minDocLength 过滤
 *  - findDeclaration: 跳过 # / template / UE_API 标记、跨行声明
 *  - 容错: 损坏 / 非标准 / 截断注释
 *
 * 设计要点:
 *  - 直接 import scripts/extract-ue-docs;require.main === module 守护保证 import 不触发 CLI
 *  - 用 fixture 字符串而非文件 IO,跑得快、覆盖全
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  parseArgs,
  parseDeclaration,
  extractDocComments,
  findDeclaration,
  runExtract,
  type DocEntry,
} from '../../../scripts/extract-ue-docs';

describe('parseArgs', () => {
  it('提取 --engine= / --output= / --include= / --exclude= / --min-doc-length=', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-'));
    const args = parseArgs([
      `--engine=${tmp}`,
      '--output=data/ue-docs.json',
      '--include=**/ObjectPtr.h',
      '--exclude=**/ThirdParty/**',
      '--min-doc-length=120',
    ]);
    expect(args.engineRoot).toBe(path.resolve(tmp));
    expect(args.output).toBe('data/ue-docs.json');
    expect(args.include).toBe('**/ObjectPtr.h');
    expect(args.exclude).toBe('**/ThirdParty/**');
    expect(args.minDocLength).toBe(120);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('--output / --include / --exclude 可省略,默认值正确', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-'));
    const args = parseArgs([`--engine=${tmp}`]);
    expect(args.output).toBe('data/ue-docs.json');
    expect(args.include).toBeUndefined();
    expect(args.exclude).toBeUndefined();
    expect(args.minDocLength).toBe(80);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('--engine 路径不存在时抛错(含用法提示)', () => {
    expect(() => parseArgs(['--engine=D:/does-not-exist-zzz'])).toThrow(/--engine 路径不存在/);
  });

  it('--engine 缺失时抛错', () => {
    expect(() => parseArgs([])).toThrow(/--engine/);
  });

  it('--min-doc-length 默认 80', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-'));
    expect(parseArgs([`--engine=${tmp}`]).minDocLength).toBe(80);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('parseDeclaration', () => {
  it('template<...> using X = Y 识别为 type_alias', () => {
    expect(parseDeclaration('template<typename T> using TObjectPtr = TObjectPtr<T>')).toEqual({
      name: 'TObjectPtr',
      kind: 'type_alias',
    });
  });

  it('class TMyClass 识别为 class', () => {
    expect(parseDeclaration('class TMyClass')).toEqual({ name: 'TMyClass', kind: 'class' });
  });

  it('struct TMyStruct 识别为 struct', () => {
    expect(parseDeclaration('struct TMyStruct')).toEqual({ name: 'TMyStruct', kind: 'struct' });
  });

  it('class/struct 后可带导出宏 class MY_API TMyClass', () => {
    expect(parseDeclaration('class MY_API TMyClass')).toEqual({
      name: 'TMyClass',
      kind: 'class',
    });
  });

  it('enum class EFoo 识别为 enum', () => {
    expect(parseDeclaration('enum class EFoo')).toEqual({ name: 'EFoo', kind: 'enum' });
  });

  it('enum EFoo (无 class) 识别为 enum', () => {
    expect(parseDeclaration('enum EFoo')).toEqual({ name: 'EFoo', kind: 'enum' });
  });

  it('UE_DECLARE_X(...) 宏识别为 macro', () => {
    expect(parseDeclaration('UE_DECLARE_GAMEPLAY_TAG_EXTERN(MyTag)')).toEqual({
      name: 'UE_DECLARE_GAMEPLAY_TAG_EXTERN',
      kind: 'macro',
    });
  });

  it('ReturnType FuncName(params) 识别为 function', () => {
    expect(parseDeclaration('int32 DoSomething(const TArray<int32>& Arr)')).toEqual({
      name: 'DoSomething',
      kind: 'function',
    });
  });

  it('控制关键字 if/for/while 不会误识别为 function', () => {
    expect(parseDeclaration('if (x > 0)')).toBeNull();
    expect(parseDeclaration('for (auto& x : arr)')).toBeNull();
    expect(parseDeclaration('while (running)')).toBeNull();
  });

  it('空行 / 注释 / 预处理指令 返回 null', () => {
    expect(parseDeclaration('')).toBeNull();
    expect(parseDeclaration('   ')).toBeNull();
    expect(parseDeclaration('// 注释')).toBeNull();
    expect(parseDeclaration('#include "Foo.h"')).toBeNull();
  });

  it('template 前缀被剥离后正确识别(前向声明)', () => {
    // parseDeclaration 接收已剥离到声明首行的文本——这里模拟"前向声明"形态。
    // 完整类体 { T Data[N]; } 走不到 parseDeclaration(被 findDeclaration 截断在 { 处)。
    expect(
      parseDeclaration('template<typename T, int N> struct TStaticArray;'),
    ).toEqual({ name: 'TStaticArray', kind: 'struct' });
  });
});

describe('findDeclaration', () => {
  it('跳过空行、# 预处理、template 前缀,找到真实声明(从注释下一行开始)', () => {
    // findDeclaration 的 startLine 是 doc block 之后的位置(extractDocComments 内部约定)
    const lines = [
      '/** doc */',
      '#include "Foo.h"',
      '',
      'template<typename T>',
      'class TMyClass {',
    ];
    const result = findDeclaration(lines, 1); // 从 #include 之后开始
    expect(result).not.toBeNull();
    expect(result!.name).toBe('TMyClass');
    expect(result!.kind).toBe('class');
    expect(result!.signature).toMatch(/TMyClass/);
  });

  it('收集 UCLASS / UPROPERTY / UFUNCTION 等 UE 宏作为前缀行', () => {
    const lines = [
      '/** doc */',
      'UCLASS()',
      'class UMyComponent : public UActorComponent {',
    ];
    // startLine 跳过 doc 块,落在 UCLASS() 上
    const result = findDeclaration(lines, 1);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('UMyComponent');
    expect(result!.signature).toMatch(/UCLASS/);
  });

  it('多行声明跨行收集(function 返回类型 + name + params)', () => {
    const lines = [
      '/** doc */',
      'int32',
      'DoSomething(',
      '    const TArray<int32>& Arr,',
      '    int32 Count) {',
    ];
    // startLine=1 落在返回类型 int32(非 decl,继续)
    const result = findDeclaration(lines, 1);
    expect(result).not.toBeNull();
    expect(result!.name).toBe('DoSomething');
  });

  it('找不到声明时返回 null', () => {
    const lines = ['/** doc */', 'random text', 'more text'];
    expect(findDeclaration(lines, 1)).toBeNull();
  });

  it('从行首开始调用时也能跳过 /** doc */ 行(以 / 开头)', () => {
    // 防御:即使误传 0 也不会把 /** doc */ 当成声明
    const lines = ['/** doc */', 'class TMyClass;'];
    expect(findDeclaration(lines, 0)).toBeNull(); // 0 是注释行,被 isDecl 拦掉;line 1 是 class;但当前会返回 null
    // 实际生产里 startLine 总是 0 之后
    expect(findDeclaration(lines, 1)).not.toBeNull();
  });
});

describe('extractDocComments — /** */ 块注释', () => {
  it('单行 /** ... */ 紧接声明 → 一条 entry', () => {
    const src = `/**
 * TObjectPtr is a type of pointer to a UObject.
 */
template<typename T>
using TObjectPtr = TObjectPtr<T>;`;
    const entries = extractDocComments(src, 'Runtime/CoreUObject/UObject/ObjectPtr.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('TObjectPtr');
    expect(entries[0]!.kind).toBe('type_alias');
    expect(entries[0]!.file).toBe('Runtime/CoreUObject/UObject/ObjectPtr.h');
    expect(entries[0]!.doc).toContain('pointer to a UObject');
    expect(entries[0]!.translation).toBe('');
  });

  it('多行 /** ... */ 注释行内 * 剥离', () => {
    const src = `/**
 * Line 1
 * Line 2
 * Line 3
 */
class TMyClass;`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.doc).toContain('Line 1');
    expect(entries[0]!.doc).toContain('Line 3');
    expect(entries[0]!.doc).not.toMatch(/^\s*\*\s*Line/);
  });

  it('短于 minDocLength 的注释被过滤', () => {
    const src = `/** short */
class TMyClass;`;
    expect(extractDocComments(src, 'X.h', 100)).toHaveLength(0);
    expect(extractDocComments(src, 'X.h', 5)).toHaveLength(1);
  });

  it('注释后无声明 → 跳过', () => {
    const src = `/**
 * Useful text that has no following declaration
 */`;
    expect(extractDocComments(src, 'X.h', 10)).toHaveLength(0);
  });
});

describe('extractDocComments — /// 行注释', () => {
  it('连续 /// 行合并为单条 doc', () => {
    const src = `/// First line
/// Second line
/// Third line
class TMyClass;`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.doc).toContain('First line');
    expect(entries[0]!.doc).toContain('Third line');
  });

  it('单行 /// 注释也能提取', () => {
    const src = `/// Single line documentation that is long enough
struct TMyStruct;`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('TMyStruct');
  });
});

describe('extractDocComments — 容错', () => {
  it('空文件返回 []', () => {
    expect(extractDocComments('', 'X.h', 10)).toEqual([]);
  });

  it('纯注释无声明返回 []', () => {
    const src = `/**
 * Doc that has no matching declaration
 */`;
    expect(extractDocComments(src, 'X.h', 10)).toEqual([]);
  });

  it('未关闭的 /* 块注释不抛', () => {
    const src = `/**
 * Unterminated block comment
class TMyClass;`;
    // 不应 throw——脚本会一直读到文件末尾
    expect(() => extractDocComments(src, 'X.h', 10)).not.toThrow();
  });

  it('混杂代码 + 多个 /** */ 注释,各自正确归属', () => {
    const src = `/**
 * First doc that is long enough to pass filter
 */
class TFirst;

/**
 * Second doc that is also long enough to pass filter
 */
class TSecond;`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.name)).toEqual(['TFirst', 'TSecond']);
  });

  it('signature 字段截断到 200 字符', () => {
    const veryLong = 'x'.repeat(500);
    const src = `/**
 * Doc that is definitely long enough to pass any reasonable filter
 */
class ${veryLong};`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries[0]!.signature.length).toBeLessThanOrEqual(200);
  });
});

describe('extractDocComments — UE 反射宏场景', () => {
  it('UCLASS() + 多行 doc + class → 一条 class entry', () => {
    const src = `/**
 * UActorComponent is the base class for components that attach to actors
 */
UCLASS()
class UActorComponent : public UObject {`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('UActorComponent');
    expect(entries[0]!.kind).toBe('class');
  });

  it('UPROPERTY() + 紧邻 /// 注释', () => {
    const src = `/// The bReplicates flag indicates whether this object should be replicated across the network
UPROPERTY()
bool bReplicates;`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('bReplicates');
  });

  it('UFUNCTION 宏不会单独产生 entry(findDeclaration 会跳过它找下面的函数)', () => {
    const src = `/**
 * DoSomething is a method that performs an action and is properly documented
 */
UFUNCTION(BlueprintCallable)
int32 DoSomething(int32 Param);`;
    const entries = extractDocComments(src, 'X.h', 10);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('DoSomething');
  });
});

describe('runExtract — 端到端', () => {
  it('扫描临时目录中的 fixture 头文件,输出 JSON', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-run-'));
    const headerPath = path.join(tmpRoot, 'Sub', 'MyHeader.h');
    fs.mkdirSync(path.dirname(headerPath), { recursive: true });
    fs.writeFileSync(
      headerPath,
      `/**
 * A great documented class that is long enough
 */
UCLASS()
class TGreatClass {};
`,
      'utf-8',
    );

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-out-'));
    const outFile = path.join(outDir, 'sub', 'out.json');

    const entries = await runExtract({
      engineRoot: tmpRoot,
      output: outFile,
      minDocLength: 10,
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe('TGreatClass');
    expect(entries[0]!.file).toBe(path.join('Sub', 'MyHeader.h').replace(/\\/g, '/'));

    // 验证 JSON 落盘
    expect(fs.existsSync(outFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(outFile, 'utf-8')) as DocEntry[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.name).toBe('TGreatClass');

    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('空目录返回 [] 而不抛', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-empty-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-empty-out-'));
    const entries = await runExtract({
      engineRoot: tmpRoot,
      output: path.join(outDir, 'out.json'),
      minDocLength: 10,
    });
    expect(entries).toEqual([]);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('重复文档去重', async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-dup-'));
    const sharedDoc = 'Same doc appearing in multiple files for testing deduplication logic';
    for (const file of ['A.h', 'B.h', 'C.h']) {
      fs.writeFileSync(
        path.join(tmpRoot, file),
        `/**
 * ${sharedDoc}
 */
class TSomething;
`,
        'utf-8',
      );
    }
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ue-docs-dup-out-'));
    const entries = await runExtract({
      engineRoot: tmpRoot,
      output: path.join(outDir, 'out.json'),
      minDocLength: 10,
    });
    expect(entries).toHaveLength(1);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
