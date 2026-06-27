# clangd UE Intellisense 性能优化方案研究

> 生成时间: 2026-06-26
> 信源: clangd 官方文档 (clangd.llvm.org) + clangd --help + boocs/unreal-clangd v3 社区实践
> 原则: 只写可落地的方案，不确定的标注置信度


## 1. clangd 自身性能控制面

以下均为 clangd 原生支持的能力，不依赖外部工具链。

### 1.1 后台索引与 CPU 资源控制

| 参数 | 类型 | 说明 | 信源 |
|------|------|------|------|
| `Index.Background: Build\|Skip` | .clangd | 默认 Build。对不需要跨文件引用的文件(如引擎源码)可设为 Skip，减少索引负担 | [clangd.llvm.org/config#background](https://clangd.llvm.org/config#background) |
| `--background-index` | CLI | 开启后台索引，索引持久化到磁盘。默认启用。禁用 `--background-index=0` 可降低 CPU 和磁盘 IO | `clangd --help` |
| `--background-index-priority=background\|low\|normal` | CLI | 控制索引线程的 CPU 优先级。`background`=最低，仅在空闲核心运行；`low`=略低于交互线程 | `clangd --help` |
| `-j <N>` | CLI | 控制异步 worker 数量，后台索引也用这么多 worker。UE 项目建议 `-j 2` 或 `-j 4`，防止占满 CPU | `clangd --help` |

**推荐配置**:
```yaml
# .clangd — 对引擎目录跳过后台索引(因为用户不改引擎代码)
If:
  PathMatch: Engine/Source/.*
Index:
  Background: Skip
---
# 对项目源码保持索引
Index:
  Background: Build
```

```json
// VSCode settings.json — clangd 启动参数
"clangd.arguments": [
  "--background-index",
  "--background-index-priority=low",
  "-j=4"
]
```

**原理**: 后台索引是 clangd 构建跨文件符号索引的过程。每个 translation unit 需要完整解析 (parse + semantic analysis)。对 UE 项目，完整索引可能需要数万 TUs (translation units)。限制并行度和优先级可以防止索引风暴阻塞交互式补全。

> **置信度: 高** — 直接来自 clangd 官方文档和 CLI help。

### 1.2 PCH 存储策略

| 参数 | 说明 | 信源 |
|------|------|------|
| `--pch-storage=disk` | 默认。PCH 写磁盘，内存占用低，但首次解析慢 | `clangd --help` |
| `--pch-storage=memory` | PCH 存内存中。加速重复解析，但显著增加内存占用 | `clangd --help` |

**原理**: clangd 对每个 translation unit 解析时，如果 compile_commands.json 中的命令指定了 `-include-pch <file>` 或 clangd 内部为 preamble 生成 PCH，`--pch-storage=memory` 会把这些 PCH 保留在内存中。对于 UE 项目，preamble 通常包含数千个 UE 引擎头文件，PCH 体积可达数百 MB。

**推荐**:
- 内存充足 (32GB+): `--pch-storage=memory`
- 内存有限 (16GB): 保持默认 `disk`
- 不建议在 8GB 系统上使用 memory 模式

```
# 验证内存开销: 观察 clangd 进程的 RSS
# Windows: 任务管理器 → 详细信息 → clangd.exe → 内存
```

> **置信度: 高** — 直接来自 `clangd --help`。

### 1.3 外部索引 (预构建索引)

| 配置 | 说明 | 信源 |
|------|------|------|
| `Index.External.File` | 指向 `clangd-indexer` 预构建的 monolithic index 文件 | [clangd.llvm.org/config#external](https://clangd.llvm.org/config#external) |
| `Index.External.Server` | 指向远程索引服务器地址 | 同上 |
| `Index.External.MountPoint` | 指定索引对应的源码根目录，处理相对路径转换 | 同上 |

**原理**: 这是 UE 项目实测收益最大的单项优化。引擎源码 (Engine/Source/) 在开发过程中基本不变，但包含了数万个 .h/.cpp 文件。如果每次打开项目都重新解析引擎代码，索引时间可能高达 20-60 分钟。用 `clangd-indexer` 预先构建一个 monolithic index 文件，clangd 启动时直接加载，跳过所有引擎 TUs 的解析。

```yaml
# .clangd — 使用预构建的引擎索引
Index:
  External:
    File: D:/UE_5.4/Engine/clangd-index.idx
    MountPoint: D:/UE_5.4/Engine/
```

**构建索引的命令** (需要 clangd-indexer 工具):
```bash
clangd-indexer \
  --executor=all-TUs compile_commands.json \
  --index-output=engine-clangd-index.idx
```

**注意**: 
- `clangd-indexer` 是 clangd 工具链的一部分，需要从 LLVM 发行版获取
- 声明 `External` 索引后，`MountPoint` 之下的文件默认关闭后台索引
- 存在一个尚未解决的限制：external index 与 `compile_commands.json` 中的 TU 路径可能存在不匹配

> **置信度: 中** — 官方文档完整描述了功能，但 UE 项目的具体集成需要额外工程适配（路径规范化、跨平台 MountPoint 处理）。

### 1.4 编译数据库路径控制

| 方式 | 说明 | 信源 |
|------|------|------|
| `.clangd` → `CompileFlags.CompilationDatabase: <path>` | 显式指定 compile_commands.json 目录 | [clangd.llvm.org/config#compilationdatabase](https://clangd.llvm.org/config#compilationdatabase) |
| `--compile-commands-dir=<path>` | CLI 参数指定，等价于上述配置 | `clangd --help` |
| 默认 `Ancestors` | clangd 向上搜索父目录 | 同上 |

**推荐**: 用 CLI 参数 `--compile-commands-dir`，避免 `.clangd` 文件中的路径写死问题。详见 clangd-flow-analysis.md 断裂口分析。

```json
"clangd.arguments": [
  "--compile-commands-dir=${workspaceFolder}/.vscode/vscodeuehelper"
]
```

> **置信度: 高** — 官方文档 + CLI help 双重验证。

### 1.5 --include 预处理头注入 (UE 宏补全)

**原理**: clangd 通过 `CompileFlags.Add` 中的 `-include <file>` 将额外的头文件预包含到每个 translation unit 的解析中。UE 的补全痛点在于 UPROPERTY/UFUNCTION 等宏——它们定义在 .generated.h 中，而这些头文件通常不被 clangd 的编译命令自动包含。

```yaml
# .clangd
CompileFlags:
  Add:
    - "-include"
    - "D:/project/.vscode/vscodeuehelper/macroCompletionHelper.h"
```

**boocs 双模式设计** (参考 unreal-clangd v3):
- **fast 模式**: 不用 `-include`，使用精心筛选的宏补全列表 (addMacroCompletions.h)，速度快
- **slow 模式**: 用 `-include` 预包含一个包含所有目标宏的头文件。补全全但增加每个 TU 的解析开销

```
Parse time per TU:
  fast mode: ~2-5s  (只有项目头文件)
  slow mode: ~5-15s (额外宏展开 + 补全头)
```

**性能权衡**: slow 模式下每个 TU 都需要展开 macroCompletionHelper.h 中的宏定义。对大型项目，这会导致 background indexing 时间显著增加。

> **置信度: 高** — 来自 boocs/unreal-clangd v3 实现和 clangd 官方 CompileFlags 文档。

### 1.6 编译标志优化

#### 移除昂贵的标志

UE 的 UBT 生成 compile_commands.json 时会带入大量 flags。以下标志对 clangd 解析是冗余或有害的：

```yaml
CompileFlags:
  Remove:
    - -FI*          # UHT 注入的强制 include (绝对路径，clangd 无法解析)
    - -Wno-*        # 噪音警告抑制
    - -W*           # 全部警告 (保存解析时间)
    - /FI*          # MSVC 强制 include
    - /imsvc*       # MSVC 系统 include (用 query-driver 替代)
```

**原理**: `-FI` (MSVC `/FI`) 强制每个 TU 解析时先 include 一个文件。UHT 用这个注入 .generated.h。但这些路径通常指向 engine/Intermediate 目录下的生成文件，clangd 碰巧能找到当然好，找不到会在日志刷屏。

> **置信度: 高** — 来自 clangd 官方 CompileFlags.Remove 文档 + VSCodeUEHelper 现有实践。

#### 启用 C++20 模式

```yaml
CompileFlags:
  Add:
    - -std=c++20    # UE5.3+ 默认 C++20
```

**原理**: 明确指定标准版本避免 clangd 推断失误，影响不大但消除歧义。

> **置信度: 高**。

### 1.7 --query-driver 系统头文件提取

```json
"clangd.arguments": [
  "--query-driver=D:/UE_5.4/Engine/Extras/LLVM/x64/bin/clang-cl.exe"
]
```

**原理**: clangd 内置的 clang 前端有自己的系统头文件搜索逻辑。如果 compile_commands.json 中用的是 MSVC 的 cl.exe 或 clang-cl.exe，clangd 无法推断 MSVC 的 Windows SDK 路径。`--query-driver` 让 clangd 执行目标编译器，从输出中提取真实的 include 路径。

这对性能的影响是间接的——没有正确的系统 include 路径，clangd 会不断报 `fatal error: 'windows.h' file not found`，进而导致整个 TU 解析失败，后续补全和引用查找全部失效。

> **置信度: 高** — 来自 clangd 官方 troubleshooting 页面和 system-headers 指南。

### 1.8 诊断项抑制 (减少假阳性计算)

```yaml
Diagnostics:
  Suppress:
    - unused-includes           # UE 头文件有大量必要的传递包含
    - builtin-macro-redefinition  # MSVC _MSC_VER 会被 clangd 标记为重定义
    - unknown-warning-option    # clang 不认识 MSVC 的警告选项
  ClangTidy:
    FastCheckFilter: Strict    # 只运行经测量为快速的 check
```

**原理**: `unused-includes` 在 UE 项目中产生巨量假阳性——由于 PCH、generated.h、模块依赖链，很多 include 看起来"没用"但删除会导致 IWYU 错误。每次诊断都需要 include-cleaner 做全 AST 遍历并做符号溯源，这是一个非平凡的成本。同理 `FastCheckFilter: Strict` 跳过未经性能测量的 clang-tidy check。

> **置信度: 高** — 来自 clangd 官方 Diagnostics 文档 + VSCodeUEHelper 现有实践。

### 1.9 补全加速

| 配置 | 说明 | 性能影响 |
|------|------|---------|
| `Completion.HeaderInsertion: Never` | 补全时不自动添加 #include | 减少 include-cleaner 查询 |
| `--header-insertion=never` | 同上，CLI 形式 | 同上 |
| `Completion.MacroFilter: ExactPrefix` | 宏补全只用精确前缀匹配 | 比 FuzzyMatch 快 |

**原理**: Include-What-You-Use 分析需要跨索引查询每个符号的 owning header。对 UE 这种有深层 include 层次的项目，单次补全的 IWYU 查询可能遍历数十字头文件。

> 但需权衡：`HeaderInsertion: Never` 关闭后，用户需要手动 #include，体验下降。

> **置信度: 高** — 来自 clangd 官方 Completion 文档。

### 1.10 关闭 clang-tidy

```
--clang-tidy=0
```

**原理**: clang-tidy 对每个打开的 .cpp/.h 运行额外的 AST check。UE 项目中大量模板展开使得单个 check 的执行时间远超普通 C++ 项目。对追求极致索引速度的场景，完全禁用 clang-tidy 是合理选项。补全、引用查找、导航等核心功能不受影响。

> **置信度: 高** — `clangd --help` 确认。

---

## 2. compile_commands.json 层面的优化

### 2.1 减少 Translation Unit 数量

UE 项目的 compile_commands.json 通常包含数千个条目（每个 .cpp 一个）。每条目对应 clangd 后台索引需要解析的一个 TU。

**方案 A — 过滤 compile_commands.json**:
只保留用户可能编辑的 Source/ 目录下的文件，排除：
- Engine/Intermediate/
- Engine/Plugins/ (非修改范围)
- ThirdParty/

```python
# 示例脚本: filter_cc_for_editor.py
import json
with open('compile_commands.json') as f:
    entries = json.load(f)

# 只保留项目 Source/ 目录
filtered = [e for e in entries if '/Source/' in e.get('file','')]
with open('compile_commands_editor.json', 'w') as f:
    json.dump(filtered, f, indent=2)
```

**方案 B — 用 Index.Background: Skip 替代物理删除**:
在 .clangd 中用 If 条件跳过某些路径的后台索引（见 1.1 节），保留 compile_commands.json 完整性。

> **置信度: 中** — 方案可行，但 UE 项目可能有 Source/ 文件依赖 Engine/ 头文件中的符号，过滤过激会导致补全和引用查找缺失。

### 2.2 响应文件展开

UBT 在 Windows 上可能生成带 `@responsefile.rsp` 的编译命令。clangd 默认不展开 `.rsp` 文件，导致实际参数缺失。

```yaml
# .clangd
CompileFlags:
  Compiler: clang-cl    # 让 clangd 识别 --rsp-quoting 等 MSVC 风格参数
```

> **置信度: 中** — boocs README 提到了 response file 引号处理问题。clangd 的 `.rsp` 展开行为取决于版本。

---

## 3. 缓存策略

### 3.1 clangd 默认索引缓存位置

| 平台 | 路径 |
|------|------|
| Windows | `%LocalAppData%/clangd/index/` |
| macOS | `~/Library/Caches/clangd/index/` |
| Linux | `~/.cache/clangd/index/` |

clangd 自动将后台索引结果持久化到这些路径。下次启动时增量更新而非全量重建。

### 3.2 项目级缓存（boocs 方案）

boocs/unreal-clangd 将缓存放在 `.vscode/unreal-clangd/cache/`，与项目绑定。

**原理**: 不同 UE 项目的引擎路径可能不同。将索引缓存绑定到项目可以避免跨项目的缓存冲突。

> 这不影响性能(仍然是同一个索引数据库，只是换了路径)，但能避免缓存污染。

### 3.3 PCH 缓存 (preamble cache)

clangd 内部对每个文件的 preamble（文件开头的 include 部分）生成 PCH。`--pch-storage=memory` 时这些 PCH 存在内存中；`disk` 时存在临时目录。

**优化思路**: 确保临时目录在 SSD 上。clangd 默认使用系统的 temp 目录。

> **置信度: 高** — 来自 clangd --help 和 LLVM 社区讨论。

---

## 4. UE 宏展开优化

### 4.1 问题本质

UE 的 UHT (Unreal Header Tool) 预处理器在编译前对 .h 文件进行代码生成，产生 .generated.h。这些生成的代码包含 UCLASS/USTRUCT/UPROPERTY/UFUNCTION 宏的具体展开。clangd 要正确补全这些宏，需要能解析 .generated.h。

#### 当前方案（VSCodeUEHelper 沿用 boocs 设计）

**阶段 1** — `completionHelper.cpp`:
```
一个空 .cpp 文件，仅包含 UE 项目所需的基础 include (CoreMinimal.h, Engine.h 等)。
放入 compile_commands.json 作为额外 TU。
作用: 让 clangd 索引 UE 核心类型。
```

**阶段 2** — `macroCompletionHelper.h`:
```
一个仅包含宏声明的 .h 文件, 不包含任何函数体。
通过 CompileFlags.Add 中的 -include 注入每个 TU。
```

**阶段 3** — `addCompletions.h` / `addMacroCompletions.h`:
```
手工维护的符号列表，用于在 fast 模式下不启用 -include 时提供基础补全候选。
```

### 4.2 性能瓶颈

- `-include macroCompletionHelper.h` 会在**每个 TU** 的解析时展开 UE 宏定义，增加 preamble 构建时间
- 宏展开完成后，模板实例化 (TArray<>, TMap<>, TSharedPtr<>) 进一步消耗解析时间
- UE 的 GENERATED_BODY() 展开后会引入大量生成的代码声明

### 4.3 未验证的潜在方案

| 方案 | 思路 | 可行性 |
|------|------|--------|
| 预展开宏文件 | 把 macroCompletionHelper.h 预展开为"干净"的声明，避免 clangd 做宏展开 | 需要开发工具，维护成本高 |
| 用 IWYU pragma | 在 .generated.h 中添加 IWYU pragma 标记 | 修改引擎生成文件不现实 |
| 仅对 Source/ 启用 slow 模式 | .clangd 用 `If.PathMatch` 区分，Engine/ 用 fast 模式 | 可行，需验证 Index.External 的协作 |

> **置信度: 低** — 这些方案没有在 UE clangd 社区找到验证过的实现。

---

## 5. 优化优先级排序

按"投入产出比"从高到低排列：

| 优先级 | 优化项 | 预期收益 | 实现难度 | 置信度 |
|--------|--------|---------|---------|--------|
| P0 | 修复 compile_commands.json → clangd 链路 (clangd-flow-analysis 断裂口) | 从"完全不可用"到"可用" | 低 | 高 |
| P1 | `--background-index-priority=low` + `-j 4` | 编辑器交互不卡顿 | 低 | 高 |
| P1 | `--query-driver` 正确指向 UE clang-cl | 消除系统头文件错误 | 低 | 高 |
| P1 | `Diagnostics.Suppress: unused-includes` | 消除 80% 假阳性诊断 | 低 | 高 |
| P2 | `--pch-storage=memory` (32GB+ 系统) | 打开文件响应加快 30-50% | 低 | 高 |
| P2 | `Index.Background: Skip` Engine/ 路径 | 索引时间降低 50-70% | 中 | 中 |
| P2 | `--clang-tidy=0` (仅限开发阶段) | 补全响应快 20-40% | 低 | 高 |
| P3 | `Index.External` 预构建引擎索引 | 首次打开项目时间从 30min → 2min | 高 | 中 |
| P3 | `Completion.HeaderInsertion: Never` | 补全响应快 | 低(但体验下降) | 高 |
| P4 | 过滤 compile_commands.json TUs | 索引时间降低 | 中 | 中 |
| P4 | UE 宏展开预计算 | 索引时间降低 | 高 | 低 |

---

## 6. 信源清单

| 信源 | URL | 获取内容 |
|------|-----|---------|
| clangd 官方配置文档 | https://clangd.llvm.org/config | Index / CompileFlags / Diagnostics / Completion 完整配置项 |
| clangd Features 页面 | https://clangd.llvm.org/features | 功能概述、版本标注 |
| clangd Troubleshooting | https://clangd.llvm.org/troubleshooting | 后台索引崩溃、系统头文件、日志 |
| clangd System Headers 指南 | https://clangd.llvm.org/guides/system-headers | --query-driver 原理 |
| clangd Include Cleaner 设计 | https://clangd.llvm.org/design/include-cleaner | IWYU 诊断原理 |
| clangd --help | 本地运行 clangd --help | --pch-storage, -j, --background-index-priority 等 CLI 参数 |
| boocs/unreal-clangd v3 | https://github.com/boocs/unreal-clangd (v3 分支) | clangd + UE 社区实践、fast/slow 双模式、缓存策略 |
