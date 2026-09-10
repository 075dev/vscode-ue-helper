/**
 * UE 反射宏 VS Code 补全 provider。
 *
 * 该模块只负责把 T5 的纯上下文解析结果映射为 VS Code
 * CompletionItem/SnippetString，并限制触发语言为 C/C++/头文件。
 */

import * as vscode from 'vscode';
import { getUeMacroCompletionContext, getUeMacroCompletionItems } from '@clangd/ueMacroCompletions';
import type { UeMacroCompletionItem } from '@clangd/ueMacroCompletions';

const CXX_LANGUAGE_IDS = ['cpp', 'c', 'h', 'hpp'] as const;
const TRIGGER_CHARACTERS = ['U', '(', ',', '='] as const;

export function registerUeMacroCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    CXX_LANGUAGE_IDS.map((language) => ({ language, scheme: 'file' })),
    new UeMacroCompletionProvider(),
    ...TRIGGER_CHARACTERS,
  );
}

class UeMacroCompletionProvider implements vscode.CompletionItemProvider<vscode.CompletionItem> {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.ProviderResult<vscode.CompletionItem[]> {
    if (!isCxxLanguage(document.languageId)) {
      return [];
    }

    const offset = document.offsetAt(position);
    const context = getUeMacroCompletionContext(document.getText(), offset);
    return getUeMacroCompletionItems(context).map(toCompletionItem);
  }
}

function toCompletionItem(source: UeMacroCompletionItem): vscode.CompletionItem {
  const item = new vscode.CompletionItem(source.label, vscode.CompletionItemKind.Property);
  item.insertText = new vscode.SnippetString(source.insertText);
  item.detail = source.detail;
  item.documentation = new vscode.MarkdownString(source.documentation);
  return item;
}

function isCxxLanguage(languageId: string): boolean {
  return CXX_LANGUAGE_IDS.some((candidate) => candidate === languageId);
}
