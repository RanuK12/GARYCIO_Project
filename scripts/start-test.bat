@echo off
echo ========================================
echo   GARYCIO - Arranque de pruebas
echo ========================================
echo.

REM Verificar PostgreSQL
echo [1/3] Verificando PostgreSQL...
"C:\Program Files\PostgreSQL\16\bin\pg_isready.exe" -h localhost -p 5432 >nul 2>&1
if errorlevel 1 (
    echo ERROR: PostgreSQL no esta corriendo.
    echo Inicialo desde pgAdmin o Windows Services.
    pause
    exit /b 1
)
echo   PostgreSQL: OK

REM Verificar .env
echo [2/3] Verificando .env...
if not exist .env (
    echo ERROR: No existe .env
    pause
    exit /b 1
)
echo   .env: OK

echo [3/3] Arrancando servidor...
echo.
echo ========================================
echo   IMPORTANTE: Abri OTRA terminal y ejecuta:
echo.
echo   "C:\Users\emilio\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe" http 3000
echo.
echo   Despues copia la URL https://xxxx.ngrok-free.app
echo   y configurala en Meta Developer como webhook:
echo   - Callback URL: https://xxxx.ngrok-free.app/webhook
echo   - Verify token: garycio_verify_2026
echo ========================================
echo.

npm run dev
