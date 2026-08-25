@echo off
REM ============================================================
REM  BookTracker - full stack dev mode (tauri dev)
REM  - Frontend renderer/*  -> Vite HMR auto-reload
REM  - Backend  src-tauri/* -> cargo incremental rebuild, window auto-restart
REM  - Shared core packages/tracker-core changes hot-reload too
REM  - Vite dev server: http://localhost:1420
REM  - Close window to exit
REM ============================================================

cd /d "%~dp0"

echo ============================================
echo  BookTracker dev (tauri dev)
echo ============================================
echo  - Vite HMR: frontend changes auto-reload
echo  - Cargo:    rust changes auto-rebuild + restart
echo  - URL:      http://localhost:1420
echo ============================================
echo.

call npm run dev
