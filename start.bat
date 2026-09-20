@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或更新版本，或使用 python -m http.server 8765。
  pause
  exit /b 1
)
echo 花间 FLEUR - http://127.0.0.1:8765/
echo 关闭此窗口或按 Ctrl+C 可停止服务器。
node scripts/serve.js
pause
