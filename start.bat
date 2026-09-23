@echo off
rem Starts CLive and opens it in the default browser. Optional argument: port (default 8000).
rem Set CLIVE_NO_BROWSER=1 to start the server without opening a browser.
setlocal
cd /d "%~dp0"

set "PORT=%~1"
if not defined PORT set "PORT=8000"
set "URL=http://127.0.0.1:%PORT%"

set "PY="
where py >nul 2>nul && py -3 --version >nul 2>nul && set "PY=py -3"
if not defined PY (
  where python >nul 2>nul && set "PY=python"
)
if not defined PY (
  echo Python 3 was not found. Install it from https://www.python.org/downloads/ and run this file again.
  pause
  exit /b 1
)

rem Something is already listening on this port: it is either CLive or another program.
netstat -ano | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 goto busy

set "OPEN=--open"
if defined CLIVE_NO_BROWSER set "OPEN="

%PY% server.py %PORT% %OPEN%
if errorlevel 1 (
  echo.
  echo The server stopped with an error, see the message above.
  pause
)
exit /b 0

:busy
set "IS_CLIVE=1"
where curl >nul 2>nul && (
  curl -s -m 2 "%URL%/index.html" | findstr /C:"<title>CLive</title>" >nul 2>nul
  if errorlevel 1 set "IS_CLIVE="
)
if not defined IS_CLIVE (
  echo Port %PORT% is used by another program, not CLive.
  echo Close that program, or start CLive on another port, for example: start.bat 8001
  pause
  exit /b 1
)
echo CLive is already running on %URL%
if defined CLIVE_NO_BROWSER exit /b 0
echo Opening it in your browser. To restart it, close the CLive window that started it first.
start "" "%URL%"
ping -n 5 127.0.0.1 >nul
exit /b 0
