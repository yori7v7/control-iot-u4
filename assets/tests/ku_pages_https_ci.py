"""K-U: pagina HTTPS temporal en el loopback de GitHub Actions.

El dominio de la URL se resuelve a 127.0.0.1 SOLO en el runner efimero.
Esta pagina minima sirve el modulo REAL GuestAdmissionService.js, pero no
expone ni copia la pagina completa de produccion. Sin AWS ni actuadores.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import ssl
import sys
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "assets/js/services/GuestAdmissionService.js"
HTML = b"""<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
content="default-src 'none'; script-src 'self'; connect-src https://ks.localhost:9443; base-uri 'none'; form-action 'none'">
<title>K-U HTTPS laboratorio aislado</title></head>
<body><main>K-U HTTPS solo virtual, sin controles fisicos.</main></body></html>"""
HOSTS = ("yori7v7.github.io", "evil.example")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.headers.get("Host") not in HOSTS or self.path.count("?"):
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if path == "/control-iot-u4/":
            data = HTML
            kind = "text/html; charset=utf-8"
        elif path == "/control-iot-u4/assets/js/services/GuestAdmissionService.js":
            data = MODULE.read_bytes()
            kind = "application/javascript; charset=utf-8"
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, _format, *_args) -> None:
        pass

    def do_POST(self) -> None:
        self.send_error(405)


def main() -> int:
    if (os.getenv("GITHUB_ACTIONS") != "true" or
            os.getenv("KU_CI_LAB") != "isolated-loopback-only"):
        print("[K-U pages] CI aislado obligatorio.")
        return 1
    ca_root = Path(os.environ["RUNNER_TEMP"]).resolve()
    cert = Path(os.environ["KU_PAGES_CRT"]).resolve()
    key = Path(os.environ["KU_PAGES_KEY"]).resolve()
    if not all(p.is_file() and p.is_relative_to(ca_root) for p in (cert, key)):
        print("[K-U pages] Certificados temporales no validos.")
        return 1
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(str(cert), str(key))
    server = ThreadingHTTPServer(("127.0.0.1", 443), Handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print("[K-U pages] HTTPS virtual 127.0.0.1:443, sin Internet.", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
