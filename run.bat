@echo off
chcp 65001 >nul
REM Windows: dublu-click pentru meniu, sau: run.bat orders / run.bat fill NR
setlocal
set "KIT=%~dp0"
for /d %%D in ("%KIT%.runtime\node-v*-win-*") do set "PATH=%%~fD;%PATH%"
set "PLAYWRIGHT_BROWSERS_PATH=%KIT%.runtime\browsers"
set "ARGS=%*"
if "%ARGS%"=="" set "ARGS=menu"
where node >nul 2>nul
if errorlevel 1 goto noinstall
if not exist "%KIT%node_modules\playwright" goto noinstall
cd /d "%KIT%"
node "%KIT%bin\kit.js" %ARGS%
set "RC=%ERRORLEVEL%"
if not "%KIT_NO_PAUSE%"=="1" pause
exit /b %RC%
:noinstall
echo Programul nu este instalat complet (lipseste Node.js sau bibliotecile).
echo Da dublu-click o data pe install.bat, apoi incearca din nou.
if not "%KIT_NO_PAUSE%"=="1" pause
exit /b 9
