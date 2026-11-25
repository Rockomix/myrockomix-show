@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Always run Electron from this project's root, regardless of how the BAT was opened.
cd /d "%~dp0" || goto :missing_project
set "ELECTRON_RUN_AS_NODE="
set "ELECTRON=%CD%\node_modules\electron\dist\electron.exe"

if not exist "%CD%\package.json" goto :missing_package
if not exist "%CD%\electron-main.js" goto :missing_main
if not exist "%ELECTRON%" goto :missing_electron

start "myRockomix SHOW" /D "%CD%" "%ELECTRON%" "."
exit /b 0

:missing_project
echo No se pudo acceder a la carpeta de myRockomix SHOW.
pause
exit /b 1

:missing_package
echo Falta package.json en la carpeta de myRockomix SHOW.
pause
exit /b 1

:missing_main
echo Falta electron-main.js en la carpeta de myRockomix SHOW.
pause
exit /b 1

:missing_electron
echo Electron no esta instalado localmente.
echo Ejecuta npm install desde la carpeta de myRockomix SHOW.
pause
exit /b 1
