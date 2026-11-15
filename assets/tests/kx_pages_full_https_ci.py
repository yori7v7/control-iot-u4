"""K-X: servir la página COMPLETA experimental por HTTPS, sólo en runner CI.

Conserva el index.html real, CSS, SVG y todos los módulos JS. Únicamente
en RAM cambia las dos flags de permisos para ejercer el contrato K-X.
No publica GitHub Pages ni cambia config.js en disco.
"""
from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import mimetypes
import os
from pathlib import Path
import ssl
import sys
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
PREFIX = "/control-iot-u4/"
API = "https://100-30-4-62.nip.io"


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.headers.get("Host") != "yori7v7.github.io" or "?" in self.path:
            self.send_error(403)
            return
        path = urlsplit(self.path).path
        if not path.startswith(PREFIX):
            self.send_error(404)
            return
        relative = path[len(PREFIX):] or "index.html"
        if (relative == "index.html" or relative in ("assets/icons.svg", "assets/favicon.svg")
                or relative.startswith(("assets/css/", "assets/js/"))):
            target = (ROOT / relative).resolve()
            if not target.is_relative_to(ROOT) or not target.is_file() or target.is_symlink():
                self.send_error(404)
                return
            data = target.read_bytes()
        else:
            self.send_error(404)
            return

        if relative == "assets/js/config.js":
            # Verificar el archivo REAL: la rama ya lleva ambos flags activos.
            # No parchear fuentes ni desactivar protecciones del navegador.
            source = data.decode("utf-8")
            required = ("guestAdmissionEnabled: true", "adminApprovalEnabled: true")
            if not all(source.count(x) == 1 for x in required):
                self.send_error(503, "Flags K-X no coinciden")
                return

        media = mimetypes.guess_type(relative)[0] or "application/octet-stream"
        if relative.endswith(".js"):
            media = "application/javascript"
        if relative.endswith((".html", ".css", ".js")):
            media += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        self.send_error(405)

    def log_message(self, *_args) -> None:
        pass


def main() -> int:
    if (sys.platform != "linux" or os.getenv("GITHUB_ACTIONS") != "true"
            or os.getenv("KX_CI_LAB") != "two-loopbacks-https"):
        print("[K-X Pages] Prohibido iniciar fuera de GitHub Actions.")
        return 2
    root = Path(os.environ["RUNNER_TEMP"]).resolve()
    crt = Path(os.environ.get("KX_PAGES_CRT", "/inexistente")).resolve()
    key = Path(os.environ.get("KX_PAGES_KEY", "/inexistente")).resolve()
    if (not crt.is_file() or not key.is_file()
            or not crt.is_relative_to(root) or not key.is_relative_to(root)):
        print("[K-X Pages] Certificados CI ausentes.")
        return 2
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.load_cert_chain(str(crt), str(key))
    server = ThreadingHTTPServer(("127.0.0.1", 443), Handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print("[K-X Pages] Página real completa HTTPS 127.0.0.1:443, simulación de origen.", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
