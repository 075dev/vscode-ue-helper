/**
 * ueHelpers —— Unreal Engine 工具函数
 *
 * 抽离自原版 unreal-clangd v3 src/libs/ueHelpers.ts，
 * 提供 UBT 路径查找、Build Target 扫描等基础能力。
 *
 * Windows-only 声明：本插件仅支持 Windows 平台，跨平台分支已清理（2026-07）。
 * 任何 `process.platform !== 'win32'` 的代码路径都是历史残留，应清除而非新增。
 */

import * as vscode from 'vscode';

/* ------------------------------------------------------------------ */
/*  常量                                                                */
/* ------------------------------------------------------------------ */

/** UE 5.x 引擎下 UnrealBuildTool.dll 的存放路径段（相对 Engine 根）。 */
const END_DIRECTORY_NAMES_TO_UNREAL_BUILD_TOOL = [
  'Engine',
  'Binaries',
  'DotNET',
  'UnrealBuildTool',
];

/** UE 5.x UBT 主可执行文件（UE 5.x 主要入口，跨引擎版本稳定）。 */
const UNREAL_BUILD_TOOL_EXE_NAME = 'UnrealBuildTool.exe';

/* ------------------------------------------------------------------ */
/*  doesUriExist                                                        */
/* ------------------------------------------------------------------ */

/** 检查一个 vscode.Uri 指向的文件/目录是否存在。 */
export async function doesUriExist(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  getUbtPath                                                          */
/* ------------------------------------------------------------------ */

/**
 * 查找 UnrealBuildTool 的可执行路径（Windows-only）。
 *
 * 优先级：
 *   1. <engineRoot>/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe
 *      UE 5.x 主要的可执行文件，跨引擎版本稳定。
 *
 * 注：本插件仅支持 Windows，UE 4.x 的 RunUBT.bat / UE 5.x Linux 的 RunUBT.sh
 * 都不再考虑。理由：UE 5.x 不再生成 RunUBT.bat；RunUBT.sh 走 Linux 路径不在本
 * 插件支持范围。
 *
 * @param ueUri 引擎根目录的 vscode.Uri
 * @returns 绝对路径字符串，找不到返回 null
 */
export async function getUbtPath(ueUri: vscode.Uri): Promise<string | null> {
  const ubtExeUri = vscode.Uri.joinPath(ueUri, ...END_DIRECTORY_NAMES_TO_UNREAL_BUILD_TOOL, UNREAL_BUILD_TOOL_EXE_NAME);
  if (await doesUriExist(ubtExeUri)) {
    return ubtExeUri.fsPath;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  getBuildTargetNames                                                 */
/* ------------------------------------------------------------------ */

/**
 * 扫描 <projectDir>/Source/*.Target.cs，提取 Build Target 名称。
 *
 * 对齐原版 getBuildTargetNames：
 *  - 如果存在名字中包含 "Editor" 的 target，将其移到列表首位
 *
 * @param projectDir 项目根目录的绝对路径（.uproject 所在目录）
 */
export async function getBuildTargetNames(projectDir: string): Promise<string[]> {
  const sourceUri = vscode.Uri.joinPath(vscode.Uri.file(projectDir), 'Source');

  let entries: [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(sourceUri);
  } catch {
    return [];
  }

  const targets: string[] = [];
  for (const [name, fileType] of entries) {
    if (fileType !== vscode.FileType.File) {
      continue;
    }
    if (!name.endsWith('.Target.cs')) {
      continue;
    }
    targets.push(name.slice(0, -'.Target.cs'.length));
  }

  // 将带 "Editor" 后缀的 target 移到首位（对齐原版逻辑）
  const editorIdx = targets.findIndex((t) => t.includes('Editor'));
  if (editorIdx > 0) {
    const editor = targets.splice(editorIdx, 1)[0];
    if (editor !== undefined) {
      targets.unshift(editor);
    }
  }

  return targets;
}
