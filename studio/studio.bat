@echo off
rem Studio office launcher. Usage: studio.bat [start|ceo|head <name>|status|stop <id>|lock|unlock]
rem No argument = start. Scripts on the NAS are blocked by PowerShell's RemoteSigned
rem policy, so this runs a local copy (no policy change needed).
if not exist "%USERPROFILE%\pa-studio" mkdir "%USERPROFILE%\pa-studio"
copy /y "%~dp0studio.ps1" "%USERPROFILE%\pa-studio\studio.ps1" >nul
if "%~1"=="" (
  powershell -NoProfile -File "%USERPROFILE%\pa-studio\studio.ps1" start
) else (
  powershell -NoProfile -File "%USERPROFILE%\pa-studio\studio.ps1" %*
)
