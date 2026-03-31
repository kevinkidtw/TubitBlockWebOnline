@echo off
title TubitBlockWeb Local Compiler
echo =====================================================
echo TubitBlockWeb Local Compiler
echo =====================================================
echo.
echo Downloading setup script...
set PS1_URL=https://raw.githubusercontent.com/kevinkidtw/TubitBlockWebOnline/main/local-compiler/start_link.ps1
set PS1_TMP=%TEMP%\tubitblock_start_link.ps1
powershell -ExecutionPolicy Bypass -NoProfile -Command "Invoke-WebRequest -Uri '%PS1_URL%' -OutFile '%PS1_TMP%' -UseBasicParsing"
if errorlevel 1 (
    echo Failed to download setup script. Please check your internet connection.
    pause
    exit /b 1
)
powershell -ExecutionPolicy Bypass -NoProfile -File "%PS1_TMP%"
if errorlevel 1 (
    echo Error occurred. Please check the messages above.
)
del "%PS1_TMP%" 2>nul
pause
