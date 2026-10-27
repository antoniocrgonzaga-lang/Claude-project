@echo off
rem ============================================================
rem  start.bat - inicia o Dark Oblivion localmente.
rem
rem  De dois cliques neste arquivo: ele sobe o servidor e abre
rem  o jogo no navegador (http://localhost:8000).
rem  Para parar o servidor, feche esta janela (ou aperte Ctrl+C).
rem ============================================================
title Dark Oblivion - servidor local
cd /d "%~dp0"

rem Procura o Python: primeiro "python", depois o lancador "py"
set "PY=python"
python --version >nul 2>nul
if errorlevel 1 (
    set "PY=py"
    py --version >nul 2>nul
    if errorlevel 1 goto :nopython
)

%PY% server.py 8000 --open
echo.
pause
exit /b 0

:nopython
echo.
echo  [ERRO] Python nao foi encontrado neste computador.
echo  Instale em https://www.python.org/downloads/ e, na instalacao,
echo  marque a opcao "Add python.exe to PATH".
echo.
pause
exit /b 1
