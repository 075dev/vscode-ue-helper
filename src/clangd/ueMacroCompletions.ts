/**
 * UE 反射宏补全纯上下文解析。
 *
 * 只判断光标所在区域并从数据模块取补全项，不注册 VS Code provider。
 */

import {
  MACRO_COMPLETIONS,
  META_COMPLETIONS,
  UE_REFLECTION_MACROS,
  type UeMacroCompletionItem,
  type UeReflectionMacro,
} from '@clangd/ueMacroCompletionData';

export { UE_REFLECTION_MACROS, type UeMacroCompletionItem, type UeReflectionMacro };

export type UeMacroCompletionContext =
  | { readonly kind: 'empty' }
  | { readonly kind: 'macroName'; readonly prefix: string }
  | { readonly kind: 'parameters'; readonly macro: UeReflectionMacro; readonly prefix: string }
  | { readonly kind: 'meta'; readonly macro: UeReflectionMacro; readonly prefix: string };

type ScanState = {
  readonly lineComment: boolean;
  readonly blockComment: boolean;
  readonly quote: string;
  readonly escaped: boolean;
};

type ScanStep = { readonly state: ScanState; readonly width: number };
type MacroOpening = { readonly macro: UeReflectionMacro; readonly openParen: number };

const EMPTY_CONTEXT: UeMacroCompletionContext = { kind: 'empty' };

export function getUeMacroCompletionContext(source: string, offset: number): UeMacroCompletionContext {
  if (offset < 0 || offset > source.length || isIgnoredAt(source, offset)) {
    return EMPTY_CONTEXT;
  }

  const macroName = getMacroNameContext(source, offset);
  if (macroName.kind !== 'empty') {
    return macroName;
  }

  const opening = findActiveMacroOpening(source, offset);
  if (!opening) {
    return EMPTY_CONTEXT;
  }

  const prefix = currentTokenPrefix(source, offset);
  if (isInsideMeta(source, opening.openParen + 1, offset)) {
    return { kind: 'meta', macro: opening.macro, prefix };
  }
  return { kind: 'parameters', macro: opening.macro, prefix };
}

export function getUeMacroCompletionItems(context: UeMacroCompletionContext): readonly UeMacroCompletionItem[] {
  switch (context.kind) {
    case 'empty':
      return [];
    case 'macroName':
      return UE_REFLECTION_MACROS
        .filter((macro) => macro.startsWith(context.prefix.toUpperCase()))
        .map((macro) => ({
          label: macro,
          insertText: `${macro}($1)`,
          detail: 'UEMacro',
          documentation: `UE 反射宏: ${macro}`,
        }));
    case 'parameters':
      return MACRO_COMPLETIONS[context.macro];
    case 'meta':
      return context.macro === 'UMETA' ? MACRO_COMPLETIONS.UMETA : META_COMPLETIONS;
    default:
      return assertNever(context);
  }
}

function getMacroNameContext(source: string, offset: number): UeMacroCompletionContext {
  const prefix = currentTokenPrefix(source, offset);
  if (prefix.length < 2 || !prefix.startsWith('U')) {
    return EMPTY_CONTEXT;
  }
  const normalized = prefix.toUpperCase();
  return UE_REFLECTION_MACROS.some((macro) => macro.startsWith(normalized))
    ? { kind: 'macroName', prefix }
    : EMPTY_CONTEXT;
}

function findActiveMacroOpening(source: string, offset: number): MacroOpening | undefined {
  const openings: MacroOpening[] = [];
  let state = initialState();
  let index = 0;
  while (index < offset) {
    if (isCode(state)) {
      const opening = readMacroOpening(source, index);
      if (opening) {
        openings.push(opening);
        index = opening.openParen + 1;
        continue;
      }
    }
    const step = scanStep(source, index, state);
    state = step.state;
    index += step.width;
  }

  for (let index = openings.length - 1; index >= 0; index -= 1) {
    const opening = openings[index];
    if (opening && parenDepth(source, opening.openParen, offset) > 0) {
      return opening;
    }
  }
  return undefined;
}

function readMacroOpening(source: string, index: number): MacroOpening | undefined {
  for (const macro of UE_REFLECTION_MACROS) {
    if (!source.startsWith(macro, index)) {
      continue;
    }
    const before = index > 0 ? source[index - 1] : undefined;
    const after = source[index + macro.length];
    if (isIdentifierChar(before) || isIdentifierChar(after)) {
      continue;
    }
    let cursor = index + macro.length;
    while (isHorizontalSpace(source[cursor])) {
      cursor += 1;
    }
    if (source[cursor] === '(') {
      return { macro, openParen: cursor };
    }
  }
  return undefined;
}

function isInsideMeta(source: string, start: number, offset: number): boolean {
  let state = initialState();
  let index = start;
  let metaOpen: number | undefined;
  while (index < offset) {
    if (isCode(state) && isMetaKeyword(source, index)) {
      const equals = nextNonSpace(source, index + 4, offset);
      const open = equals !== undefined && source[equals] === '=' ? nextNonSpace(source, equals + 1, offset) : undefined;
      if (open !== undefined && source[open] === '(') {
        metaOpen = open;
      }
    }
    const step = scanStep(source, index, state);
    state = step.state;
    index += step.width;
  }
  return metaOpen !== undefined && parenDepth(source, metaOpen, offset) > 0;
}

function isMetaKeyword(source: string, index: number): boolean {
  const before = index > 0 ? source[index - 1] : undefined;
  const after = source[index + 4];
  return source.startsWith('meta', index) && !isIdentifierChar(before) && !isIdentifierChar(after);
}

function nextNonSpace(source: string, start: number, end: number): number | undefined {
  for (let index = start; index < end; index += 1) {
    const char = source[index];
    if (char !== ' ' && char !== '\t' && char !== '\r' && char !== '\n') {
      return index;
    }
  }
  return undefined;
}

function parenDepth(source: string, openParen: number, offset: number): number {
  let state = initialState();
  let depth = 0;
  let index = openParen;
  while (index < offset) {
    if (isCode(state)) {
      const char = source[index];
      if (char === '(') {
        depth += 1;
      } else if (char === ')') {
        depth -= 1;
        if (depth <= 0) {
          return 0;
        }
      }
    }
    const step = scanStep(source, index, state);
    state = step.state;
    index += step.width;
  }
  return depth;
}

function isIgnoredAt(source: string, offset: number): boolean {
  let state = initialState();
  let index = 0;
  while (index < offset) {
    const step = scanStep(source, index, state);
    state = step.state;
    index += step.width;
  }
  return !isCode(state);
}

function scanStep(source: string, index: number, state: ScanState): ScanStep {
  const char = source[index] ?? '';
  const next = source[index + 1] ?? '';

  if (state.lineComment) {
    return char === '\n'
      ? { state: { ...state, lineComment: false }, width: 1 }
      : { state, width: 1 };
  }
  if (state.blockComment) {
    return char === '*' && next === '/'
      ? { state: { ...state, blockComment: false }, width: 2 }
      : { state, width: 1 };
  }
  if (state.quote) {
    if (state.escaped) {
      return { state: { ...state, escaped: false }, width: 1 };
    }
    if (char === '\\') {
      return { state: { ...state, escaped: true }, width: 1 };
    }
    return char === state.quote ? { state: { ...state, quote: '' }, width: 1 } : { state, width: 1 };
  }
  if (char === '/' && next === '/') {
    return { state: { ...state, lineComment: true }, width: 2 };
  }
  if (char === '/' && next === '*') {
    return { state: { ...state, blockComment: true }, width: 2 };
  }
  if (char === '"' || char === "'") {
    return { state: { ...state, quote: char }, width: 1 };
  }
  return { state, width: 1 };
}

function currentTokenPrefix(source: string, offset: number): string {
  let start = offset;
  while (start > 0 && isIdentifierChar(source[start - 1])) {
    start -= 1;
  }
  return source.slice(start, offset);
}

function isCode(state: ScanState): boolean {
  return !state.lineComment && !state.blockComment && state.quote === '';
}

function initialState(): ScanState {
  return { lineComment: false, blockComment: false, quote: '', escaped: false };
}

function isIdentifierChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9_]/.test(char);
}

function isHorizontalSpace(char: string | undefined): boolean {
  return char === ' ' || char === '\t';
}

function assertNever(value: never): never {
  throw new Error(`Unhandled UE macro context: ${JSON.stringify(value)}`);
}
