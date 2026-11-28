@echo off
setlocal
title RescueBite - Global Public HTTPS Tunnel + Java Server

start "RescueBite Java Server" cmd /c "start-server.bat"
timeout /t 3 /nobreak >nul

echo ====================================================================
echo   Starting Global Public HTTPS URL via Cloudflare Tunnel...
echo   Share the https://....trycloudflare.com URL below with anyone!
echo ====================================================================
"C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --url http://localhost:8080
