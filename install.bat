@echo off
chcp 65001 >nul
REM Windows: dublu-click. Instaleaza tot ce trebuie (fara administrator) si porneste configurarea.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
set "RC=%ERRORLEVEL%"
if not "%KIT_NO_PAUSE%"=="1" pause
exit /b %RC%
