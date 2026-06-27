# Resources

Marketplace assets and runtime data files used by VSCodeUEHelper.

## Files

- `preparse-includes/ue5-fast.json` — curated 18-header list for fast clangd macro completion
- `preparse-includes/ue5-slow.json` — comprehensive 49-header list for slow mode
- `icon.png` — *(Phase 7 TODO)* 128×128 marketplace icon
- `banner.png` — *(Phase 7 TODO)* marketplace banner

## Adding Custom Headers

Drop a `.h` file into `.vscode/unreal-clangd/` at your project root — it will be appended to whichever preparse list you select.