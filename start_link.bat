@echo off
title TubitBlockWeb
cd /d "%~dp0"
echo [%date% %time%] TubitBlockWeb Launcher started > launcher.log
echo [%date% %time%] Current directory: %cd% >> launcher.log
if not exist start_link.ps1 (
    echo Downloading start_link.ps1 ...
    echo [%date% %time%] Downloading ps1 >> launcher.log
    powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest 'https://raw.githubusercontent.com/kevinkidtw/TubitBlockWeb/main/start_link.ps1' -OutFile 'start_link.ps1'" >> launcher.log 2>&1
)
echo [%date% %time%] Launching PowerShell script >> launcher.log
powershell -ExecutionPolicy Bypass -NoProfile -File "start_link.ps1" 2>> launcher.log
echo.
echo [%date% %time%] Script exited with code: %errorlevel% >> launcher.log
echo If you see errors above, check launcher.log for details.
pause
