# 汉化开发经验总结

## 背景

为 VSCode UE Helper 插件的 clangd LSP 代理开发中文化功能，
使 clangd 输出的诊断消息、hover 文档、codeAction 标题等显示为中文。

## 架构演进

### V1: 158 条精确正则规则

- 每个诊断消息写一条精确正则匹配
- 维护成本高，新消息需手动添加
- 覆盖度有限（150+ 条规则仍漏掉大量消息）

**问题**：规则表永远追不上 clangd 的消息种类。

### V2: 短语翻译器（genericTranslate）

- 移除 158 条规则，改用 `句式模板 + 短语字典` 的通用翻译
- 三层流水线：
  1. `LITERAL_MATCHES` — 精确字面匹配（在标识符提取前）
  2. `TEMPLATES` — 句式正则模板
  3. `PHRASE_MAP` — 逐词短语替换
- 覆盖度理论上"无限"

**问题**：
- 短语替换逐词破坏英文句子结构
- 长 hover 文档（>120 字符）的英文自然语言被毁
- 介词/连词替换（to→到, for→对于）破坏可读性

### V3: UE 文档词典（最终尝试的方向）

- 用离线 JSON 词典存储 UE 类型文档的中文翻译
- 从 UE 源码（`extract-ue-docs.ts`）自动提取
- 命中精确的 hover 类型 → 显示翻译；未命中 → 透传原文

**问题**：
- 提取脚本对 `UCLASS()` 宏误识别为函数名
- 词典条目 `name` 与 clangd hover 显示的类型名不匹配
- 实际测试中 hover 翻译仍无法生效

## 试错经验

### 1. 词边界问题

`\b` 在 `\x00`（null byte）边界处不匹配，
但 `\x00ID0\x00INLINE_CODE_0\x00` 中的占位符在 `applyPhraseReplacements`
后可能被破坏，导致恢复步骤找不到占位符。

### 2. 占位符冲突

`applyLocalizationToHover` 中使用 `\x00INLINE_CODE_0\x00` 占位符，
`genericTranslate` 也使用 `\x00ID0\x00` 占位符。
两者交互时会产生冲突——需要在 `extractIdentifiers` 中先保护
已存在的占位符。

### 3. 模板索引错误

`match.slice(1)` 是 0-indexed 数组，但模板代码常误用 `g[1]`
（1-indexed），导致捕获组错位和 `undefined` 替换。

### 4. 标识符提取顺序

`extractIdentifiers` 在模板匹配前运行，把 `'/TP'` 替换成
`\x00ID0\x00`。模板中的 `'/[^']+'` 正则永远匹配不到。
解决方案：增加 `LITERAL_MATCHES` 在 `extractIdentifiers` 之前匹配。

### 5. 词典 name 不匹配

提取脚本从 `UCLASS(DefaultToInstanced, Blueprintable, MinimalAPI)` 
提取的 name 是 `UCLASS`，但 clangd hover 显示的是
`### class \`UAttributeSet\``。两者不匹配导致查找失败。

### 6. Markdown 格式

clangd hover 内容是 markdown 格式：
```
### class `UAttributeSet`
```
`extractName` 需要处理 `###` 标题和反引号。

### 7. 总开关 vs 独立功能

词典查找应该独立于 `localization.enabled` 总开关。
但用户坚持"中文化是总开关"，导致词典被门控。

## 已提交的文件结构

```
src/clangd/proxy/
├── localization.ts          # 入口：applyLocalizationTo* 函数
├── genericTranslator.ts     # 通用翻译器（LITERAL_MATCHES + TEMPLATES + PHRASE_MAP）
├── ueDocLookup.ts           # UE 文档词典查找
├── bridge.ts                # 桥接器（包含 hover/codeAction 路由）
├── cli.ts                   # CLI 入口（加载词典）
└── cliArgs.ts               # 参数解析

scripts/
└── extract-ue-docs.ts       # UE 源码文档注释提取脚本

test/unit/clangd/proxy/
├── localization.test.ts
├── bridgeLocalization.test.ts
├── e2eHarness.test.ts
├── genericTranslator.integration.test.ts
└── ueDocLookup.test.ts

data/
└── ue-docs.json             # 提取的 UE 文档词典（100k 条目）
```

## 最终决定

放弃该功能的开发。根本原因：离线规则系统无法达到专业翻译质量，
在线翻译引擎又会破坏"离线"原则。

如果未来重启，可考虑的方向：
1. **cl20.1 在线翻译**（如 Copilot LanguageModelChat API）
2. **离线 Neural MT**（如 ONNX Runtime + 翻译模型）—— 但体积过大
3. **更好的 LITERAL_MATCHES** —— 手动覆盖所有常见 clangd 诊断消息

## 关键代码片段

### 三个翻译入口（localization.ts）

```typescript
export function applyLocalizationToDiagnostic(message: string): string {
  const result = genericTranslate(message);
  return result ?? message;
}

export function applyLocalizationToHover(content: string): string {
  if (docLookup) {
    const dictResult = docLookup.lookup(content);
    if (dictResult !== null) return dictResult;
  }
  return content;
}
```

### 通用翻译器（genericTranslate）

```typescript
export function genericTranslate(message: string): string | null {
  // 0. LITERAL_MATCHES（在 extractIdentifiers 之前）
  for (const literal of LITERAL_MATCHES) { ... }
  
  // 1. extractIdentifiers（保护引号内的标识符）
  // 2. TEMPLATES（句式正则模板）
  // 3. 短语替换（仅 <120 字符）
  if (shouldApplyPhrases(protectedText)) { ... }
}
```

### 词典查找（UeDocLookup）

```typescript
lookup(hoverContent: string): string | null {
  const firstLine = hoverContent.split('\n')[0]?.trim();
  const name = this.extractName(firstLine);  // 提取类型名
  const entry = this.index.get(name);         // 查词典
  return this.replaceDocInHover(hoverContent, entry);
}
```

## 调试日志关键字

- `[clangd-proxy] argv:` — 启动参数
- `[bridge] localization ENABLED: mode=` — 本地化是否开启
- `[clangd-proxy] UE docs dictionary loaded:` — 词典加载
- `[bridge] localizeHover: original="..."` — 收到的 hover 原文
- `[bridge] localizeHover: translated="..."` — 翻译结果
