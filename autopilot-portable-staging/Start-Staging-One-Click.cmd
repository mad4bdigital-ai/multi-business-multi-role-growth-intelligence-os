@echo off
setlocal
set "LAUNCHER=%~dp0Invoke-Staging-One-Click.ps1"
if not exist "%LAUNCHER%" (
  echo STAGING_DUAL_MODE_ONE_CLICK_FAIL_CLOSED: missing Invoke-Staging-One-Click.ps1
  pause
  exit /b 1
)

set "TUNNEL_MODE=%~1"
if "%TUNNEL_MODE%"=="" set "TUNNEL_MODE=windows_service"
if /I not "%TUNNEL_MODE%"=="windows_service" if /I not "%TUNNEL_MODE%"=="docker_sidecar" if /I not "%TUNNEL_MODE%"=="disabled" (
  echo Invalid tunnel mode: %TUNNEL_MODE%
  echo Usage: Start-Staging-One-Click.cmd [windows_service^|docker_sidecar^|disabled]
  pause
  exit /b 2
)

echo Starting governed Staging One-Click mode=%TUNNEL_MODE%
echo windows_service: Windows cloudflared -^> 127.0.0.1:8080
echo docker_sidecar : Compose cloudflared -^> 127.0.0.1:8080 ^(shared app network namespace^)
echo disabled       : local-only Staging
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File','%LAUNCHER%','-TunnelMode','%TUNNEL_MODE%','-NoAutoDeploy'; exit $p.ExitCode"
set "CODE=%ERRORLEVEL%"
echo.
echo Auto Pilot log directory: "%~dp0logs"
if not "%CODE%"=="0" (
  echo Staging One-Click stopped with code %CODE%.
  echo No Production or provider mutation was authorized by this launcher.
)
pause
exit /b %CODE%
