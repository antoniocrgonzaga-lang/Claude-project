@echo off
rem ============================================================
rem  ECHO STAR - starts a local server and opens the game
rem  Just double-click this file.
rem  Close this window (or press Ctrl+C) to stop the server.
rem  (No Python? Open dist\echo-star.html instead - it needs no server.)
rem ============================================================
title Echo Star - local server
cd /d "%~dp0"

rem Fixed port: the game's save (localStorage) is tied to the address
rem http://localhost:8080, so changing the port would "hide" your progress.
set "PORT=8080"
set "URL=http://localhost:%PORT%"

rem --- find Python (python or the py launcher) ---
set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (where py >nul 2>nul && set "PY=py")
if not defined PY goto nopython

rem --- port already in use? the game is probably already running ---
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul
if not errorlevel 1 goto portbusy

echo.
echo   ECHO STAR
echo   Server running at %URL%
echo   Close this window to stop it.
echo.

rem Open the browser 1 second later, once the server is up.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process '%URL%'"

%PY% serve.py %PORT%
echo.
echo The server has stopped.
pause
exit /b 0

:portbusy
echo.
echo Port %PORT% is already in use - the game is probably already running.
echo Opening %URL% in your browser...
start "" "%URL%"
echo.
echo If the page does not open, close the other program using port %PORT%
echo and run this file again.
pause
exit /b 0

:nopython
echo.
echo Python was not found.
echo Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH")
echo and run this file again - or simply open dist\echo-star.html.
pause
exit /b 1
