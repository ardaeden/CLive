"""Serves CLive on http://127.0.0.1:<port>.

Usage: python server.py [port] [--open]
  --open  also open the page in the default browser
"""

import http.server
import os
import socketserver
import sys
import urllib.parse
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

    raw = False

    def send_head(self):
        # Sample files are fetched as /sample?f=<name> rather than by their own path, and
        # sent as plain bytes: download managers (IDM, for one) hijack any request whose
        # URL ends in .wav, .mp3 and the like, and the page gets an empty reply instead.
        url = urllib.parse.urlsplit(self.path)
        self.raw = url.path == "/sample"
        if self.raw:
            name = urllib.parse.parse_qs(url.query).get("f", [""])[0].replace("\\", "/")
            if not name or any(part in ("", "..") for part in name.split("/")):
                self.send_error(404)
                return None
            self.path = "/samples/" + urllib.parse.quote(name)
        # Hidden files and folders (.git, .claude, ...) are not part of the app; don't serve them.
        # Decoded first, the same way translate_path does, so %2e can't sneak a dot past.
        path = urllib.parse.unquote(self.path.split("?", 1)[0].split("#", 1)[0])
        if any(part.startswith(".") for part in path.replace("\\", "/").split("/")):
            self.send_error(404)
            return None
        return super().send_head()

    def guess_type(self, path):
        return "application/octet-stream" if self.raw else super().guess_type(path)

    def end_headers(self):
        # Tells the app it is talking to this server, so a 404 from /sample means the file
        # is missing rather than that the endpoint does not exist (see engine.js).
        self.send_header("X-CLive", "1")
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
