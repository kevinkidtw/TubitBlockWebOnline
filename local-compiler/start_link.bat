@echo off
title TubitBlockWeb Local Compiler
cd /d "%~dp0"
echo =====================================================
echo TubitBlockWeb 本地編譯器啟動工具
echo =====================================================
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "start_link.ps1"
echo.
if errorlevel 1 (
    echo 發生錯誤，請檢查上方訊息。
)
pause
