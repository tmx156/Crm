@echo off
echo ========================================
echo    CRM Offline Development Starter
echo ========================================
echo.

echo Starting server and client...
echo.

REM Start the server in a new window
start "CRM Server" cmd /k "cd /d %~dp0 && cd server && npm start"

REM Wait a moment for server to start
timeout /t 3 /nobreak >nul

REM Start the client in a new window
start "CRM Client" cmd /k "cd /d %~dp0 && cd client && npm start"

echo.
echo ========================================
echo    Both server and client are starting
echo ========================================
echo.
echo Server: http://localhost:5000
echo Client: http://localhost:3000
echo.
echo Press any key to close this window...
pause >nul
