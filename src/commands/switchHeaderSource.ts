/**
 * switchHeaderSource —— 在 .h / .cpp 之间切换（UE 目录惯例感知）
 *
 * 背景问题：
 *   clangd 扩展的 clangd.switchSourceHeader（默认 Alt+O）在 UE 项目上经常切错：
 *   典型症状是从项目头文件切换跳到 Engine 的 ObjectMacros.h。
 *   根因是 clangd 的实现（HeaderSourceSwitch.cpp）按"主文件符号在索引中的
 *   Definition 位置"投票，平票取路径字典序最小者 —— UE 头文件符号定义分散、
 *   后台索引不完整时票源稀疏，Engine/Source/Runtime/CoreUObject/... 的路径
 *   字典序几乎最靠前，于是 ObjectMacros.h 屡屡胜出；本插件的预包含链
 *   （/FI compat 头 + preparse 列表 + addMacroCompletions.h 首条即
 *   ObjectMacros.h）又让引擎公共头在索引中高度富集，放大了该概率。
 *
 *   （这一点 clangd 上游也承认 —— 源码 FIXME：索引信息不足时应回退用
 *   AST/文件邻近性推断，但目前未实现。）
 *
 * 修复思路：
 *   不依赖索引，改用确定性的路径规则（UE 工程的文件摆放高度规整）：
 *     1. 同目录同 stem 互换扩展名（.h ↔ .cpp 等）
 *     2. UE 模块目录互换（保留子路径）：
 *          Public/<sub>/Foo.h  ↔  Private/<sub>/Foo.cpp
 *          Classes/<sub>/Foo.h ↔  Private|Public/<sub>/Foo.cpp
 *        对 Plugins/<Name>/Source/<Module>/Public|Private 同样成立
 *     3. UHT 产物 X.generated.h 视作 X 的头文件（剥 .generated 后再匹配）
 *     4. .inl 对应同 stem 的主头文件（.h 优先）
 *     5. 以上都找不到时，在 workspace 内按 stem 搜索（排除 Intermediate/
 *        Binaries/.vscode 等目录与 *.generated.*），多候选弹 QuickPick
 *
 * 快捷键绑定 Alt+O（when 含 editorLangId，比 clangd 的裸 editorTextFocus
 * 更具体，按 VSCode 规则优先命中）；与 clangd 冲突时用户可在键盘快捷方式
 * 中手动指定本命令。
 *
 * 结构：路径候选计算为纯函数（buildCounterpartCandidates）便于单测；
 * 执行层（executeSwitchHeaderSource）依赖可注入便于测试。
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { t } from '@i18n';
import {
  okEnvelope,
  errEnvelope,
  EC_PROJECT_NOT_DETECTED,
  EC_OPERATION_CANCELLED,
  EC_INTERNAL_ERROR,
  type Envelope,
} from '@core/envelope';
import { type Logger } from '@core/logger';

/** 文件归类：头文件侧 / 源文件侧 */
export type CounterpartSide = 'header' | 'source';

/** 头文件侧扩展名（.inl 归头侧，但对应目标为主 .h） */
const HEADER_EXTS = ['.h', '.hpp', '.hh', '.hxx', '.inl'];
/** 源文件侧扩展名 */
const SOURCE_EXTS = ['.cpp', '.cc', '.cxx', '.c', '.m', '.mm'];

/** UE 模块内目录互换表：key 目录 → 按优先级尝试的互换目录 */
const UE_DIR_SWAPS: Readonly<Record<string, readonly string[]>> = {
  Public: ['Private', 'Classes'],
  Private: ['Public'],
  Classes: ['Private', 'Public'],
};

/** stem → 目标扩展名集合（.inl 特殊：优先主头文件） */
function targetExts(side: CounterpartSide, fromExt: string): string[] {
  if (side === 'header') {
    // .inl → 主头文件 .h/.hpp；其余头 → 源扩展（.cpp 最常见放最前）
    return fromExt === '.inl' ? ['.h', '.hpp'] : ['.cpp', '.cc', '.cxx', '.c'];
  }
  return ['.h', '.hpp', '.hh', '.hxx'];
}

/**
 * 归类 C++ 文件。返回 'header' | 'source'；非 C++ 源/头文件返回 null。
 * Foo.generated.h 归 'header'。
 */
export function classifyCppFile(fileName: string): CounterpartSide | null {
  const ext = path.extname(fileName).toLowerCase();
  if (HEADER_EXTS.includes(ext)) {
    return 'header';
  }
  if (SOURCE_EXTS.includes(ext)) {
    return 'source';
  }
  return null;
}

/**
 * 拆出"逻辑 stem"：剥扩展名 + 剥 .generated 后缀。
 *   MyActor.h              → { stem: 'MyActor', isGenerated: false }
 *   MyActor.generated.h    → { stem: 'MyActor', isGenerated: true }
 * 非 C++ 源/头文件返回 null。
 */
export function splitCppStem(fileName: string): {
  stem: string;
  isGenerated: boolean;
} | null {
  const side = classifyCppFile(fileName);
  if (!side) {
    return null;
  }
  let stem = fileName;
  let ext = path.extname(stem).toLowerCase();
  stem = stem.slice(0, stem.length - ext.length);
  let isGenerated = false;
  if (path.extname(stem).toLowerCase() === '.generated') {
    stem = stem.slice(0, stem.length - '.generated'.length);
    isGenerated = true;
  }
  ext = path.extname(stem).toLowerCase();
  return { stem: path.basename(stem), isGenerated };
}

/**
 * 基于当前文件路径生成有序的对应文件候选（纯路径计算，不查磁盘）。
 *
 * 顺序即优先级：
 *   1. 同目录同 stem + 目标扩展（多扩展按 targetExts 顺序）
 *   2. UE 目录互换（最后一个 Public/Private/Classes 段替换，保留子路径）
 *      每个互换目录 × 每个目标扩展
 *
 * 返回绝对路径数组（可能有重复段，调用方按顺序找第一个存在的即可）。
 */
export function buildCounterpartCandidates(filePath: string): string[] {
  const fileName = path.basename(filePath);
  const side = classifyCppFile(fileName);
  if (!side) {
    return [];
  }
  const fromExt = path.extname(fileName).toLowerCase();
  const exts = targetExts(side, fromExt);
  // X.generated.h 属头侧但目标扩展补上 .h/.hpp（同 stem 主头文件也是合理落点）
  const stemInfo = splitCppStem(fileName);
  const allExts = stemInfo?.isGenerated && side === 'header' ? [...exts, '.h', '.hpp'] : exts;
  const dir = path.dirname(filePath);

  const candidates: string[] = [];
  const stemWithGenerated = (name: string): string => {
    const parsed = splitCppStem(name);
    // classifyCppFile 已过滤，这里必然非 null；防御性回退用原文件 stem
    return parsed ? parsed.stem : path.basename(name, fromExt);
  };
  const push = (d: string): void => {
    for (const ext of allExts) {
      candidates.push(path.join(d, `${stemWithGenerated(fileName)}${ext}`));
    }
  };

  // 1. 同目录
  push(dir);

  // 2. UE 目录互换：找最后一个可互换段（Plugins/<P>/Source/<M>/Public/... 中
  //    模块内只有一个，取最后一个避免误伤同名上层目录）
  const segments = dir.split(path.sep);
  let swapIdx = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg !== undefined && UE_DIR_SWAPS[seg]) {
      swapIdx = i;
      break;
    }
  }
  const swapSeg = swapIdx >= 0 ? segments[swapIdx] : undefined;
  const swapAlts = swapSeg !== undefined ? UE_DIR_SWAPS[swapSeg] : undefined;
  if (swapIdx !== -1 && swapAlts) {
    const tail = segments.slice(swapIdx + 1);
    for (const alt of swapAlts) {
      push([...segments.slice(0, swapIdx), alt, ...tail].join(path.sep));
    }
  }

  return candidates;
}

/** workspace 搜索时排除的目录（UBT 产物/编辑器缓存，绝不可能是切换目标） */
const SEARCH_EXCLUDE =
  '**/{Intermediate,Binaries,Saved,DerivedDataCache,.vscode,.git,node_modules}/**';

/** 依赖注入接口（测试用；默认实现走 fs / vscode API） */
export interface SwitchDeps {
  fileExists(p: string): Promise<boolean>;
  /** workspace 内按 stem 搜索指定侧的文件，返回绝对路径（已排除当前文件） */
  searchCounterparts(stem: string, targets: CounterpartSide[]): Promise<string[]>;
  openFile(p: string): Promise<unknown>;
  /** 多候选选择；返回 undefined 表示用户取消 */
  pick(items: string[], currentFile: string): Promise<string | undefined>;
  notify(msg: string): void;
}

function defaultDeps(): SwitchDeps {
  return {
    async fileExists(p) {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
    async searchCounterparts(stem, targets) {
      // stem 含 glob 特殊字符时放弃搜索（UE 类名不会出现，防御即可）
      if (!/^[A-Za-z0-9_]+$/.test(stem)) {
        return [];
      }
      const exts = targets.flatMap((side) => (side === 'source' ? SOURCE_EXTS : HEADER_EXTS));
      const found: string[] = [];
      for (const ext of exts) {
        const uris = await vscode.workspace.findFiles(`**/${stem}${ext}`, SEARCH_EXCLUDE, 50);
        for (const uri of uris) {
          const p = uri.fsPath;
          // 排除 UHT 产物（含 stub）与自身
          if (/\.generated\.[^.]+$/.test(path.basename(p))) {
            continue;
          }
          found.push(p);
        }
      }
      // 路径浅的优先（模块根附近的定义文件比深层更可能是目标）
      return found.sort((a, b) => a.split(path.sep).length - b.split(path.sep).length);
    },
    async openFile(p) {
      return vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
    },
    async pick(items) {
      const rel = items.map((p) => ({ label: path.basename(p), description: p }));
      const picked = (await vscode.window.showQuickPick(rel, {
        placeHolder: t('cmd.switchHeaderSource.pickPlaceholder'),
      })) as { description?: string } | undefined;
      return picked?.description;
    },
    notify(msg) {
      void vscode.window.showInformationMessage(msg);
    },
  };
}

/**
 * 执行切换命令。
 *
 * @param editor 可注入编辑器（测试用）；默认当前活动编辑器
 * @param logger 可选日志器
 * @param deps 可注入依赖（测试用）
 * @returns 契约 envelope:成功 `okEnvelope({ opened }, summary)`;
 *          失败按错误码映射(无配对 → PROJECT_NOT_DETECTED 为最接近项、
 *          QuickPick 取消 → OPERATION_CANCELLED、兜底 → INTERNAL_ERROR)
 */
export async function executeSwitchHeaderSource(
  editor?: vscode.TextEditor,
  logger?: Logger,
  deps: SwitchDeps = defaultDeps(),
): Promise<Envelope> {
  try {
    const active = editor ?? vscode.window.activeTextEditor;
    const filePath = active?.document.uri.fsPath;
    if (!active || !filePath) {
      deps.notify(t('cmd.switchHeaderSource.noEditor'));
      // [契约对齐] 无编辑器属调用异常,9 项枚举无贴切码 → 兜底 INTERNAL_ERROR(登记缺口)
      return errEnvelope(EC_INTERNAL_ERROR, t('cmd.switchHeaderSource.noEditor'));
    }

    const fileName = path.basename(filePath);
    const side = classifyCppFile(fileName);
    if (!side) {
      deps.notify(t('cmd.switchHeaderSource.unsupported', { name: fileName }));
      // [契约对齐] 非源/头文件,9 项枚举无贴切码 → 兜底 INTERNAL_ERROR(登记缺口)
      return errEnvelope(
        EC_INTERNAL_ERROR,
        t('cmd.switchHeaderSource.unsupported', { name: fileName }),
        { file: fileName },
      );
    }
    const target: CounterpartSide = side === 'header' ? 'source' : 'header';

    // 1. 确定性候选：第一个真实存在的直接打开
    const candidates = buildCounterpartCandidates(filePath);
    for (const candidate of candidates) {
      if (path.resolve(candidate) === path.resolve(filePath)) {
        continue;
      }
      if (await deps.fileExists(candidate)) {
        await deps.openFile(candidate);
        return okEnvelope({ opened: candidate }, '已打开对应文件');
      }
    }

    // 2. 规则未命中 → workspace 同 stem 搜索
    const stemInfo = splitCppStem(fileName);
    if (!stemInfo) {
      return errEnvelope(
        EC_INTERNAL_ERROR,
        t('cmd.switchHeaderSource.unsupported', { name: fileName }),
        { file: fileName },
      );
    }
    // UHT 产物 X.generated.h：X.h 与 X.cpp 都可能想去，双侧都搜；
    // 普通文件只搜对侧。
    const searchTargets: CounterpartSide[] = stemInfo.isGenerated ? ['header', 'source'] : [target];
    const found = (await deps.searchCounterparts(stemInfo.stem, searchTargets)).filter(
      (p) => path.resolve(p) !== path.resolve(filePath),
    );
    if (found.length === 0) {
      deps.notify(t('cmd.switchHeaderSource.notFound', { name: fileName }));
      // [契约对齐] 无对应头/源配对 → 契约 404 语义;9 项枚举无贴切码,
      // 选最接近的 PROJECT_NOT_DETECTED 并在完成报告登记缺口
      return errEnvelope(
        EC_PROJECT_NOT_DETECTED,
        t('cmd.switchHeaderSource.notFound', { name: fileName }),
        { file: fileName },
      );
    }
    if (found.length === 1 && found[0] !== undefined) {
      await deps.openFile(found[0]);
      return okEnvelope({ opened: found[0] }, '已打开对应文件');
    }
    const picked = await deps.pick(found, filePath);
    if (!picked) {
      // [契约对齐] 用户取消 QuickPick → OPERATION_CANCELLED
      return errEnvelope(EC_OPERATION_CANCELLED, '已取消选择对应文件');
    }
    await deps.openFile(picked);
    logger?.info(`[switchHeaderSource] picked ${picked} among ${found.length} candidates`);
    return okEnvelope({ opened: picked }, '已打开对应文件');
  } catch (err) {
    // [契约对齐] 函数出口统一 catch:意外异常包装为 INTERNAL_ERROR envelope
    const msg = err instanceof Error ? err.message : String(err);
    logger?.error('[switchHeaderSource] unexpected error:', msg);
    return errEnvelope(EC_INTERNAL_ERROR, msg);
  }
}
