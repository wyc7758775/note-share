@echo off
chcp 65001 >nul
cd /d %~dp0

echo ============================================
echo   NoteShare 笔记软件启动中...
echo ============================================

rem 想用自己的笔记库（比如 Obsidian 库），把下面这行开头的 rem 去掉并改路径：
rem set VAULT_DIR=D:\你的笔记库路径

start "NoteShare-笔记后端" cmd /k "npm run dev:server"
timeout /t 2 /nobreak >nul
start "NoteShare-界面" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul
start http://localhost:5188

echo.
echo 已启动！会弹出两个黑窗口（别关），浏览器没自动打开就手动访问：
echo    http://localhost:5188
echo.
echo 停止：关掉那两个黑窗口即可
echo.
pause
