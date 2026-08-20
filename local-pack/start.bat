@echo off
chcp 65001 >nul
title Building Safety App - Local Server
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
