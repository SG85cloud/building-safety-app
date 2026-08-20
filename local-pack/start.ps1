# Double-click or: powershell -ExecutionPolicy Bypass -File start.ps1
Set-Location $PSScriptRoot
& (Join-Path $PSScriptRoot 'serve.ps1')
