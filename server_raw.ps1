# Windows Native PowerShell TCP HTTP Server (Full Packet Buffer Read & Flush)
$port = 8000
$appDir = "C:\Users\ST-SUGEUN\.gemini\antigravity\scratch\building-safety-app"

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$listener.Server.ReuseAddress = $true
$listener.Start()

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
}

while ($true) {
    try {
        $client = $listener.AcceptTcpClient()
        $stream = $client.GetStream()
        $buffer = New-Object byte[] 8192
        $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
        
        if ($bytesRead -gt 0) {
            $requestString = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)
            $lines = $requestString.Split("`n")
            if ($lines.Length -gt 0) {
                $firstLine = $lines[0].Trim()
                $parts = $firstLine.Split(" ")
                if ($parts.Length -ge 2) {
                    $rawPath = $parts[1].Split("?")[0].TrimStart('/')
                    if ([string]::IsNullOrWhiteSpace($rawPath)) { $rawPath = "index.html" }
                    $filePath = Join-Path $appDir $rawPath

                    if (Test-Path $filePath -PathType Leaf) {
                        $contentBytes = [System.IO.File]::ReadAllBytes($filePath)
                        $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                        $ct = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                        
                        $header = "HTTP/1.1 200 OK`r`nContent-Type: $ct`r`nContent-Length: $($contentBytes.Length)`r`nAccess-Control-Allow-Origin: *`r`nConnection: close`r`n`r`n"
                        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
                        $stream.Write($headerBytes, 0, $headerBytes.Length)
                        $stream.Write($contentBytes, 0, $contentBytes.Length)
                        $stream.Flush()
                    } else {
                        $header = "HTTP/1.1 404 Not Found`r`nContent-Length: 0`r`nConnection: close`r`n`r`n"
                        $headerBytes = [System.Text.Encoding]::UTF8.GetBytes($header)
                        $stream.Write($headerBytes, 0, $headerBytes.Length)
                        $stream.Flush()
                    }
                }
            }
        }
        $stream.Close()
        $client.Close()
    } catch {
        # Continue listening on minor socket drop
    }
}
