@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo [ACTUV启动器] 未找到 Node.js。请安装 Node.js 20.19+ 或 22.12+ 后重试。
    pause
    exit /b 1
)

node "scripts\startFrontend.mjs"
set "ACTUV_EXIT_CODE=%ERRORLEVEL%"
if not "%ACTUV_EXIT_CODE%"=="0" pause
exit /b %ACTUV_EXIT_CODE%
