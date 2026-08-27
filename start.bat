@echo off
REM ============================================================
REM  trackers quick launcher (monorepo root, npm workspaces)
REM  - life-tracker  goals tracker      Vite port 1421
REM  - book-tracker  books tracker      Vite port 1420
REM  - shared kernel: packages/tracker-core + crates/tracker-core
REM
REM  Usage:
REM    double-click the file -> interactive menu
REM    or pass a flag:  start.bat 1   (1-5 = menu items)
REM
REM  Install (workspaces, run once at repo root):
REM    npm install    (creates <repo-root>\node_modules with hoisted deps)
REM
REM  NOTE: keep this file ASCII-only (no CJK). cmd.exe parses
REM  batch files with the system OEM codepage (GBK on zh-CN);
REM  UTF-8 Chinese bytes corrupt the script.
REM ============================================================
setlocal EnableExtensions
cd /d "%~dp0"

if not "%~1"=="" (
    set "choice=%~1"
    goto run
)

:menu
cls
echo ==================================================
echo    trackers quick launcher (npm workspaces)
echo    [1] life-tracker  full dev    (tauri dev + Vite 1421)
echo    [2] book-tracker  full dev    (tauri dev + Vite 1420)
echo    [3] life-tracker  renderer    (Vite 1421, browser debug)
echo    [4] book-tracker  renderer    (Vite 1420, browser debug)
echo    [5] run all tests             (cargo test + core vitest)
echo    [6] install deps              (npm install at root, hoists all)
echo    [0] exit
echo ==================================================
set "choice="
set /p "choice=choice (0-6): "
if "%choice%"=="" goto menu

:run
if "%choice%"=="1" goto life
if "%choice%"=="2" goto book
if "%choice%"=="3" goto life_vite
if "%choice%"=="4" goto book_vite
if "%choice%"=="5" goto tests
if "%choice%"=="6" goto install
if "%choice%"=="0" exit /b 0
goto menu

:life
call npm --workspace life-tracker run dev
goto menu

:book
call npm --workspace book-tracker run dev
goto menu

:life_vite
call npm --workspace life-tracker run dev:vite
goto menu

:book_vite
call npm --workspace book-tracker run dev:vite
goto menu

:tests
echo ==================================================
echo  TS kernel tests (packages/tracker-core) ...
echo ==================================================
call npm run test:core
echo.
echo ==================================================
echo  book-tracker vitest ...
echo ==================================================
call npm run test:book
echo.
echo ==================================================
echo  life-tracker vitest ...
echo ==================================================
call npm run test:life
echo.
echo ==================================================
echo  Rust workspace tests (cargo test) ...
echo ==================================================
call cargo test
echo.
pause
goto menu

:install
echo ==================================================
echo  Running npm install at repo root (workspaces) ...
echo ==================================================
call npm install
echo.
pause
goto menu
