# Resources

Marketplace assets and runtime data files used by VSCodeUEHelper.

## Files

- `preparse-includes/ue5-slow.json` — comprehensive 49-header list for UE 5.x macro completion
  (fast.json 已删除，fast/slow 模式合并为统一 slow，参考 `src/clangd/AGENTS.md` Pitfall #11)
- `icon.png` — 128×128 PNG marketplace icon (resources/icon.png, RGBA, non-interlaced)

## Adding Custom Headers

Drop a `.h` file into `.vscode/unreal-clangd/` at your project root — it will be appended to the preparse list.
