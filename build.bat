@echo off
REM Build Inkwave.exe for Windows
setlocal

echo =^> Installing build dependencies...
pip install pyinstaller pyinstaller-hooks-contrib
if errorlevel 1 goto :error

echo =^> Cleaning previous build...
if exist build rmdir /s /q build
if exist dist  rmdir /s /q dist

echo =^> Running PyInstaller...
pyinstaller inkwave.spec
if errorlevel 1 goto :error

echo.
echo =^> Build complete: dist\Inkwave.exe
echo.

REM Optional: create an installer with Inno Setup (if iscc is on PATH)
where iscc >nul 2>&1
if %errorlevel%==0 (
  echo =^> Creating Windows installer with Inno Setup...
  iscc inkwave_installer.iss
  echo =^> Installer ready: dist\InkwaveSetup.exe
) else (
  echo (Skipping installer -- install Inno Setup from https://jrsoftware.org/isinfo.php)
)

goto :end

:error
echo.
echo Build failed.
exit /b 1

:end
endlocal
