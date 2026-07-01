/**
 * localization —— 规则表本地化引擎
 *
 * 职责：
 * - 提供默认的 clangd 诊断消息中文本地化规则表（22 条规则）
 * - 支持 append（原文 + 翻译）和 replace（仅翻译）两种模式
 * - 按目标过滤：diagnostics / codeActions / hover
 * - Hover 内容中保护围栏代码块（`...`）和内联代码跨度（...）不被修改
 * - 纯字符串处理，不修改 CodeAction 的 edit/command/data 或 Completion 字段
 *
 * 设计原则：
 * - 所有规则使用正则表达式匹配，支持捕获组引用（,  等）
 * - 规则表可扩展，用户可通过配置添加自定义规则
 * - 不信任外部输入：仅做模式匹配和替换，不执行任何代码
 */

// 规则模式类型
export type RuleMode = 'append' | 'replace';

// 规则目标
export type RuleTarget = 'diagnostics' | 'codeActions' | 'hover';

// 单条规则
export interface LocalizationRule {
  /** 正则表达式模式（不含 /g 标志，由引擎统一添加） */
  pattern: string;
  /** 替换文本，支持 ,  等捕获组引用 */
  replacement: string;
  /** 模式：append 保留原文并追加翻译，replace 仅替换 */
  mode: RuleMode;
  /** 应用目标列表 */
  target: RuleTarget[];
}

// 规则表
export interface LocalizationTable {
  rules: LocalizationRule[];
}

// ===== 默认规则表 =====

/**
 * 创建默认的 clangd 诊断消息中文本地化规则表。
 *
 * 覆盖 50 种常见 clangd 错误消息，分 10 类：
 *
 * **已存在（7 条）：**
 * 1. incomplete type
 * 2. unknown type name
 * 3. undeclared identifier
 * 4. no member named
 * 5. no matching function
 * 6. file not found
 * 7. macro redefined
 *
 * **新增（15 条）：**
 * 8.  cannot initialize variable
 * 9.  no viable conversion
 * 10. cannot convert
 * 11. expected identifier
 * 12. redefinition
 * 13. too many arguments
 * 14. too few arguments
 * 15. not declared in scope
 * 16. does not name a type
 * 17. cannot bind to value
 * 18. ambiguous call
 * 19. deleted function
 * 20. no matching constructor
 * 21. not a member of
 * 22. out-of-line definition mismatch
 *
 *
 * **Phase 4 新增（8 条）：**
 * 23. override specifier
 * 24. cast precision loss
 * 25. protected constructor
 * 26. return type mismatch
 * 27. template instantiation mismatch
 * 28. temporary address
 * 29. deprecated API
 * 30. private constructor
 *
 * 所有规则默认使用 append 模式，同时应用于 diagnostics、codeActions 和 hover。
 */
export function createDefaultLocalizationTable(): LocalizationTable {
  return {
    rules: [
      // ===== 已存在的规则（保留向后兼容） =====

      // 1. incomplete type 'T' named ...
      {
        pattern: "incomplete type '([^']+)' named",
        replacement: "[不完整的类型 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 2. unknown type name 'T'
      {
        pattern: "unknown type name '([^']+)'",
        replacement: "[未知的类型名称 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 3. use of undeclared identifier 'X'
      {
        pattern: "use of undeclared identifier '([^']+)'",
        replacement: "[使用了未声明的标识符 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 4. no member named 'X' in 'Y'
      {
        pattern: "no member named '([^']+)' in '([^']+)'",
        replacement: "[在 '$2' 中没有名为 '$1' 的成员]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 5. no matching function for call to 'F'
      {
        pattern: "no matching function for call to '([^']+)'",
        replacement: "[没有匹配的 function 可调用 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 6. 'path/file.h' file not found
      {
        pattern: "'([^']+)' file not found",
        replacement: "[找不到文件 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 7. 'MACRO' macro redefined
      {
        pattern: "'([^']+)' macro redefined",
        replacement: "[宏 '$1' 被重定义]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== 新增规则 =====

      // 8. cannot initialize a variable of type 'T' with ...
      {
        pattern: "cannot initialize a variable of type '([^']+)' with",
        replacement: "[无法初始化类型 '$1' 的变量]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 9. no viable conversion from 'T' to 'U'
      {
        pattern: "no viable conversion from '([^']+)' to '([^']+)'",
        replacement: "[无法从 '$1' 转换到 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 10. cannot convert 'T' to 'U'
      {
        pattern: "cannot convert '([^']+)' to '([^']+)'",
        replacement: "[无法将 '$1' 转换为 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 11. expected identifier / expected unqualified-id
      {
        pattern: "expected (identifier|unqualified-id)",
        replacement: "[期望标识符]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 12. redefinition of 'X'
      {
        pattern: "redefinition of '([^']+)'",
        replacement: "[重定义 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 13. too many arguments to function call
      {
        pattern: "too many arguments to function call",
        replacement: "[函数调用的实参过多]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 14. too few arguments to function call
      {
        pattern: "too few arguments to function call",
        replacement: "[函数调用的实参过少]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 15. 'X' was not declared in this scope
      {
        pattern: "'([^']+)' was not declared in this scope",
        replacement: "[未在此作用域中声明 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 16. 'X' does not name a type
      {
        pattern: "'([^']+)' does not name a type",
        replacement: "[不是一个类型名 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 17. cannot bind to a value of type 'T'
      {
        pattern: "cannot bind to a value of type '([^']+)'",
        replacement: "[无法绑定到类型 '$1' 的值]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 18. call to 'F' is ambiguous
      {
        pattern: "call to '([^']+)' is ambiguous",
        replacement: "[对 '$1' 的调用有歧义]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 19. attempting to reference a deleted function
      {
        pattern: "attempting to reference a deleted function",
        replacement: "[试图引用已删除的函数]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 20. no matching constructor for initialization of 'T'
      {
        pattern: "no matching constructor for initialization of '([^']+)'",
        replacement: "[没有匹配的构造函数来初始化 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 21. 'X' is not a member of 'Y'
      {
        pattern: "'([^']+)' is not a member of '([^']+)'",
        replacement: "[不是 '$2' 的成员 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 22. out-of-line definition of 'X' does not match any declaration in 'Y'
      {
        pattern: "out-of-line definition of '([^']+)' does not match any declaration in '([^']+)'",
        replacement: "[类外定义 '$1' 与 '$2' 中的任何声明都不匹配]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== 新增 UE 特定规则（Phase 4 扩展） =====

      // 23. override specifier
      {
        pattern: "overriding '([^']+)' must have 'override' specifier",
        replacement: "[覆盖 '$1' 必须使用 'override' 说明符]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 24. cast precision loss
      {
        pattern: "cast from '([^']+)' to '([^']+)' loses precision",
        replacement: "[从 '$1' 转换到 '$2' 丢失精度]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 25. protected constructor
      {
        pattern: "calling a protected constructor of class '([^']+)'",
        replacement: "[调用了类 '$1' 的保护构造函数]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 26. return type mismatch
      {
        pattern: "return type of selected overload is '([^']+)' but expected '([^']+)'",
        replacement: "[选择的重载返回类型为 '$1' 但期望 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 27. template instantiation mismatch
      {
        pattern: "explicit instantiation of '([^']+)' does not refer to a function template",
        replacement: "['$1' 的显式实例化不引用函数模板]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 28. temporary address
      {
        pattern: "taking address of a temporary",
        replacement: "[获取临时对象的地址]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 29. deprecated API
      {
        pattern: "'([^']+)' is deprecated",
        replacement: "['$1' 已弃用]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 30. private constructor
      {
        pattern: "calling a private constructor of class '([^']+)'",
        replacement: "[调用了类 '$1' 的私有构造函数]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== 新增 UE/clang-cl 通用规则（v1.1 扩展） =====

      // 31. function defined in header → ODR
      {
        pattern: "defined in a header file; function definitions in header files can lead to ODR violations",
        replacement: "[定义在头文件中；头文件中的函数定义可能导致 ODR 违反]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 32. /TC /TP option precedence
      {
        pattern: "The '/(TC|TP)' option takes precedence over earlier instances",
        replacement: "['/$1' 选项优先于之前的实例]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 33. /Fo with multiple source files
      {
        pattern: "Cannot specify '/(Fo|Fd)[^']*' when compiling multiple source files",
        replacement: "[编译多个源文件时不能指定 '/$1' 选项]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 34. implicit conversion loses integer precision
      {
        pattern: "implicit conversion loses integer precision: '([^']+)' to '([^']+)'",
        replacement: "[隐式转换丢失整数精度：从 '$1' 到 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 35. 'X' is not defined
      {
        pattern: "'([^']+)' is not defined",
        replacement: "['$1' 未定义]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 36. expected a type specifier
      {
        pattern: "expected a type specifier",
        replacement: "[期望类型说明符]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 37. cannot open file
      {
        pattern: "cannot open file '([^']+)'",
        replacement: "[无法打开文件 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 38. no such file or directory
      {
        pattern: "([^']+)' (is not a|No such) file or directory",
        replacement: "['$1' 不是文件或目录]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 39. invalid operands to binary expression
      {
        pattern: "invalid operands to binary expression '([^']+)' and '([^']+)'",
        replacement: "[二元表达式的操作数无效：'$1' 和 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 40. cannot initialize return object
      {
        pattern: "cannot initialize return object of type '([^']+)' with an lvalue of type '([^']+)'",
        replacement: "[无法用类型 '$2' 的左值初始化返回类型 '$1']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 41. allocating abstract class type
      {
        pattern: "allocating an object of abstract class type '([^']+)'",
        replacement: "[正在分配抽象类类型 '$1' 的对象]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 42. pure virtual function has no overrider
      {
        pattern: "pure virtual function '([^']+)' has no overrider",
        replacement: "[纯虚函数 '$1' 没有覆盖实现]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 43. cannot declare variable of abstract type
      {
        pattern: "cannot declare variable '([^']+)' to be of abstract type '([^']+)'",
        replacement: "[无法将变量 '$1' 声明为抽象类型 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 44. not an accessible base
      {
        pattern: "'([^']+)' is not an accessible base of '([^']+)'",
        replacement: "['$1' 不是 '$2' 的可访问基类]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 45. cannot cast
      {
        pattern: "cannot cast '([^']+)' to '([^']+)'",
        replacement: "[无法从 '$1' 转换到 '$2']",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 46. 'X' is ambiguous
      {
        pattern: "'([^']+)' is ambiguous",
        replacement: "['$1' 有歧义]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 47. 'X' is private / protected
      {
        pattern: "'([^']+)' is (private|protected)",
        replacement: "['$1' 是 $2 成员]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 48. missing type specifier
      {
        pattern: "missing type specifier - int assumed",
        replacement: "[缺少类型说明符 - 假定为 int]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 49. 'X' : illegal token
      {
        pattern: "'([^']+)'\\s*: illegal (token|character)",
        replacement: "['$1' 是非法的标记]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 50. 'X' : is not a valid value for 'Y'
      {
        pattern: "'([^']+)' is not a valid value for '([^']+)'",
        replacement: "['$1' 不是 '$2' 的有效值]",
        mode: 'append',
        target: ['diagnostics', 'codeActions', 'hover'],
      },
    ],
  };
}

// ===== 内部工具函数 =====

/**
 * 检查规则是否适用于指定目标。
 */
function ruleAppliesTo(rule: LocalizationRule, target: RuleTarget): boolean {
  return rule.target.includes(target);
}

/**
 * 对单行文本应用规则。
 *
 * @param text - 输入文本
 * @param rules - 要应用的规则列表
 * @param target - 当前目标（用于过滤）
 * @returns 本地化后的文本
 */
function applyRules(
  text: string,
  rules: LocalizationRule[],
  target: RuleTarget,
): string {
  let result = text;

  for (const rule of rules) {
    if (!ruleAppliesTo(rule, target)) {
      continue;
    }

    const regex = new RegExp(rule.pattern, 'g');
    if (!regex.test(result)) {
      continue;
    }

    // 重置 lastIndex（test 会修改它）
    regex.lastIndex = 0;

    if (rule.mode === 'replace') {
      result = result.replace(regex, rule.replacement);
    } else {
      // append 模式：保留原文，追加翻译
      result = result.replace(regex, (match) => {
        // 对匹配文本应用捕获组替换
        const localized = match.replace(regex, rule.replacement);
        return match + ' ' + localized;
      });
    }
  }

  return result;
}

// ===== 公开 API =====

/**
 * 对诊断消息应用本地化规则。
 *
 * @param message - 原始诊断消息
 * @param table - 规则表
 * @returns 本地化后的诊断消息
 */
export function applyLocalizationToDiagnostic(
  message: string,
  table: LocalizationTable,
): string {
  return applyRules(message, table.rules, 'diagnostics');
}

/**
 * 对代码动作标题应用本地化规则。
 *
 * @param title - 原始代码动作标题
 * @param table - 规则表
 * @returns 本地化后的代码动作标题
 */
export function applyLocalizationToCodeAction(
  title: string,
  table: LocalizationTable,
): string {
  return applyRules(title, table.rules, 'codeActions');
}

/**
 * 对悬停内容应用本地化规则。
 *
 * 保护围栏代码块（`...`）和内联代码跨度（...）不被修改。
 *
 * @param content - 原始悬停内容（可能包含 markdown）
 * @param table - 规则表
 * @returns 本地化后的悬停内容
 */
export function applyLocalizationToHover(
  content: string,
  table: LocalizationTable,
): string {
  // 第一步：提取并保护围栏代码块（```...```）
  const codeBlocks: string[] = [];
  const fencedPattern = /```[\s\S]*?```/g;
  let placeholderIndex = 0;

  const withoutFenced = content.replace(fencedPattern, (match) => {
    const placeholder = `\x00FENCED_BLOCK_${placeholderIndex}\x00`;
    codeBlocks.push(match);
    placeholderIndex++;
    return placeholder;
  });

  // 第二步：提取并保护内联代码跨度（`...`）
  const inlineCodeSpans: string[] = [];
  const inlinePattern = /`[^`]*`/g;
  let inlineIndex = 0;

  const withoutInline = withoutFenced.replace(inlinePattern, (match) => {
    const placeholder = `\x00INLINE_CODE_${inlineIndex}\x00`;
    inlineCodeSpans.push(match);
    inlineIndex++;
    return placeholder;
  });

  // 第三步：对剩余文本应用规则
  let result = applyRules(withoutInline, table.rules, 'hover');

  // 第四步：恢复内联代码跨度
  for (let i = 0; i < inlineCodeSpans.length; i++) {
    const placeholder = `\x00INLINE_CODE_${i}\x00`;
    const span = inlineCodeSpans[i];
    if (span !== undefined) {
      result = result.replace(placeholder, span);
    }
  }

  // 第五步：恢复围栏代码块
  for (let i = 0; i < codeBlocks.length; i++) {
    const placeholder = `\x00FENCED_BLOCK_${i}\x00`;
    const block = codeBlocks[i];
    if (block !== undefined) {
      result = result.replace(placeholder, block);
    }
  }

  return result;
}
