/**
 * genericTranslator.ts —— 通用 clang 诊断消息翻译器
 *
 * 思路：clang 诊断消息有固定的句式结构，不需要每条消息精确匹配。
 * 通过解析句式 + 保护代码引用 + 短语字典，实现通用翻译。
 *
 * 句式示例：
 *   "cannot initialize a variable of type 'T' with an lvalue of type 'U'"
 *     → cannot [动作] [细节] → "无法[动作][细节]"
 *
 *   "no matching function for call to 'Foo'"
 *     → no [名词] [介词] [引用] → "没有[引用]的[名词]"
 *
 *   "'Foo' is not a member of 'Bar'"
 *     → [引用] is not [分类] → "[引用]不是[分类]"
 *
 *   "expected ';' at end of declaration"
 *     → expected [期望物] [位置] → "期望[期望物][位置]"
 *
 * 设计原则：
 * - 保护所有引号/反引号中的代码标识符（不翻译内部内容）
 * - 只翻译句式结构和通用词汇
 * - 作为 fallback，在精确规则未命中时使用
 */

/** 句式模板：匹配 clang 诊断的语法结构 */
interface SentenceTemplate {
  /** 正则匹配句式 */
  pattern: RegExp;
  /** 翻译函数，接收匹配组和受保护的标识符列表 */
  translate: (groups: string[], identifiers: string[]) => string;
}

// ===== 通用短语字典 =====

const PHRASE_MAP: Record<string, string> = {
  // 动词短语
  cannot: '无法',
  'could not': '无法',
  'does not': '不',
  'do not': '不要',
  'did not': '没有',
  'is not': '不是',
  'are not': '不是',
  'was not': '没有',
  'were not': '没有',
  'has not': '没有',
  'have not': '没有',
  'will not': '不会',
  'must not': '不得',
  'may not': '可能不',

  // 常见动词
  initialize: '初始化',
  convert: '转换',
  assign: '赋值',
  declare: '声明',
  define: '定义',
  allocate: '分配',
  bind: '绑定',
  capture: '捕获',
  match: '匹配',
  deduce: '推导',
  substitute: '替换',
  resolve: '解析',
  overload: '重载',
  override: '覆盖',
  call: '调用',
  return: '返回',
  delete: '删除',
  create: '创建',
  construct: '构造',
  destruct: '析构',
  inherit: '继承',
  access: '访问',
  use: '使用',
  find: '查找',
  variable: '变量',
  type: '类型',
  class: '类',
  struct: '结构体',
  union: '联合体',
  namespace: '命名空间',
  template: '模板',
  member: '成员',
  field: '字段',
  parameter: '参数',
  argument: '实参',
  value: '值',
  reference: '引用',
  pointer: '指针',
  array: '数组',
  object: '对象',
  expression: '表达式',
  statement: '语句',
  declaration: '声明',
  definition: '定义',
  initializer: '初始化器',
  constructor: '构造函数',
  destructor: '析构函数',
  operator: '运算符',
  conversion: '转换',
  identifier: '标识符',
  symbol: '符号',
  name: '名称',
  scope: '作用域',
  context: '上下文',

  // 限定词
  const: '常量',
  constexpr: '编译时常量',
  static: '静态',
  virtual: '虚',
  abstract: '抽象',
  inline: '内联',
  explicit: '显式',
  implicit: '隐式',
  mutable: '可变',
  volatile: '易变',
  public: '公有',
  private: '私有',
  protected: '保护',

  // 介词/连接词
  of: '的',
  in: '在',
  on: '在',
  at: '在',
  to: '到',
  from: '从',
  with: '用',
  by: '通过',
  for: '对于',
  as: '作为',
  into: '为',
  between: '之间',
  through: '通过',
  without: '没有',
  within: '在之内',
  about: '关于',

  // 名词（补充）
  attribute: '属性',
  compilation: '编译',
  enumerator: '枚举值',
  lambda: 'lambda',
  linker: '链接器',
  lvalue: '左值',
  modifier: '修饰符',
  nonstandard: '非标准',
  optimization: '优化',
  pragma: 'pragma',
  precision: '精度',
  qualifier: '限定符',
  redefinition: '重定义',
  rvalue: '右值',
  specifier: '说明符',
  temporary: '临时对象',
  Returns: '返回值',
  Parameters: '参数',

  // 关键词
  expected: '期望',
  missing: '缺少',
  invalid: '无效',
  unknown: '未知',
  ambiguous: '有歧义',
  redundant: '冗余',
  duplicate: '重复',
  conflicting: '冲突',
  incompatible: '不兼容',
  unsupported: '不支持',
  deprecated: '已弃用',
  unused: '未使用',
  undeclared: '未声明',
  undefined: '未定义',
  incomplete: '不完整',
};

// ===== 句式模板 =====

const TEMPLATES: SentenceTemplate[] = [
  // "cannot X [details]" → "无法 X [details]"
  {
    pattern: /^cannot\s+(.+)$/i,
    translate: (g) => `无法${g[1]}`,
  },

  // "expected X [context]" → "期望 X [context]"
  {
    pattern: /^expected\s+(.+)$/i,
    translate: (g) => `期望${g[1]}`,
  },

  // "missing X" → "缺少 X"
  {
    pattern: /^missing\s+(.+)$/i,
    translate: (g) => `缺少${g[1]}`,
  },

  // "no X for Y" / "no X in Y" → "没有 Y 的 X"
  {
    pattern: /^no\s+(.+?)\s+(for|in|on|at|to)\s+(.+)$/i,
    translate: (g) => `没有${g[3]}的${g[1]}`,
  },

  // "'X' is not a Y" → "'X' 不是 Y"
  {
    pattern: /^'([^']+)'\s+is not\s+(a|an)\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 不是${g[3]}`,
  },

  // "'X' is not Y" → "'X' 不是 Y"
  {
    pattern: /^'([^']+)'\s+is not\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 不是${g[2]}`,
  },

  // "'X' is Y" → "'X' 是 Y"
  {
    pattern: /^'([^']+)'\s+is\s+(a|an)\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 是${g[3]}`,
  },

  // "'X' has no Y" → "'X' 没有 Y"
  {
    pattern: /^'([^']+)'\s+has no\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 没有${g[2]}`,
  },

  // "'X' does not Y" → "'X' 不 Y"
  {
    pattern: /^'([^']+)'\s+does not\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 不${g[2]}`,
  },

  // "'X' was not Y" → "'X' 没有 Y"
  {
    pattern: /^'([^']+)'\s+was not\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 没有${g[2]}`,
  },

  // "'X' cannot be Y" → "'X' 不能 Y"
  {
    pattern: /^'([^']+)'\s+cannot be\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 不能${g[2]}`,
  },

  // "'X' may not be Y" → "'X' 不能 Y"
  {
    pattern: /^'([^']+)'\s+may not be\s+(.+)$/i,
    translate: (g) => `'${g[1]}' 不能${g[2]}`,
  },

  // "'X' is deprecated" → "'X' 已弃用"
  {
    pattern: /^'([^']+)'\s+is deprecated/i,
    translate: (g) => `'${g[1]}' 已弃用`,
  },

  // "'X' is ambiguous" → "'X' 有歧义"
  {
    pattern: /^'([^']+)'\s+is ambiguous/i,
    translate: (g) => `'${g[1]}' 有歧义`,
  },

  // "'X' is private/protected" → "'X' 是 private/protected"
  {
    pattern: /^'([^']+)'\s+is\s+(private|protected)\s+/i,
    translate: (g) => `'${g[1]}' 是${g[2]}成员`,
  },

  // "too many X" / "too few X"
  {
    pattern: /^too\s+(many|few)\s+(.+)$/i,
    translate: (g) => `${g[1] === 'many' ? '过多' : '过少'}的${g[2]}`,
  },

  // "no viable X"
  {
    pattern: /^no\s+viable\s+(.+)$/i,
    translate: (g) => `没有可行的${g[1]}`,
  },

  // "call to X is ambiguous" → "调用 X 有歧义"
  {
    pattern: /^call\s+to\s+(.+?)\s+is ambiguous/i,
    translate: (g) => `调用${g[1]}有歧义`,
  },

  // "candidate X not viable"
  {
    pattern: /^candidate\s+(.+?)\s+not viable/i,
    translate: (g) => `候选${g[1]}不可行`,
  },

  // "redefinition of X"
  {
    pattern: /^redefinition\s+of\s+(.+)/i,
    translate: (g) => `${g[1]}被重定义`,
  },

  // "use of X"
  {
    pattern: /^use\s+of\s+(.+)/i,
    translate: (g) => `使用了${g[1]}`,
  },

  // "'X' cannot be used with Y" → "'X' 不能与 Y 一起使用"
  {
    pattern: /^'([^']+)'\s+cannot be used\s+(.+)/i,
    translate: (g) => `'${g[1]}' 不能${g[2]}`,
  },

  // "no X named Y in Z" → "在 Z 中没有名为 Y 的 X"
  {
    pattern: /^no\s+(.+?)\s+named\s+'([^']+)'\s+in\s+'([^']+)'$/i,
    translate: (g) => `在${g[3]}中没有名为${g[2]}的${g[1]}`,
  },

  // "'X' is not a valid Y for Z" → "'X' 不是 Z 的有效 Y"
  {
    pattern: /^'([^']+)'\s+is not a valid\s+(.+?)\s+for\s+'([^']+)'$/i,
    translate: (g) => `'${g[1]}' 不是'${g[3]}'的有效${g[2]}`,
  },

  // "'X' is not an accessible base of Y" → "'X' 不是 Y 的可访问基类"
  {
    pattern: /^'([^']+)'\s+is not an accessible base of\s+'([^']+)'$/i,
    translate: (g) => `'${g[1]}' 不是'${g[2]}'的可访问基类`,
  },

  // "cannot declare X to be of Y" → "不能将 X 声明为 Y"
  {
    pattern: /^cannot declare\s+(.+?)\s+to be of\s+(.+)$/i,
    translate: (g) => `不能将${g[1]}声明为${g[2]}`,
  },

  // "no known conversion from X to Y" → "没有从 X 到 Y 的已知转换"
  {
    pattern: /^no known conversion from\s+'([^']+)'\s+to\s+'([^']+)'$/i,
    translate: (g) => `没有从${g[1]}到${g[2]}的已知转换`,
  },

  // "note: candidate X" → "注意：候选 X"
  {
    pattern: /^note:\s+(.+)/i,
    translate: (g) => `注意：${g[1]}`,
  },
];

// ===== 工具函数 =====

/**
 * 从消息中提取并保护引号中的标识符。
 */
function extractIdentifiers(text: string): { text: string; identifiers: string[] } {
  const identifiers: string[] = [];
  // 保护已存在的 \x00...\x00 占位符（如 FENCED_BLOCK、INLINE_CODE 等）
  // eslint-disable-next-line no-control-regex -- 占位符分隔符需要控制字符
  let result = text.replace(/\x00[^\x00]+\x00/g, (match) => {
    identifiers.push(match);
    return `\x00ID${identifiers.length - 1}\x00`;
  });
  // 保护反引号中的代码
  result = result.replace(/`([^`]+)`/g, (_m, _id) => {
    identifiers.push(`\x00ID${identifiers.length}\x00`);
    return `\x00ID${identifiers.length - 1}\x00`;
  });
  // 保护单引号中的标识符
  result = result.replace(/'([^']+)'/g, (_m, cap) => {
    identifiers.push(`'${cap}'`);
    return `\x00ID${identifiers.length - 1}\x00`;
  });
  return { text: result, identifiers };
}

/**
 * 恢复被保护的标识符。
 */
function restoreIdentifiers(text: string, identifiers: string[]): string {
  // eslint-disable-next-line no-control-regex -- 占位符分隔符需要控制字符
  return text.replace(/\x00ID(\d+)\x00/g, (_m: string, idx: string): string => {
    const i = parseInt(idx, 10);
    return i < identifiers.length ? (identifiers[i] ?? _m) : _m;
  });
}

/**
 * 对文本应用短语替换。
 */
function applyPhraseReplacements(text: string): string {
  // 按长度降序排序，避免短词先匹配
  const sorted = Object.entries(PHRASE_MAP).sort((a, b) => b[0].length - a[0].length);
  let result = text;
  for (const [en, zh] of sorted) {
    // 只替换独立单词（有单词边界）
    const regex = new RegExp(`\\b${escapeRegex(en)}\\b`, 'gi');
    result = result.replace(regex, zh);
  }
  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ===== 公开 API =====

/**
 * 通用翻译 clang 诊断消息。
 *
 * 处理流程：
 * 1. 提取并保护引号中的代码标识符
 * 2. 尝试句式模板匹配
 * 3. 如果句式匹配成功，翻译句式并恢复标识符
 * 4. 如果没有句式匹配，对非代码部分做短语翻译
 *
 * @param message - 原始诊断消息
 * @returns 翻译后的消息（原始消息 + 翻译追加），或 null（不适合翻译）
 */
/**
 * 字面匹配表：在标识符提取之前匹配原始消息中的固定句式。
 * 用于处理句式模板和短语替换都覆盖不到的固定消息。
 */
const LITERAL_MATCHES: Array<{ pattern: RegExp; translate: (groups: string[]) => string }> = [
  // "The last '/X' or '/Y' option takes precedence over earlier instances"
  {
    pattern:
      /^The last '(\/[^']+)' or '(\/[^']+)' option takes precedence over earlier instances$/i,
    translate: (g) => `最后一个 '${g[0]}' 或 '${g[1]}' 选项优先于之前的实例`,
  },
];

/**
 * 短语替换是否适用于给定文本。
 * 长文本（>120 字符）通常为 hover 文档或说明性文字，
 * 短语替换会破坏其英文句子结构，不予处理。
 */
function shouldApplyPhrases(text: string): boolean {
  return text.length <= 120;
}

export function genericTranslate(message: string): string | null {
  if (!message || message.length < 3) {
    return null;
  }

  // 0. 字面匹配表（在标识符提取之前，匹配原始消息中的固定句式）
  for (const literal of LITERAL_MATCHES) {
    const match = message.match(literal.pattern);
    if (match) {
      const translated = literal.translate(match.slice(1));
      return message + ` [${translated}]`;
    }
  }

  // 1. 提取并保护标识符
  const { text: protectedText, identifiers } = extractIdentifiers(message);

  // 2. 尝试句式模板匹配
  for (const template of TEMPLATES) {
    const match = protectedText.match(template.pattern);
    if (match) {
      const groups = match.slice(1);
      const translated = template.translate(groups, identifiers);
      // 对模板输出中的英文词汇进行短语翻译（仅短文本）
      let result = translated;
      if (shouldApplyPhrases(translated)) {
        result = applyPhraseReplacements(translated);
      }
      const restored = restoreIdentifiers(result, identifiers);
      return message + ` [${restored}]`;
    }
  }

  // 3. 没有句式匹配：尝试短语翻译（仅短文本）
  if (shouldApplyPhrases(protectedText)) {
    const phraseTranslated = applyPhraseReplacements(protectedText);
    if (phraseTranslated !== protectedText) {
      const restored = restoreIdentifiers(phraseTranslated, identifiers);
      return message + ` [${restored}]`;
    }
  }

  return null;
}
