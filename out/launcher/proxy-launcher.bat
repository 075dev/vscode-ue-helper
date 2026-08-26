@echo off
REM proxy-launcher.bat —— clangd LSP 代理启动器（Windows）
REM 由 esbuild 自动生成，配合 clangd.useScriptAsExecutable=true 使用。

set "PROXY_DIR=%~dp0.."
node "%PROXY_DIR%\clangdProxy.js" %*
