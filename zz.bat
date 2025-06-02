@echo off
echo Generating project structure...
rem Navigate to your project directory
cd /d %~dp0

rem Output folder and file structure excluding node_modules, .next, .git, .ssh, image files, .bat files, .py files, and files with no extensions
echo Listing folders and files...
for /f "delims=" %%i in ('dir /S /B /A-D ^| findstr /v /i "\\node_modules\\" ^| findstr /v /i "\\.next\\" ^| findstr /v /i "\\.git\\" ^| findstr /v /i "\\.ssh\\" ^| findstr /v /i ".png" ^| findstr /v /i ".jpg" ^| findstr /v /i ".jpeg" ^| findstr /v /i ".gif" ^| findstr /v /i ".bmp" ^| findstr /v /i ".svg" ^| findstr /v /i ".bat" ^| findstr /v /i ".py" ^| findstr /r /v "^[^.]*$"') do echo %%i >> project-structure.txt

echo Project structure saved to project-structure.txt
pause
