/**
 * ubt —— 构造 UnrealBuildTool 命令行调用
 *
 * UBT 入口在 EngineRoot/Engine/Build/BatchFiles/Platform/Build.sh 或 Build.bat,
 * 脚本再 forward 到 EngineRoot/Engine/Binaries/DotNET/UnrealBuildTool/UnrealBuildTool.dll,
 * 用 dotnet 加载 .NET 程序集。
 *
 * UBT 参数格式(UE 5.x):
 *   Target Platform Configuration -Project=file.uproject -waitmutex
 *
 * 主要导出:
 *   - buildUBTCommand: 构造 UBT 命令(参数数组)
 *   - resolveUBTPath: <Engine>/Engine/Build/BatchFiles/Build.bat 或 RunUBT.sh
 *   - resolveUBTTarget: 把 Editor/Game 类型转成 XianDreamwalkingEditor 等具体 target 名
 *   - resolveEditorPath: 找 UnrealEditor.exe 路径
 *   - resolveLiveCodingCmd: 构造 Live Coding 命令
 */

import * as path from 'node:path';
import { UBTArgs, UBTCommand } from './types';

/**
 * Map a `BuildTarget` type + .uproject path to UBT's concrete target name.
 *
 * UBT looks up target rules by name (e.g. `XianDreamwalkingEditor.Target.cs`),
 * NOT by the abstract type `Editor`. The convention is `<ProjectName><Suffix>`:
 *
 *   Editor  → <ProjectName>Editor
 *   Game    → <ProjectName>
 *   Server  → <ProjectName>Server
 *   Client  → <ProjectName>Client
 */
export function resolveUBTTarget(uprojectPath: string, type: string): string {
  const projectName = path.basename(uprojectPath, '.uproject');
  switch (type) {
    case 'Editor':
      return `${projectName}Editor`;
    case 'Server':
      return `${projectName}Server`;
    case 'Client':
      return `${projectName}Client`;
    case 'Game':
    default:
      return projectName;
  }
}

export function buildUBTCommand(args: UBTArgs): UBTCommand {
  const scriptArgs = [
    args.target,
    args.platform,
    args.configuration,
    `-Project=${args.project}`,
    '-waitmutex',
  ];

  return {
    file: args.ubtPath,
    args: scriptArgs,
  };
}

/**
 * Resolve the UBT script path for the current platform.
 *
 * Windows: <EngineRoot>/Engine/Build/BatchFiles/Build.bat
 */
export function resolveUBTPath(engineRoot: string): string {
  return path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat');
}

/**
 * Resolve the path to the Unreal Editor executable for launching.
 *
 *   Windows: <EngineRoot>/Engine/Binaries/Win64/UnrealEditor.exe
 *   Mac:     <EngineRoot>/Engine/Binaries/Mac/UnrealEditor.app
 *   Linux:   <EngineRoot>/Engine/Binaries/Linux/UnrealEditor
 */
export function resolveEditorPath(engineRoot: string, platform: string): string {
  switch (platform) {
    case 'Win64':
      return path.join(engineRoot, 'Engine', 'Binaries', 'Win64', 'UnrealEditor.exe');
    case 'Mac':
      return path.join(engineRoot, 'Engine', 'Binaries', 'Mac', 'UnrealEditor.app');
    case 'Linux':
      return path.join(engineRoot, 'Engine', 'Binaries', 'Linux', 'UnrealEditor');
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

/**
 * Live Coding console command — sent via `UnrealEditor-Cmd -ExecCmds="LiveCoding.Compile"`.
 */
export function resolveLiveCodingCmd(engineRoot: string, platform: string): UBTCommand {
  const editor = resolveEditorPath(engineRoot, platform);
  return {
    file: editor,
    args: ['-ExecCmds="LiveCoding.Compile"', '-nullrhi', '-unattended'],
  };
}
