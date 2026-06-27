/**
 * Shared types for the detection layer.
 *
 * Phase 1 mirror of engine-link's detection types — typed contracts that
 * other modules (@build, @clangd, @ui) consume.
 */

export interface ProjectInfo {
  /** Absolute path to the .uproject file (with .uproject extension). */
  path: string;
  /** Project name (typically the .uproject filename without extension). */
  name: string;
  /** Engine version specified in `EngineAssociation` (e.g., "5.4"). Empty if not pinned. */
  engineAssociation: string;
  /** Modules declared in the .uproject (Targets in modern UE; legacy `Modules` field). */
  modules: string[];
  /** Raw parsed JSON for downstream consumers that need fields we don't model yet. */
  raw: unknown;
}

export interface EngineInstall {
  /** Absolute path to the engine root (the directory containing `Engine/Build/`). */
  path: string;
  /** Engine version as reported by Build.version (e.g., "5.4.2"). */
  version: string;
  /** True if discovered under Epic Launcher paths (Windows registry or Mac Library). */
  isLauncherInstall: boolean;
}

export interface VSInstallation {
  /** Display name as reported by vswhere (e.g., "Visual Studio Enterprise 2022"). */
  displayName: string;
  /** Path to the installation root (contains VC\Tools\MSVC). */
  installationPath: string;
  /** Full vswhere version string (e.g., "17.8.34309.116"). */
  version: string;
  /** Path to the MSVC toolset (e.g., "C:\\Program Files\\...\\VC\\Tools\\MSVC\\14.39.33519"). */
  vcToolsPath?: string;
}

export interface WorkspaceSelection {
  /** Path of the selected project (must be a key into Scanner results). */
  selectedProject?: string;
  /** Path of the selected engine (must be a key into Discovery results). */
  selectedEngine?: string;
}
