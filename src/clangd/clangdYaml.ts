/**
 * clangdYaml —— `.clangd` 的多文档 YAML 读写原语
 *
 * ## 为什么必须支持多文档
 *
 * clangd 的 `.clangd` 是 **YAML stream（多文档）** 文件：多个配置块用 `---`
 * 分隔，clangd 会把它们**按目录深度**逐个叠加。所以用户手写的 `.clangd`
 * 经常长这样：
 *
 * ```yaml
 * CompileFlags:
 *   Add: [-DFOO=1]
 * ---
 * If:
 *   PathMatch: [Plugins/.*]
 * CompileFlags:
 *   Add: [-DBAR=1]
 * ```
 *
 * 旧实现用 `yaml.parse(text)` —— 遇到第二个文档会**直接抛异常**：
 *
 *   Source contains multiple documents; please use YAML.parseAllDocuments()
 *
 * 于是 `readConfig()` 返回 null、`mutate()` 返回 `parse-failed` → 扩展对
 * 多文档 `.clangd` **完全无法写入**；而 `renderClangdConfig()` 只输出单文档，
 * 就算读得进去，写回时也会把用户手写的其它文档**整体覆盖丢失**。
 *
 * ## 本模块提供
 *
 *   - `parseClangdDocs` —— 解析成 `Document[]`（多文档安全，不抛）
 *   - `mergeConfigIntoDoc` —— 把 JS 配置**递归合并**进 `Document`：
 *     未变动的子树原样保留 → **注释不丢**
 *   - `renderClangdDocs` —— `Document[]` → 文本（保留 `---` 分隔）
 *
 * ## 注释保留的实现要点
 *
 * `yaml` 库的行为（已实测）：
 *   - `doc.set('CompileFlags', {...})` —— **整体替换子树 → 子树内注释全丢**
 *   - `map.set('Add', [...])` —— **就地替换值 → 该键上的注释保留**
 *
 * 所以合并必须**逐层递归**：两边都是 map 就递归下去，只有叶子才整体替换。
 * 这样 `.clangd` 里用户手写的注释在扩展改写后依然存在。
 */

/** yaml 包的 Document / YAMLMap 类型（yaml v2） */
import * as yaml from 'yaml';

/** 解析结果 */
export interface ParsedClangdDocs {
  /** 解析出的文档列表（可能为空：文件为空字符串时） */
  docs: yaml.Document[];
  /**
   * 主文档下标 —— 第一个内容为 map 的文档。
   * `.clangd` 的 `CompileFlags` 落在主文档里；其余文档是用户的 per-directory 配置，
   * 扩展只改主文档，其余原样保留。
   * -1 表示没有可用的 map 文档。
   */
  mainIndex: number;
  /** 解析错误（YAML 语法错误）。存在时 docs 为空。 */
  error?: unknown;
}

/**
 * 解析 `.clangd` 文本为文档列表。
 *
 * 与 `yaml.parse` 的关键差异：**多文档不抛异常**。
 * 语法错误通过 `error` 字段返回（不 throw），调用方决定如何处理。
 */
export function parseClangdDocs(text: string): ParsedClangdDocs {
  let docs: yaml.Document[];
  try {
    // parseAllDocuments 对多文档安全；语法错误不抛，而是挂在 doc.errors 上
    docs = yaml.parseAllDocuments(text);
  } catch (err) {
    // 理论上 parseAllDocuments 不抛（错误都在 doc.errors 里），保险起见仍兜住
    return { docs: [], mainIndex: -1, error: err };
  }

  for (const doc of docs) {
    if (doc.errors.length > 0) {
      return { docs: [], mainIndex: -1, error: doc.errors[0] };
    }
  }

  const mainIndex = docs.findIndex((doc) => yaml.isMap(doc.contents));
  return { docs, mainIndex };
}

/**
 * 把 JS 配置对象**递归合并**进 `Document`。
 *
 * - 两边都是 map → 递归合并（保留未变动子树的注释）
 * - 否则 → 整体替换该键的值
 * - `config` 里不存在的键 → 从 Document 中删除
 */
export function mergeConfigIntoDoc(doc: yaml.Document, config: Record<string, unknown>): void {
  const contents = doc.contents;
  if (!yaml.isMap(contents)) {
    // 主文档不是 map（空文档 / 标量文档）→ 无从合并，直接整体替换
    doc.contents = doc.createNode(config);
    return;
  }
  mergeMap(contents, config);
}

/** 递归合并一个 YAMLMap 与一个 JS 对象 */
function mergeMap(map: yaml.YAMLMap, obj: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(obj)) {
    const existing = map.get(key, true);
    if (isPlainObject(value) && yaml.isMap(existing)) {
      mergeMap(existing, value);
    } else {
      // 就地替换该键的值 —— 键上的注释保留
      map.set(key, value);
    }
  }

  // config 中已删除的键 → 从 Document 中移除
  const current: unknown = map.toJSON();
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    for (const key of Object.keys(current as Record<string, unknown>)) {
      if (!(key in obj)) {
        map.delete(key);
      }
    }
  }
}

/** 判断是否为「纯 JS 对象」（排除数组 / null / Date 等） */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 把文档列表渲染回文本。
 *
 * `Document.toString()` 自带 `---` 分隔符（第二个及之后的文档），
 * 直接拼接即可还原原始结构。
 */
export function renderClangdDocs(docs: readonly yaml.Document[]): string {
  return docs.map((doc) => doc.toString({ lineWidth: 0 })).join('');
}
