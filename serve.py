#!/usr/bin/env python3
"""No-cache static server for the Loan vs. Sell Analyzer. Serves this folder on port 8766."""
import http.server, socketserver, os
PORT = 8766
os.chdir(os.path.dirname(os.path.abspath(__file__)))
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), NoCacheHandler) as httpd:
    print(f'Serving http://127.0.0.1:{PORT}/  (no-cache). Ctrl+C to stop.')
    httpd.serve_forever()
