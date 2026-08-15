@echo off
setlocal
set "SCRIPT=%~dp0Staging-Doctor.ps1"
set "MODE=%~1"
if "%MODE%"=="" set "MODE=Status"
if not exist "%SCRIPT%" (
  echo STAGING_DOCTOR_FAIL_CLOSED: missing Staging-Doctor.ps1
  pause
  exit /b 1
)
if /I "%MODE%"=="Repair" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','%SCRIPT%','-Mode','Repair','-RepairTasks'; exit $p.ExitCode"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','%SCRIPT%','-Mode','%MODE%'; exit $p.ExitCode"
)
set "CODE=%ERRORLEVEL%"
echo.
echo Maintenance logs: "%~dp0logs"
if exist "%~dp0logs\maintenance-status.json" type "%~dp0logs\maintenance-status.json"
if exist "%~dp0logs\last-failure.json" (
  echo --- Last failure ---
  type "%~dp0logs\last-failure.json"
)
if not "%CODE%"=="0" echo Doctor completed with code %CODE%. No destructive repair was attempted.
pause
exit /b %CODE%
