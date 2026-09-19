---
add: 001
slug: clang-format-ue5-template
status: reviewed
created_at: 2026-09-17T23:20:00+08:00
at: chapter-01
placement: auto(唯一重合)
review: approved(第 1 轮,0 critical)
---

# add-001:初始化项目时创建适合 UE5 C++ 的 .clang-format

## 需求

> 我希望在初始化项目的时候,同时创建一份适合 UE5 C++ 的 .clang-format

## 勘察与定位(add 步骤 0-2)

**关键发现:** 创建链路**已存在且默认开启**——

```
firstRunInit(首跑初始化) → executeCreateProject → Step 3.5 scaffoldClangFormatAndTidy
  (src/clangd/formatTidyFiles.ts;开关 vscodeUEHelper.scaffold.clangFormat 默认 true;
   只创建缺失项,已存在不覆盖)
```

因此"初始化时同时创建"这个动作无需新增;实质缺口是**模板质量**:旧 `CLANG_FORMAT_TEMPLATE` 为基础版(空格缩进、120 列硬折行、`if` 大括号不换行、无 UE 反射宏识别、自动排序 include),与 UE5 官方风格明显偏差。

**落点判定:** 并入 **chapter-01**——自动判断(唯一重合):`scaffoldClangFormatAndTidy` 仅被 `createProject`(首跑初始化唯一执行体)调用,资源域 `clangd/formatTidyFiles` 即 chapter-01 §一 clangd 能力面。不新建章节。

## 契约面(适配说明)

本项目为 VSCode 插件(非 API 服务),无 `.planning/context/openapi.yaml`(前置检查的 `/ql-scan` 已于本章生成 `.qiling/docs/`)。本功能的契约 = **`.clang-format` 模板内容规范**(静态可验证),`test/unit/clangd/formatTidyFiles.test.ts` 的 6 例契约断言即符合性检查。不伪造 API 端点/事件契约。

## 契约内容(模板取值,参考 Epic UE 编码标准 + [TensorWorks/UE-Clang-Format](https://github.com/TensorWorks/UE-Clang-Format) MIT)

| 维度 | 取值 | 理由 |
|------|------|------|
| UE 反射宏 | `StatementMacros: [UPROPERTY, UFUNCTION, UCLASS, USTRUCT, UENUM, UINTERFACE, GENERATED_BODY]` | 宏后代码不再被错误缩进/折行 |
| 缩进 | `UseTab: Always` + `TabWidth: 4` | UE 编码标准:Tab 缩进 4 宽(Epic 源码即 Tab) |
| 大括号 | Allman 完整(`AfterControlStatement/BeforeWhile/AfterCaseLabel: true` 等) | UE 官方代码风格 |
| 缩进细节 | `IndentCaseLabels/IndentPPDirectives: BeforeHash/NamespaceIndentation: All` | 引擎源码风格 |
| 行宽 | `ColumnLimit: 0` | 不强制折行,UE_LOG/Slate 友好(TensorWorks 验证选择;120 列软标准靠自觉) |
| include | `SortIncludes: false` | UE include 顺序有自身规范,自动排序可能破坏编译语义 |
| 其它 | 枚举不折行、指针靠左、构造初始化列表逗号前置、单行 lambda 保留等 | 贴近引擎源码 |
| 版本门槛 | clang-format/clangd ≥ 13(模板头已注明) | StatementMacros/BeforeLambdaBody 等选项 |

## 实现(TDD)

| 文件 | 变更 |
|------|------|
| test/unit/clangd/formatTidyFiles.test.ts | 新增 6 例契约断言(先红 6/6,原 5 例不破) |
| src/clangd/formatTidyFiles.ts | `CLANG_FORMAT_TEMPLATE` 重写(约 60 行);同步修正文件头/模板头过时注释 |
| CHANGELOG.md | Added 段补 add-001 条目;Fixed 段补 bugfix-001 条目 |

`.clang-tidy` 模板未动(用户未要求,不顺带改)。

## 验证与评审(fresh evidence)

| 命令 | 结果 |
|------|------|
| `npx vitest run test/unit/clangd/formatTidyFiles.test.ts` | 11/11(修复前 6 红) |
| `npm test` | 1235/1235(100 文件,净增 6) |
| `npm run typecheck` / `npm run build` | PASS |
| `npx eslint`(2 改动文件) | 0 错误(1 个原有 warning) |

**ql-reviewer 第 1 轮:approved**(0 critical,3 non-critical)。评审实测证据:
- 用 clang-format 22.1.8 对模板 `--dump-config`:exit 0 零错误,取值全部生效(含 bool→枚举映射 `SortIncludes: false → Enabled: false`、`AfterControlStatement: true → Always`)
- 与 TensorWorks 原文逐字段比对:所有共同字段取值完全一致
- 变异验证:13/13 断言在旧模板上为红(测试锁定有效)
- 对 UE 风格片段实跑格式化冒烟:Tab 缩进 + Allman + 反射宏行不乱

**non-critical 处理:**
1. clang-format ≥ 13 门槛未声明 → **已修**(模板头注释加一行)
2. 与 TensorWorks 两处无害省略(`AlignConsecutiveDeclarations`、`AfterObjCDeclaration`)→ 记录备查,不改
3. CHANGELOG 缺 add-001 条目 → **已补**(连同 bugfix-001 的 Fixed 条目)

## 遗留

- 已初始化过的存量项目不会自动获得新模板(设计如此:不覆盖用户文件);重新获取需删除项目现有 `.clang-format` 后重跑初始化,或手动复制模板。
- `AlignConsecutiveDeclarations: true`(TensorWorks 有)未携带——风格选择(变量声明对齐),用户可自行加。

## 旅程日志(≤5 条)

- 初看需求以为要做"接入首跑初始化",勘察发现链路已通且默认开启——把需求重读为"创建的格式要适合 UE5 C++"后,真正的增量才浮出来(模板升级)。
- 搜索摘要一度声称"AfterControlStatement: false(UE 控制语句大括号同行)",与 UE 实际 Allman 风格矛盾;抓取 TensorWorks 原始配置核实为 true,未采信摘要。
