/**
 * ueHelpers —— Unreal Engine 工具函数
 *
 * 抽离自原版 unreal-clangd v3 src/libs/ueHelpers.ts，
 * 提供 UBT 路径查找、Unreal 平台映射、Build Target 扫描等基础能力。
 */

//import * as vscode from 'vscode';

/* ------------------------------------------------------------------ */
/*  常量（对齐原版 consts.ts）                                          */
/* ------------------------------------------------------------------ */

const END_UBT_SCRIPT_FILE_NAMES_UNIX = ['Engine', 'Build', 'BatchFiles', 'RunUBT.sh'];
const END_UBT_SCRIPT_FILE_NAMES_WIN = ['Engine', 'Build', 'BatchFiles', 'RunUBT.bat'];
const END_DIRECTORY_NAMES_TO_UNREAL_BUILD_TOOL = ['Engine', 'Binaries', 'DotNET', 'UnrealBuildTool'];
const UNREAL_BUILD_TOOL_APP_NAME = 'UnrealBuildTool';
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
 * 查找 UnrealBuildTool 的可执行路径。
 *
 * 优先级（适配 UE 5.x）：
 *   1. Windows: <engineRoot>/Engine/Build/BatchFiles/RunUBT.bat
 *      ⚠️ UE 5.x 不再生成 .bat，只有 .sh（仅 Linux 平台）
 *   2. Unix:    <engineRoot>/Engine/Build/BatchFiles/RunUBT.sh
 *   3. 回退:    <engineRoot>/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.exe
 *      这是 UE 5.x 主要的可执行文件，跨平台通用
 *
 * @param ueUri 引擎根目录的 vscode.Uri
 * @returns 绝对路径字符串，找不到返回 null
 */
export async function getUbtPath(ueUri: vscode.Uri): Promise<string | null> {
  /* 1. RunUBT.sh (Unix/macOS) */
  const unixUri = vscode.Uri.joinPath(ueUri, ...END_UBT_SCRIPT_FILE_NAMES_UNIX);
  if (process.platform !== 'win32' && (await doesUriExist(unixUri))) {
    return unixUri.fsPath;
  }

  /* 2. RunUBT.bat (Windows, UE 4.x 兼容) */
  const winUri = vscode.Uri.joinPath(ueUri, ...END_UBT_SCRIPT_FILE_NAMES_WIN);
  if (process.platform === 'win32' && (await doesUriExist(winUri))) {
    return winUri.fsPath;
  }

  /* 3. 回退到 UnrealBuildTool.exe（UE 5.x 主要入口） */
  const ubtDirUri = vscode.Uri.joinPath(ueUri, ...END_DIRECTORY_NAMES_TO_UNREAL_BUILD_TOOL);
  if (!(await doesUriExist(ubtDirUri))) {
    return null;
  }
  // Windows: .exe; 其他平台: 无扩展名
  const exeName = process.platform === 'win32' ? UNREAL_BUILD_TOOL_EXE_NAME : UNREAL_BUILD_TOOL_APP_NAME;
  const ubtExeUri = vscode.Uri.joinPath(ubtDirUri, exeName);
  if (await doesUriExist(ubtExeUri)) {
    return ubtExeUri.fsPath;
  }

  // 最后的回退：返回无扩展名路径（让 OS 自己找）
  return vscode.Uri.joinPath(ubtDirUri, UNREAL_BUILD_TOOL_APP_NAME).fsPath;
}

/* ------------------------------------------------------------------ */
/*  getUnrealPlatform                                                   */
/* ------------------------------------------------------------------ */

/** Node process.platform → Unreal 平台字符串 */
export function getUnrealPlatform(platform: NodeJS.Platform): string | undefined {
  switch (platform) {
    case 'win32':
      return 'Win64';
    case 'linux':
      return 'Linux';
    case 'darwin':
      return 'Mac';
    default:
      return undefined;
  }
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
    if (fileType !== vscode.FileType.File) {continue;}
    if (!name.endsWith('.Target.cs')) {continue;}
    targets.push(name.slice(0, -'.Target.cs'.length));
  }

  // 将带 "Editor" 后缀的 target 移到首位（对齐原版逻辑）
  const editorIdx = targets.findIndex((t) => t.includes('Editor'));
  if (editorIdx > 0) {
    const editor = targets.splice(editorIdx, 1)[0]!;
    targets.unshift(editor);
  }

  return targets;
}
