## Task: Fix compile_commands.json Generation Pipeline

### Current Problem
createProject Step 2 calls `Build.bat -Mode=GenerateProjectFiles` which generates .sln/.vcxproj files, NOT compile_commands.json.

### Root Cause (from unreal-clangd v3.4.1 source code at /tmp/uc_src/)

The correct approach (from src/modules/updateCompileCommands.ts getUpdateCCArgs):

**Script**: Engine/Build/BatchFiles/RunUBT.bat (not Build.bat)
**Mode**: -mode=GenerateClangDataBase (not -Mode=GenerateProjectFiles)
**Full command**:
```
RunUBT.bat <TargetName> <Platform> Development <ProjectPath> -Compiler=Clang -mode=GenerateClangDataBase
```

Constants from src/libs/consts.ts:
- UPDATE_COMPILE_COMMANDS_ARG_GEN_CLANGDB = "-mode=GenerateClangDataBase" (line 370)
- UPDATE_COMPILE_COMMANDS_COMPILER_CLANG = "-Compiler=Clang" (line 344)
- UPDATE_COMPILE_COMMANDS_ARG_DEVELOPMENT = "Development" (line 369)

Platform mapping (from ueHelpers.ts getUnrealPlatform):
- win32 -> "Win64"
- linux -> "Linux"
- darwin -> "Mac"

Target discovery (from ueHelpers.ts getBuildTargetNames):
- Scan Source/ directory for *.Target.cs files
- Strip .Target.cs suffix to get target names
- Prefer targets ending with "Editor"

### Files to Modify

**src/clangd/compileCommands.ts** - The generateCompileCommands function:

1. Change UBT script path from Build.bat to RunUBT.bat (unix: RunUBT.sh stays same)

2. Replace the args from `['-Mode=GenerateProjectFiles', '-Project=...', '-waitmutex']` to:
   - Discover build target from Source/*.Target.cs files
   - Map process.platform to Unreal platform string
   - Build args: [targetName, platform, "Development", projectPath, "-Compiler=Clang", "-mode=GenerateClangDataBase"]

3. Add fallback logic for compile_commands.json path:
   - First check alongside .uproject (current behavior)
   - If not found, check <EngineRoot>/.vscode/unreal-clangd/compile_commands.json
   - The unreal-clangd README says: "This extension deletes/creates a compile_commands.json in the parent Unreal Engine directory and then copies it over to the project"

4. Keep existing: Windows cmd.exe wrapper for .bat files, timeout=300000, AbortSignal, stderr/stdout logging

### Source Reference Files (read these for exact implementation details)
- /tmp/uc_src/src/modules/updateCompileCommands.ts (getUpdateCCArgs function, UBT invocation)
- /tmp/uc_src/src/libs/ueHelpers.ts (getBuildTargetNames, getUbtPath, getUnrealPlatform)
- /tmp/uc_src/src/libs/consts.ts (all constants)
- /tmp/uc_src/src/libs/projHelpers.ts (compile_commands.json paths)

### Callers (should NOT need changes)
- src/commands/createProject.ts (calls generateCompileCommands with {project, engineRoot, logger})
- src/commands/generateCompileCommands.ts (same)

### Validation
After changes, run: npm run compile (or tsc -p tsconfig.json)
