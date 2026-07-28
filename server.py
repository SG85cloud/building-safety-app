import http.server
import socketserver
import os

PORT = 8000
DIRECTORY = r"C:\Users\ST-SUGEUN\.gemini\antigravity\scratch\building-safety-app"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print(f"Python Zero-Host-Validation Server started on port {PORT}")
    httpd.serve_forever()
