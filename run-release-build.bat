@echo off
rem Runs the packaged release build (dist\win-unpacked) with the stock Electron
rem runtime from node_modules. Smart App Control allows the stock electron.exe,
rem but blocks the renamed .exe produced by the build until it is code-signed.
setlocal
set "ELECTRON=%~dp0node_modules\electron\dist\electron.exe"
set "APP=%~dp0dist\win-unpacked\resources\app.asar"
if not exist "%ELECTRON%" (
  echo Electron runtime not found. Run "npm install" in %~dp0 first.
  pause
  exit /b 1
)
if not exist "%APP%" (
  echo Release build not found. Run "npm run build:win" in %~dp0 first.
  pause
  exit /b 1
)
set ELECTRON_RUN_AS_NODE=
start "" "%ELECTRON%" "%APP%"
