# -*- coding: utf-8 -*-
"""
server.py
---------
Serveur local / Docker. Sert les fichiers statiques de public/ et expose les
memes endpoints que les fonctions serverless Vercel, via lib/endpoints.py.
Uniquement la bibliotheque standard de Python (aucune dependance externe).

Lancement : python3 server.py   puis   http://localhost:8080
"""

import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from lib.endpoints import validate, run, deploy

PORT = int(os.environ.get("PORT", "8080"))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")
MAX_BODY_BYTES = 256 * 1024

MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".py": "text/plain; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".png": "image/png",
}

ROUTES = {"/api/validate": validate, "/api/run": run, "/api/deploy": deploy}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):  # silence par defaut
        pass

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self):
        try:
            length = int(self.headers.get("content-length") or 0)
        except (TypeError, ValueError):
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            return {}
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}

    def do_POST(self):
        route = self.path.split("?")[0]
        fn = ROUTES.get(route)
        if fn is None:
            return self._send_json(404, {"error": "not_found"})
        status, payload = fn(self._read_body())
        self._send_json(status, payload)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path in ROUTES:
            return self._send_json(405, {"error": "method_not_allowed"})
        self._serve_static(path)

    def _serve_static(self, path):
        if path == "/" or path == "":
            path = "/index.html"
        # Empeche toute traversee : seul public/ est expose (ni lib/, ni api/,
        # ni le README organisateur).
        resolved = os.path.normpath(os.path.join(PUBLIC_DIR, path.lstrip("/")))
        if not resolved.startswith(PUBLIC_DIR) or not os.path.isfile(resolved):
            self.send_response(404)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"Not found")
            return
        with open(resolved, "rb") as handle:
            data = handle.read()
        ext = os.path.splitext(resolved)[1]
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def main():
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print("NOVA BANK incident console : http://localhost:%d" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
