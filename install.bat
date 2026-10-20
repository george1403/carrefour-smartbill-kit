@echo off
chcp 65001 >nul
REM Windows: dublu-click. Instaleaza tot ce trebuie (fara administrator) si porneste configurarea.
REM files from a downloaded ZIP carry the "from internet" mark: unblock the kit folder first (else PowerShell can refuse silently)
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-ChildItem -LiteralPath '%~dp0.' -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue" >nul 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%RC%"=="0" (
  echo.
  echo INSTALAREA NU S-A TERMINAT ^(cod %RC%^).
  echo Daca fereastra s-a inchis sau nu a scris nimic: Windows a blocat fisierele descarcate.
  echo Click dreapta pe ZIP-ul descarcat ^> Proprietati ^> bifeaza "Deblocheaza" ^> OK,
  echo dezarhiveaza din nou si da dublu-click pe install.bat.
)
if not "%KIT_NO_PAUSE%"=="1" pause
exit /b %RC%
