@echo off
rem Opens the studio office. Needs PowerShell to allow local scripts
rem (Set-ExecutionPolicy -Scope CurrentUser RemoteSigned).
powershell -NoProfile -File "%~dp0studio.ps1" start
