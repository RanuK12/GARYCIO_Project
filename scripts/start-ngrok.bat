@echo off
echo ========================================
echo   GARYCIO - ngrok tunnel
echo ========================================
echo.
echo Iniciando tunel ngrok en puerto 3000...
echo Copia la URL "Forwarding" que aparece abajo
echo y usala en Meta Developer como webhook.
echo.
"C:\Users\emilio\AppData\Local\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe" http 3000
