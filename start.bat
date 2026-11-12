@echo off
chcp 65001 >nul
cd /d "%~dp0"
title AI Study - Dev Server

echo.
echo ============================================
echo    AI Study 一键启动 (前端 + 后端)
echo ============================================
echo.

REM 首次运行自动安装依赖
if not exist "node_modules" (
    echo [1/2] 首次运行，正在安装依赖...
    call pnpm install
    if errorlevel 1 (
        echo.
        echo 依赖安装失败，请先安装 pnpm: npm i -g pnpm
        pause
        exit /b 1
    )
) else (
    echo [1/2] 依赖已就绪
)

echo [2/2] 启动开发服务...
echo.
echo    前端: http://localhost:3003
echo    后端: http://localhost:3001
echo.
echo    按 Ctrl+C 停止服务
echo ============================================
echo.

REM 10 秒后自动打开浏览器（独立进程，不阻塞服务启动）
start "" cmd /c "timeout /t 10 /nobreak >nul && start http://localhost:3003"

call pnpm dev

REM 服务异常退出时暂停，避免窗口直接关闭看不到报错
pause
