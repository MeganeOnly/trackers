@echo off
REM ============================================================
REM  life-tracker - renderer-only dev mode (vite dev, no cargo)
REM  - No Rust compile, fast startup, for UI-only debugging
REM  - Open http://localhost:1421 in browser to view
REM  - Note: Tauri native APIs (invoke) fail in browser,
REM    use only for UI / styles / pure logic, not file I/O
REM ============================================================

cd /d "%~dp0"

echo ============================================
echo  life-tracker dev (vite only, no cargo)
echo ============================================
echo  - Vite HMR: frontend changes auto-reload
echo  - Open browser at http://localhost:1421
echo  - Tauri invoke fails in browser, UI-only debugging
echo ============================================
echo.

call npm run dev:vite
