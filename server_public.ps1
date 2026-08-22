# Windows Native Public HTTPS Tunnel (Anonymous Keyless Tunnel - No Password Required)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host " 🌐 LTE / 5G 외부 인터넷 접속용 터널 주소를 생성하고 있습니다..." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""

# Start Raw TCP Web Server with Flush Buffer
Start-Process powershell -ArgumentList "-ExecutionPolicy Bypass -File `"$PSScriptRoot\server_raw.ps1`"" -WindowStyle Hidden
Start-Sleep -Seconds 2

# Anonymous Public Tunnel (localhost.run - Zero Password Prompt)
Write-Host "▶ 외부 접속 터널 생성 중 (localhost.run)..." -ForegroundColor Cyan
ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:8000 nokey@localhost.run
