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
 * 覆盖 135 种常见 clangd 错误消息，分 15 类。
 *
 * 所有规则默认使用 append 模式，同时应用于 diagnostics、codeActions 和 hover。
 * Hover 专用规则使用 replace 模式，仅应用于 hover。
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
        pattern: "cannot initialize a variable of type '([^']+)' with$",
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
        pattern: "The last '/(TC|TP)' or '/(TC|TP)' option takes precedence over earlier instances",
        replacement: "[最后一个 '/$1' 或 '/$2' 选项优先于之前的实例]",
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

      // ===== Hover 专用规则 =====
      // 这些规则只匹配 hover 内容中的结构化文本

      // 51. hover: Parameters → 参数
      {
        pattern: "\\bParameters\\b",
        replacement: "参数",
        mode: 'replace',
        target: ['hover'],
      },

      // 52. hover: Returns → 返回值
      {
        pattern: "\\bReturns\\b",
        replacement: "返回值",
        mode: 'replace',
        target: ['hover'],
      },

      // 53. hover: public → 公有
      {
        pattern: "\\bpublic\\b",
        replacement: "公有",
        mode: 'replace',
        target: ['hover'],
      },

      // 54. hover: private → 私有
      {
        pattern: "\\bprivate\\b",
        replacement: "私有",
        mode: 'replace',
        target: ['hover'],
      },

      // 55. hover: static → 静态
      {
        pattern: "\\bstatic\\b",
        replacement: "静态",
        mode: 'replace',
        target: ['hover'],
      },

      // 56. hover: virtual → 虚函数
      {
        pattern: "\\bvirtual\\b",
        replacement: "虚函数",
        mode: 'replace',
        target: ['hover'],
      },

      // 57. hover: const → 常量
      {
        pattern: "\\bconst\\b",
        replacement: "常量",
        mode: 'replace',
        target: ['hover'],
      },

      // 58. hover: override → 覆盖
      {
        pattern: "\\boverride\\b",
        replacement: "覆盖",
        mode: 'replace',
        target: ['hover'],
      },

      // ===== v1.2 批量扩展：类型/声明错误 =====

      // 59. redefinition of 'X' as different kind of symbol
      {
        pattern: "redefinition of '([^']+)' as different kind of symbol",
        replacement: "['$1' 被重定义为不同类型的符号]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 60. 'X' has no member named 'Y'
      {
        pattern: "'([^']+)' has no member named '([^']+)'",
        replacement: "['$1' 没有名为 '$2' 的成员]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 61. 'X' is not a class/namespace/struct
      {
        pattern: "'([^']+)' is not a (class|namespace|struct|union)",
        replacement: "['$1' 不是一个 $2]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 62. 'X' is not a class template
      {
        pattern: "'([^']+)' is not a (class|function|variable) template",
        replacement: "['$1' 不是一个 $2 模板]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 63. 'X' is not a type
      {
        pattern: "'([^']+)' is not a type",
        replacement: "['$1' 不是一个类型]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 64. no type named 'X' in 'Y'
      {
        pattern: "no type named '([^']+)' in '([^']+)'",
        replacement: "[在 '$2' 中没有名为 '$1' 的类型]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 65. 'X' is not a member of 'Y' (already exists as rule 21, this is alt pattern)
      // Skip - covered by rule 21

      // 66. cannot use 'X' without a type specifier
      {
        pattern: "cannot use '([^']+)' without a type specifier",
        replacement: "[不能在没有类型说明符的情况下使用 '$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 67. 'X' is not a function
      {
        pattern: "'([^']+)' is not a function",
        replacement: "['$1' 不是一个函数]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 68. initial value of reference to non-const must be an lvalue
      {
        pattern: "initial value of reference to non-const must be an lvalue",
        replacement: "[非常量引用的初始值必须是左值]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 69. cannot assign to return value of function
      {
        pattern: "cannot assign to return value of function",
        replacement: "[不能给函数的返回值赋值]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 70. 'X' is not convertible to 'Y'
      {
        pattern: "'([^']+)' is not convertible to '([^']+)'",
        replacement: "['$1' 不能转换为 '$2']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 71. 'X' is an incomplete type (alt pattern)
      // Skip - covered by rule 1

      // 72. subscript of pointer to incomplete type
      {
        pattern: "subscript of pointer to incomplete type '([^']+)'",
        replacement: "[指向不完整类型 '$1' 的指针下标操作]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 73. arithmetic on pointer to incomplete type
      {
        pattern: "arithmetic on a pointer to incomplete type '([^']+)'",
        replacement: "[对指向不完整类型 '$1' 的指针进行算术运算]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 74. 'X' is an abstract class
      {
        pattern: "'([^']+)' is an abstract class",
        replacement: "['$1' 是一个抽象类]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 75. cannot declare field 'X' to be of abstract type 'Y'
      {
        pattern: "cannot declare field '([^']+)' to be of abstract type '([^']+)'",
        replacement: "[不能将字段 '$1' 声明为抽象类型 '$2']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：模板错误 =====

      // 76. 'X' is not a template
      {
        pattern: "'([^']+)' is not a template",
        replacement: "['$1' 不是一个模板]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 77. template argument for 'X' must be a type
      {
        pattern: "template argument for '([^']+)' must be a type",
        replacement: "[模板参数 '$1' 必须是一个类型]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 78. template argument for 'X' must be a compile-time constant expression
      {
        pattern: "template argument for '([^']+)' must be a compile-time constant expression",
        replacement: "[模板参数 '$1' 必须是编译时常量表达式]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 79. too many template arguments
      {
        pattern: "too many template arguments",
        replacement: "[模板参数过多]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 80. too few template arguments
      {
        pattern: "too few template arguments",
        replacement: "[模板参数过少]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 81. template argument deduction/substitution failed
      {
        pattern: "template argument deduction/substitution failed",
        replacement: "[模板参数推导/替换失败]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 82. candidate template ignored: could not match 'X' against 'Y'
      {
        pattern: "candidate (function|constructor) template ignored: could not match '([^']+)' against '([^']+)'",
        replacement: "[候选 $1 模板被忽略：无法将 '$2' 与 '$3' 匹配]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 83. candidate function template not viable
      {
        pattern: "candidate function template not viable",
        replacement: "[候选函数模板不可行]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：重载/函数匹配错误 =====

      // 84. no matching function for call to 'X'
      // Skip - covered by rule 5

      // 85. candidate function not viable: 'X'
      {
        pattern: "candidate function not viable: expects (\\d+) argument",
        replacement: "[候选函数不可行：期望 $1 个参数]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 86. candidate function not viable: no known conversion from 'X' to 'Y'
      {
        pattern: "candidate function not viable: no known conversion from '([^']+)' to '([^']+)'",
        replacement: "[候选函数不可行：没有从 '$1' 到 '$2' 的已知转换]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 87. candidate function not viable: allows at most X argument
      {
        pattern: "candidate function not viable: allows at most (\\d+) argument",
        replacement: "[候选函数不可行：最多允许 $1 个参数]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 88. call to 'X' is ambiguous
      // Skip - covered by rule 18

      // 89. call to deleted function 'X'
      // Skip - covered by rule 19

      // ===== v1.2 批量扩展：指针/引用错误 =====

      // 90. cannot take the address of an rvalue
      {
        pattern: "cannot take the address of an rvalue of type '([^']+)'",
        replacement: "[不能获取类型 '$1' 的右值的地址]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 91. non-const lvalue reference to type 'X' cannot bind to a temporary
      {
        pattern: "non-const lvalue reference to type '([^']+)' cannot bind to a (temporary|value)",
        replacement: "[类型 '$1' 的非常量左值引用不能绑定到 $2]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 92. cannot bind reference member to a temporary
      {
        pattern: "cannot bind reference member '([^']+)' to a temporary",
        replacement: "[不能将引用成员 '$1' 绑定到临时对象]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 93. cannot bind to a value of type 'X'
      // Skip - covered by rule 17

      // 94. reference to type 'X' requires that 'Y' be dereferenced
      {
        pattern: "reference to type '([^']+)' requires that '([^']+)' be dereferenced",
        replacement: "[类型 '$1' 的引用需要解引用 '$2']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 95. 'X' is a pointer, did you mean to use '->' ?
      {
        pattern: "'([^']+)' is a pointer; did you mean to use '->'\\?",
        replacement: "['$1' 是一个指针，你是想用 '->' 吗？]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：常量/限定符错误 =====

      // 96. cannot assign to variable 'X' with const-qualified type
      {
        pattern: "cannot assign to variable '([^']+)' with const-qualified type '([^']+)'",
        replacement: "[不能给 const 限定类型 '$2' 的变量 '$1' 赋值]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 97. 'this' argument to member function 'X' has type 'Y' but 'Z' is expected
      {
        pattern: "'this' argument to member function '([^']+)' has type '([^']+)' but '([^']+)' is expected",
        replacement: "[成员函数 '$1' 的 'this' 参数类型为 '$2'，但期望 '$3']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 98. 'X' is not a member of 'Y'
      // Skip - covered by rule 21

      // 99. no member named 'X' in 'Y'
      // Skip - covered by rule 4

      // 100. qualified reference to 'X' is a constructor name
      {
        pattern: "qualified reference to '([^']+)' is a constructor name",
        replacement: "[对 '$1' 的限定引用是一个构造函数名]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：初始化/构造/析构错误 =====

      // 101. 'X' is not a direct base of 'Y'
      {
        pattern: "'([^']+)' is not a direct base of '([^']+)'",
        replacement: "['$1' 不是 '$2' 的直接基类]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 102. member initializer 'X' does not name a non-static data member
      {
        pattern: "member initializer '([^']+)' does not name a non-static data member or base class",
        replacement: "[成员初始化器 '$1' 没有命名非静态数据成员或基类]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 103. initializer list is empty
      {
        pattern: "cannot initialize '([^']+)' with an empty initializer list",
        replacement: "[不能用空初始化列表初始化 '$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 104. 'X' is a private member of 'Y'
      {
        pattern: "'([^']+)' is a private member of '([^']+)'",
        replacement: "['$1' 是 '$2' 的私有成员]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 105. 'X' is a protected member of 'Y'
      {
        pattern: "'([^']+)' is a protected member of '([^']+)'",
        replacement: "['$1' 是 '$2' 的保护成员]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 106. destructor of 'X' is private
      {
        pattern: "destructor of '([^']+)' is private",
        replacement: "['$1' 的析构函数是私有的]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 107. deleted function 'X'
      // Skip - covered by rule 19

      // 108. explicitly deleted destructor
      {
        pattern: "destructor of '([^']+)' is explicitly deleted",
        replacement: "['$1' 的析构函数被显式删除]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：类型转换错误 =====

      // 109. cannot convert from 'X' to 'Y'
      // Skip - covered by rule 10

      // 110. cannot initialize a variable of type 'X' with a value/rvalue of type 'Y'
      {
        pattern: "cannot initialize a variable of type '([^']+)' with (a value|an rvalue) of type '([^']+)'",
        replacement: "[不能用类型 '$3' 的值初始化类型 '$1' 的变量]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 111. cannot initialize a parameter of type 'X' with an lvalue of type 'Y'
      {
        pattern: "cannot initialize a parameter of type '([^']+)' with an lvalue of type '([^']+)'",
        replacement: "[不能用类型 '$2' 的左值初始化类型 '$1' 的参数]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 112. no viable conversion from 'X' to 'Y'
      // Skip - covered by rule 9

      // ===== v1.2 批量扩展：预处理/编译错误 =====

      // 113. 'X' file not found
      // Skip - covered by rule 6

      // 114. 'X' file not found with angled include
      {
        pattern: "'([^']+)' file not found with angled include",
        replacement: "[找不到包含文件 '$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 115. 'X' file not found with quotes include
      {
        pattern: "'([^']+)' file not found with quotes include",
        replacement: "[找不到引号包含的文件 '$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 116. #include nested too deeply
      {
        pattern: "#include nested too deeply",
        replacement: "[#include 嵌套过深]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 117. 'X' is not defined as a preprocessor macro
      {
        pattern: "'([^']+)' is not defined as a preprocessor macro",
        replacement: "['$1' 没有被定义为预处理器宏]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 118. 'X' macro is not defined
      {
        pattern: "'([^']+)' macro is not defined",
        replacement: "[宏 '$1' 未定义]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：语法错误 =====

      // 119. expected ';' after expression
      {
        pattern: "expected '(;|\\})' at end of (declaration|statement|expression)",
        replacement: "[在 $2 末尾期望 '$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 120. expected expression
      {
        pattern: "expected expression",
        replacement: "[期望表达式]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 121. expected '(' after 'X'
      {
        pattern: "expected '\\(' after '([^']+)'",
        replacement: "[在 '$1' 后期望 '(']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 122. expected ')'
      {
        pattern: "expected '\\)'",
        replacement: "[期望 ')']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 123. expected '['
      {
        pattern: "expected '\\['",
        replacement: "[期望 '[']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 124. expected ']'
      {
        pattern: "expected '\\]'",
        replacement: "[期望 ']']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 125. expected '{'
      {
        pattern: "expected '\\{'",
        replacement: "[期望 '{']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 126. expected '}'
      {
        pattern: "expected '\\}'",
        replacement: "[期望 '}']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 127. expected class name
      {
        pattern: "expected class name",
        replacement: "[期望类名]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 128. expected namespace name
      {
        pattern: "expected namespace name",
        replacement: "[期望命名空间名]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 129. expected ':' in conditional expression
      {
        pattern: "expected ':' in conditional expression",
        replacement: "[条件表达式中期望 ':']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：clang-cl/MSVC 特有 =====

      // 130. unknown argument ignored
      {
        pattern: "unknown argument: '([^']+)'",
        replacement: "[未知参数：'$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 131. argument unused during compilation
      {
        pattern: "argument unused during compilation: '([^']+)'",
        replacement: "[编译期间未使用的参数：'$1']",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 132. optimization flag 'X' is not supported
      {
        pattern: "optimization flag '([^']+)' is not supported",
        replacement: "[优化标志 '$1' 不受支持]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 133. '#pragma warning' requires a warning level
      {
        pattern: "'#pragma warning' requires a warning level",
        replacement: "['#pragma warning' 需要警告级别]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 134. '#pragma comment' requires a comment type
      {
        pattern: "'#pragma comment' requires a comment type",
        replacement: "['#pragma comment' 需要注释类型]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 135. unknown pragma ignored
      {
        pattern: "unknown pragma ignored",
        replacement: "[未知的 pragma 被忽略]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 136. attribute 'X' is not supported
      {
        pattern: "attribute '([^']+)' is not supported",
        replacement: "[属性 '$1' 不受支持]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 137. 'X' is not a valid linker option
      {
        pattern: "'([^']+)' is not a valid linker option",
        replacement: "['$1' 不是有效的链接器选项]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // ===== v1.2 批量扩展：语义/作用域错误 =====

      // 138. 'X' is a private member
      // Skip - covered by rule 104

      // 139. 'X' was not declared in this scope
      // Skip - covered by rule 15

      // 140. 'X' does not name a type
      // Skip - covered by rule 16

      // 141. 'X' does not refer to a value
      {
        pattern: "'([^']+)' does not refer to a value",
        replacement: "['$1' 不引用一个值]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 142. 'X' does not refer to a type
      {
        pattern: "'([^']+)' does not refer to a type",
        replacement: "['$1' 不引用一个类型]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 143. 'X' is not a constant expression
      {
        pattern: "'([^']+)' is not a constant expression",
        replacement: "['$1' 不是一个常量表达式]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 144. constexpr variable 'X' must be initialized by a constant expression
      {
        pattern: "constexpr variable '([^']+)' must be initialized by a constant expression",
        replacement: "[constexpr 变量 '$1' 必须由常量表达式初始化]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 145. 'X' is not a constexpr function
      {
        pattern: "'([^']+)' is not a constexpr function",
        replacement: "['$1' 不是一个 constexpr 函数]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 146. default member initializer for 'X' needed before the end of ...
      {
        pattern: "default member initializer for '([^']+)' needed",
        replacement: "[需要 '$1' 的默认成员初始化器]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 147. 'X' is not a static data member
      {
        pattern: "'([^']+)' is not a static data member",
        replacement: "['$1' 不是一个静态数据成员]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 148. 'X' cannot be captured by reference (implicitly)
      {
        pattern: "'([^']+)' cannot be captured by reference",
        replacement: "['$1' 不能被引用捕获]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 149. lambda capture 'X' is not found in the enclosing scope
      {
        pattern: "lambda capture '([^']+)' is not found in the enclosing scope",
        replacement: "[lambda 捕获 '$1' 在外部作用域中未找到]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
      },

      // 150. 'X' is not captured
      {
        pattern: "'([^']+)' is not captured",
        replacement: "['$1' 未被捕获]",
        mode: 'append', target: ['diagnostics', 'codeActions', 'hover'],
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
