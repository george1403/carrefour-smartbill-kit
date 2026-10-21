@echo off
chcp 65001 >nul
REM Windows: dublu-click pentru meniu, sau: run.bat orders / run.bat fill NR
setlocal
REM stale test hooks (mock/demo variables inherited by Explorer) never reach a real run
if not "%KIT_TEST_MODE%"=="1" for %%V in (KIT_SETUP_MOCK KIT_CARREFOUR_DOCS_URL KIT_DEMO_MOCK_MODE KIT_STOP_BEFORE_FINAL KIT_BULK_CONFIRM KIT_IMPORT_CONFIRM KIT_RATE_MS KIT_RETRY_MS KIT_SUBMIT_WAIT KIT_NAV_TIMEOUT KIT_MANUAL_TIMEOUT_MS KIT_SLOW KIT_SUPPORT_NO_SELFTEST KIT_TEST_CLOSE_MS KIT_TEST_HEADLESS KIT_TEST_DESKTOPS KIT_TEST_DIALOG KIT_TEST_SAC) do set "%%V="
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
if /i "%~1"=="ui" if "%RC%"=="0" exit /b 0
if not "%KIT_NO_PAUSE%"=="1" pause
exit /b %RC%
:noinstall
echo Programul nu este instalat complet (lipseste Node.js sau bibliotecile).
echo Da dublu-click o data pe install.bat, apoi incearca din nou.
if not "%KIT_NO_PAUSE%"=="1" powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName PresentationFramework; [void][System.Windows.MessageBox]::Show('Programul nu este instalat complet. Dati dublu-click pe install.bat din folderul programului (%KIT:'=''%), apoi porniti din nou scurtatura.','Carrefour SmartBill')" >nul 2>nul
if not "%KIT_NO_PAUSE%"=="1" pause
exit /b 9
