@echo off
title NEON HYPERDRIVE 2
cd /d "%~dp0"
echo Iniciando NEON HYPERDRIVE 2...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" -Port 8080
if errorlevel 1 pause
