@echo off
REM ============================================================
REM  life-tracker - full stack dev mode (tauri dev)
REM  - Frontend renderer/*  -> Vite HMR auto-reload
REM  - Backend  src-tauri/* -> cargo incremental rebuild, window auto-restart
REM  - Shared core packages/tracker-core changes hot-reload too
REM  - Vite dev server: http://localhost:1421
REM  - Close window to exit
REM ============================================================

cd /d "%~dp0"

echo ============================================
echo  life-tracker dev (tauri dev)
echo ============================================
echo  - Vite HMR: frontend changes auto-reload
echo  - Cargo:    rust changes auto-rebuild + restart
echo  - URL:      http://localhost:1421
echo ============================================
echo.

call npm run dev
