/**
 * switchHeaderSource 测试 —— UE 惯例感知的源/头切换
 *
 * 覆盖:
 *   - classifyCppFile / splitCppStem 纯函数
 *   - buildCounterpartCandidates: 同目录互换 / Public↔Private↔Classes 目录互换 /
 *     Plugins 模块路径 / .generated.h / .inl / 无可互换目录段
 *   - executeSwitchHeaderSource(依赖注入): 无编辑器 / 非 C++ 文件 / 候选命中 /
 *     搜索唯一命中 / 多候选 QuickPick / 完全找不到
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  classifyCppFile,
  splitCppStem,
  buildCounterpartCandidates,
  executeSwitchHeaderSource,
  type SwitchDeps,
} from '@commands/switchHeaderSource';

// 路径断言统一用 path.join 适配当前平台分隔符(arrow 包装以满足 unbound-method)
const j = (...segments: string[]): string => path.join(...segments);

describe('classifyCppFile', () => {
  it('头文件扩展 → header', () => {
    expect(classifyCppFile('Foo.h')).toBe('header');
    expect(classifyCppFile('Foo.HPP')).toBe('header');
    expect(classifyCppFile('Foo.hh')).toBe('header');
    expect(classifyCppFile('Foo.hxx')).toBe('header');
    expect(classifyCppFile('Foo.inl')).toBe('header');
  });

  it('源文件扩展 → source', () => {
    expect(classifyCppFile('Foo.cpp')).toBe('source');
    expect(classifyCppFile('Foo.CC')).toBe('source');
    expect(classifyCppFile('Foo.cxx')).toBe('source');
    expect(classifyCppFile('Foo.c')).toBe('source');
  });

  it('非 C++ 文件 → null', () => {
    expect(classifyCppFile('Foo.txt')).toBeNull();
    expect(classifyCppFile('Foo.cs')).toBeNull();
    expect(classifyCppFile('Foo.build.cs')).toBeNull();
    expect(classifyCppFile('noext')).toBeNull();
  });
});

describe('splitCppStem', () => {
  it('普通头/源 → 剥扩展名', () => {
    expect(splitCppStem('MyActor.h')).toEqual({ stem: 'MyActor', isGenerated: false });
    expect(splitCppStem('MyActor.cpp')).toEqual({ stem: 'MyActor', isGenerated: false });
  });

  it('UHT 产物 → 剥 .generated 后缀', () => {
    expect(splitCppStem('MyActor.generated.h')).toEqual({
      stem: 'MyActor',
      isGenerated: true,
    });
  });

  it('非 C++ 文件 → null', () => {
    expect(splitCppStem('MyModule.Build.cs')).toBeNull();
  });
});

describe('buildCounterpartCandidates', () => {
  it('Private 中的 .cpp → 同目录 .h + Public 互换 .h（按优先级排序）', () => {
    const cpp = j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.cpp');
    expect(buildCounterpartCandidates(cpp)).toEqual([
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.h'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.hpp'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.hh'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.hxx'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.h'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.hpp'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.hh'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.hxx'),
    ]);
  });

  it('Public 子目录中的 .h → Private/Classes 互换且保留子路径', () => {
    const h = j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Widgets', 'MyWidget.h');
    const got = buildCounterpartCandidates(h);
    // 同目录优先（.cpp 最常见）
    expect(got[0]).toBe(j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Widgets', 'MyWidget.cpp'));
    // 其次 Private/Widgets、Classes/Widgets
    expect(got).toContain(
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Widgets', 'MyWidget.cpp'),
    );
    expect(got).toContain(
      j('D:', 'Proj', 'Source', 'MyGame', 'Classes', 'Widgets', 'MyWidget.cpp'),
    );
  });

  it('Classes 中的 .h → Private 优先于 Public', () => {
    const h = j('D:', 'Proj', 'Source', 'MyGame', 'Classes', 'Foo.h');
    const got = buildCounterpartCandidates(h);
    const privIdx = got.findIndex((p) => p.includes(`${path.sep}Private${path.sep}`));
    const pubIdx = got.findIndex((p) => p.includes(`${path.sep}Public${path.sep}`));
    expect(privIdx).toBeGreaterThan(-1);
    expect(privIdx).toBeLessThan(pubIdx);
  });

  it('插件模块路径同样成立', () => {
    const h = j('D:', 'Proj', 'Plugins', 'MyPlug', 'Source', 'MyMod', 'Public', 'Comp.h');
    const got = buildCounterpartCandidates(h);
    expect(got).toContain(
      j('D:', 'Proj', 'Plugins', 'MyPlug', 'Source', 'MyMod', 'Private', 'Comp.cpp'),
    );
  });

  it('多个同名目录段时取最后一个（模块内）', () => {
    const h = j('D:', 'Proj', 'Source', 'Public', 'Extra', 'Public', 'Foo.h');
    const got = buildCounterpartCandidates(h);
    expect(got).toContain(j('D:', 'Proj', 'Source', 'Public', 'Extra', 'Private', 'Foo.cpp'));
    // 不应出现替换第一个 Public 段的候选
    expect(got).not.toContain(j('D:', 'Proj', 'Source', 'Private', 'Extra', 'Public', 'Foo.cpp'));
  });

  it('X.generated.h 候选同时含 .cpp 与 .h（剥 .generated）', () => {
    const gen = j('D:', 'Proj', 'Intermediate', 'UHT', 'MyActor.generated.h');
    const got = buildCounterpartCandidates(gen);
    expect(got).toContain(j('D:', 'Proj', 'Intermediate', 'UHT', 'MyActor.cpp'));
    expect(got).toContain(j('D:', 'Proj', 'Intermediate', 'UHT', 'MyActor.h'));
  });

  it('.inl → 主头文件 .h/.hpp', () => {
    const inl = j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.inl');
    expect(buildCounterpartCandidates(inl)).toEqual([
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.h'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.hpp'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.h'),
      j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.hpp'),
    ]);
  });

  it('无可互换目录段 → 仅同目录候选', () => {
    const h = j('D:', 'Anywhere', 'Foo.h');
    const got = buildCounterpartCandidates(h);
    expect(got).toEqual([
      j('D:', 'Anywhere', 'Foo.cpp'),
      j('D:', 'Anywhere', 'Foo.cc'),
      j('D:', 'Anywhere', 'Foo.cxx'),
      j('D:', 'Anywhere', 'Foo.c'),
    ]);
  });

  it('非 C++ 文件 → 空数组', () => {
    expect(buildCounterpartCandidates(j('D:', 'x', 'Foo.txt'))).toEqual([]);
  });
});

describe('executeSwitchHeaderSource', () => {
  /** 组装注入依赖:exists 集合 / search 结果 / pick 返回值全程可编程 */
  function makeDeps(opts: { exists?: string[]; search?: string[]; pick?: string }) {
    const exists = new Set((opts.exists ?? []).map((p) => path.resolve(p)));
    const opened: string[] = [];
    const notified: string[] = [];
    const deps: SwitchDeps = {
      fileExists(p) {
        return Promise.resolve(exists.has(path.resolve(p)));
      },
      searchCounterparts() {
        return Promise.resolve(opts.search ?? []);
      },
      openFile(p) {
        opened.push(p);
        return Promise.resolve(undefined);
      },
      pick() {
        return Promise.resolve(opts.pick);
      },
      notify(msg) {
        notified.push(msg);
      },
    };
    return { deps, opened, notified };
  }

  function editorWith(file: string) {
    return { document: { uri: { fsPath: file } } } as unknown as vscode.TextEditor;
  }

  beforeEach(() => {
    vi.mocked(vscode.window.showInformationMessage).mockClear();
  });

  it('无活动编辑器 → 提示并返回 INTERNAL_ERROR envelope', async () => {
    (vscode.window.activeTextEditor as unknown) = undefined;
    const { deps, notified } = makeDeps({});
    const res = await executeSwitchHeaderSource(undefined, undefined, deps);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INTERNAL_ERROR');
    expect(notified.length).toBe(1);
  });

  it('非 C++ 文件 → 提示 unsupported', async () => {
    const { deps, notified } = makeDeps({});
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'MyModule.Build.cs')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('INTERNAL_ERROR');
    expect(res.error?.message).toContain('Build.cs');
    expect(notified[0]).toContain('Build.cs');
  });

  it('Public 头 + Private cpp 存在 → 直接打开（不经搜索）', async () => {
    const cpp = j('D:', 'Proj', 'Source', 'MyGame', 'Private', 'Foo.cpp');
    const { deps, opened } = makeDeps({ exists: [cpp] });
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.h')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.error).toBeUndefined();
    expect(res.data).toEqual({ opened: cpp });
    expect(opened).toEqual([cpp]);
  });

  it('确定性候选全缺失 + 搜索唯一命中 → 打开搜索结果', async () => {
    const cpp = j('D:', 'Proj', 'Source', 'Other', 'Foo.cpp');
    const { deps, opened } = makeDeps({ search: [cpp] });
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.h')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ opened: cpp });
    expect(opened).toEqual([cpp]);
  });

  it('多候选 → QuickPick 选择后打开', async () => {
    const a = j('D:', 'Proj', 'Source', 'A', 'Foo.cpp');
    const b = j('D:', 'Proj', 'Source', 'B', 'Foo.cpp');
    const { deps, opened } = makeDeps({ search: [a, b], pick: b });
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.h')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ opened: b });
    expect(opened).toEqual([b]);
  });

  it('多候选但用户取消 → OPERATION_CANCELLED envelope', async () => {
    const a = j('D:', 'Proj', 'Source', 'A', 'Foo.cpp');
    const { deps, opened } = makeDeps({
      search: [a, j('D:', 'Proj', 'Source', 'B', 'Foo.cpp')],
      pick: undefined,
    });
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Foo.h')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('OPERATION_CANCELLED');
    expect(opened).toEqual([]);
  });

  it('候选与搜索均无 → 提示 notFound + PROJECT_NOT_DETECTED envelope(404 语义)', async () => {
    const { deps, notified } = makeDeps({});
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'Lonely.h')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('PROJECT_NOT_DETECTED');
    expect(res.error?.message).toContain('Lonely.h');
    expect(notified[0]).toContain('Lonely.h');
  });

  it('.generated.h → 搜索双侧（含 .h 主头文件）', async () => {
    const header = j('D:', 'Proj', 'Source', 'MyGame', 'Public', 'MyActor.h');
    let searchedTargets: string[] | undefined;
    const deps: SwitchDeps = {
      fileExists() {
        return Promise.resolve(false);
      },
      searchCounterparts(_stem, targets) {
        searchedTargets = targets;
        return Promise.resolve([header]);
      },
      openFile(p) {
        expect(p).toBe(header);
        return Promise.resolve(undefined);
      },
      pick() {
        return Promise.resolve(undefined);
      },
      notify() {
        /* noop */
      },
    };
    const res = await executeSwitchHeaderSource(
      editorWith(j('D:', 'Proj', 'Intermediate', 'UHT', 'MyActor.generated.h')),
      undefined,
      deps,
    );
    expect(res.ok).toBe(true);
    expect(searchedTargets).toEqual(['header', 'source']);
  });
});
