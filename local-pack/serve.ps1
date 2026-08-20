param(
    [int]$Port = 8000,
    [switch]$NoBrowser
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$appDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

$mimeTypes = @{
    '.html' = 'text/html; charset=utf-8'
    '.htm'  = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.webp' = 'image/webp'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.ttf'  = 'font/ttf'
    '.hwpx' = 'application/octet-stream'
    '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    '.xls'  = 'application/vnd.ms-excel'
    '.pdf'  = 'application/pdf'
    '.txt'  = 'text/plain; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
}

function Test-PortFree([int]$CandidatePort) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $CandidatePort)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Get-FreePort([int]$StartPort) {
    for ($p = $StartPort; $p -lt ($StartPort + 20); $p++) {
        if (Test-PortFree $p) { return $p }
    }
    return $StartPort
}

function Send-StaticFile($response, [string]$filePath) {
    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
    $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $response.StatusCode = 200
    $response.ContentType = $contentType
    $response.ContentLength64 = $bytes.Length
    $response.OutputStream.Write($bytes, 0, $bytes.Length)
}

$Port = Get-FreePort $Port
$url = "http://127.0.0.1:$Port/"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($url)
$listener.Start()

Write-Host ''
Write-Host '========================================'
Write-Host ' Building Safety App - Local Server'
Write-Host '========================================'
Write-Host " App : $appDir"
Write-Host " URL : $url"
Write-Host ' Stop: Ctrl+C in this window'
Write-Host ''

if (-not $NoBrowser) {
    Start-Process $url | Out-Null
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $rawPath = [System.Uri]::UnescapeDataString($request.Url.LocalPath.TrimStart('/'))
        if ([string]::IsNullOrWhiteSpace($rawPath)) { $rawPath = 'index.html' }
        $rawPath = $rawPath -replace '/', [System.IO.Path]::DirectorySeparatorChar

        $candidate = Join-Path $appDir $rawPath
        $resolved = $null
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
        }

        if ($resolved -and $resolved.StartsWith($appDir, [System.StringComparison]::OrdinalIgnoreCase)) {
            Send-StaticFile $response $resolved
        } else {
            $response.StatusCode = 404
            $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
            $response.OutputStream.Write($body, 0, $body.Length)
        }

        $response.Close()
    } catch {
        if ($listener.IsListening) {
            Write-Host "Request error: $_"
        }
    }
}
