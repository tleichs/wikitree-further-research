#!/usr/bin/env python3
"""Local demo server for the Further Research Finder.

The WikiTree API only accepts browser requests from apps.wikitree.com.
This server serves the app on http://localhost:8765 and forwards two paths:

  /wt-api   -> https://api.wikitree.com/api.php
  /wt-plus/ -> https://plus.wikitree.com/

Only these two hosts are reachable through it, and it listens on this
computer only. Not needed once the app is hosted on apps.wikitree.com.

Usage:  python3 dev-server.py [port]
"""
import http.server
import os
import ssl
import sys
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
ROUTES = {
    "/wt-api": "https://api.wikitree.com/api.php",
    "/wt-plus/": "https://plus.wikitree.com/",
}
USER_AGENT = "FurtherResearchFinder-dev/0.1"

# plus.wikitree.com only offers older TLS 1.2 ciphers that OpenSSL 3 rejects by
# default. Allow them for that host only. Certificates are still verified.
LEGACY_TLS = ssl.create_default_context()
LEGACY_TLS.set_ciphers("DEFAULT:@SECLEVEL=1")
DEFAULT_TLS = ssl.create_default_context()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def _target(self):
        for prefix, base in ROUTES.items():
            if self.path.startswith(prefix):
                rest = self.path[len(prefix):]
                if prefix == "/wt-api" and rest and not rest.startswith("?"):
                    return None
                return base + rest
        return None

    def _proxy(self, method):
        target = self._target()
        if target is None:
            return False
        body = None
        headers = {"User-Agent": USER_AGENT}
        if method == "POST":
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length)
            headers["Content-Type"] = self.headers.get("Content-Type", "application/x-www-form-urlencoded")
        req = urllib.request.Request(target, data=body, headers=headers, method=method)
        try:
            ctx = LEGACY_TLS if target.startswith("https://plus.wikitree.com/") else DEFAULT_TLS
            with urllib.request.urlopen(req, timeout=120, context=ctx) as res:
                data = res.read()
                status = res.status
                ctype = res.headers.get("Content-Type", "application/json")
        except urllib.error.HTTPError as err:
            data, status, ctype = err.read(), err.code, err.headers.get("Content-Type", "text/plain")
        except Exception as err:  # network errors
            data, status, ctype = str(err).encode(), 502, "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_GET(self):
        if not self._proxy("GET"):
            super().do_GET()

    def do_POST(self):
        if not self._proxy("POST"):
            self.send_error(404)


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Further Research Finder: http://localhost:{PORT}/")
    print("Example:  http://localhost:%d/?place=Zwickau,%%20Sachsen&from=1750&to=1800" % PORT)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
