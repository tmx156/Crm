@echo off
echo ========================================
echo    Stopping CRM Development Servers
echo ========================================
echo.

echo Stopping Node.js processes...

REM Kill all node processes (be careful with this in production!)
taskkill /f /im node.exe 2>nul

echo.
echo All CRM processes stopped.
echo.
pause

