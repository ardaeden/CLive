"""Serves CLive on http://127.0.0.1:<port>.

Usage: python server.py [port] [--open]
  --open  also open the page in the default browser
"""

import http.server
import os
import socketserver
import sys
import webbrowser

args = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(args[0]) if args else 8000
OPEN_BROWSER = "--open" in sys.argv[1:]
URL = f"http://127.0.0.1:{PORT}"

# Serve the folder this file lives in, whatever the current directory is.
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".wasm": "application/wasm",
    }

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer.daemon_threads = True
with socketserver.ThreadingTCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"CLive: {URL}  (Ctrl+C or close this window to stop)")
    if OPEN_BROWSER:
        # The socket is already listening, so the browser's first request just waits.
        webbrowser.open(URL)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("Stopped.")
