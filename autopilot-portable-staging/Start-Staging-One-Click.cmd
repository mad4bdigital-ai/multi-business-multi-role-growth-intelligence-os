@echo off
setlocal
set "BOOTSTRAP=%~dp0Bootstrap-Staging-One-Click.ps1"
if not exist "%BOOTSTRAP%" (
  echo AUTO_PILOT_ONE_CLICK_FAIL_CLOSED: missing Bootstrap-Staging-One-Click.ps1
  pause
  exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','%BOOTSTRAP%'; exit $p.ExitCode"
set "CODE=%ERRORLEVEL%"
echo.
echo Auto Pilot log directory: "%~dp0logs"
if exist "%~dp0logs\last-failure.json" (
  echo --- Last recorded failure ---
  type "%~dp0logs\last-failure.json"
  echo --- End failure ---
)
if exist "%~dp0logs\bootstrap-console.log" (
  echo --- Bootstrap diagnostic ---
  type "%~dp0logs\bootstrap-console.log"
  echo --- End bootstrap diagnostic ---
)
if not "%CODE%"=="0" (
  echo.
  echo Auto Pilot stopped with code %CODE%. No Production or provider mutation was performed.
  echo The full diagnostic remains in "%~dp0logs\operations.jsonl"
)
pause
exit /b %CODE%
