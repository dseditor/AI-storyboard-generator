@echo off
title AI Storyboard Generator - Startup

echo =====================================
echo   AI Storyboard Generator - Startup
echo =====================================
echo.

:: Check if Node.js is installed
echo [1/4] Checking Node.js environment...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo Please download and install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

:: Display Node.js version
for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
echo [OK] Node.js version: %NODE_VERSION%
echo.

:: Check if npm is installed
echo [2/4] Checking npm environment...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not installed!
    echo npm should be installed with Node.js. Please reinstall Node.js
    echo.
    pause
    exit /b 1
)

:: Display npm version
for /f "tokens=*" %%i in ('npm --version') do set NPM_VERSION=%%i
echo [OK] npm version: %NPM_VERSION%
echo.

:: Check if node_modules exists
echo [3/4] Checking project dependencies...
if not exist "node_modules" (
    echo [INFO] node_modules folder not found. Installing dependencies...
    echo.
    npm install
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo [ERROR] Failed to install dependencies!
        echo Please check your internet connection or run manually: npm install
        echo.
        pause
        exit /b 1
    )
    echo.
    echo [OK] Dependencies installed successfully!
) else (
    echo [OK] Project dependencies found
)
echo.

:: Check if ComfyUI folder exists
if not exist "ComfyUI" (
    echo [WARNING] ComfyUI folder not found!
    echo To use video generation feature, make sure ComfyUI folder contains workflow files
    echo.
)

:: Start the development server
echo [4/4] Starting development server...
echo.
echo =====================================
echo   Server starting...
echo   Open the displayed URL in your browser
echo   Press Ctrl+C to stop the server
echo =====================================
echo.

npm run dev

:: If npm run dev exits, pause
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Failed to start server!
    echo.
)
pause
