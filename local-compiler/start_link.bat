@echo off
title TubitBlockWeb Local Compiler
cd /d "%~dp0"
echo =====================================================
echo TubitBlockWeb Local Compiler
echo =====================================================
echo.
powershell -ExecutionPolicy Bypass -NoProfile -File "start_link.ps1"
echo.
if errorlevel 1 (
    echo Error occurred. Please check the messages above.
)
pause
