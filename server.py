#!/usr/bin/env python3
"""
Minimal HTTP server for the Virtual Electronics Lab.

Usage:
    python server.py            # serves on http://localhost:8000
    python server.py 3000       # serves on http://localhost:3000

A plain file:// URL won't work because ES modules require HTTP.
This script adds the correct CORS and MIME headers automatically.
"""

import http.server
import socketserver
import sys
import os
import webbrowser
from threading import Timer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow CDN scripts (Three.js, MediaPipe) to load without CORS errors.
        # NOTE: COOP/COEP headers are intentionally omitted — they block MediaPipe
        # from fetching its own WASM and model files from the CDN.
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

    def guess_type(self, path):
        # Ensure JS modules are served with the right MIME type
        if str(path).endswith('.js'):
            return 'application/javascript'
        result = super().guess_type(path)
        # Python 3.14+ guess_type may return different tuple shapes
        return result[0] if isinstance(result, tuple) else result

    def log_message(self, fmt, *args):
        # Suppress noisy request logs; only show errors
        if args[1] not in ('200', '304'):
            super().log_message(fmt, *args)

os.chdir(os.path.dirname(os.path.abspath(__file__)))

url = f'http://localhost:{PORT}/landing.html'

def open_browser():
    webbrowser.open(url)

with socketserver.TCPServer(('', PORT), Handler) as httpd:
    print(f'\n  Virtual Electronics Lab')
    print(f'  ─────────────────────────────────')
    print(f'  Server running at:  {url}')
    print(f'  Press Ctrl+C to stop.\n')
    Timer(1.0, open_browser).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')
