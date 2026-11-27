"""HTTP-Server für MediTrack (nur Python-Standardbibliothek).

Läuft als Home-Assistant-Add-on hinter Ingress oder eigenständig:
    python3 server.py   ->  http://localhost:8099
Umgebungsvariablen:
    MEDITRACK_DB    Pfad zur SQLite-Datei (Standard: /data/meditrack.db)
    MEDITRACK_PORT  Port (Standard: 8099)
    MEDITRACK_HOST  Bind-Adresse (Standard: 0.0.0.0)
"""
from __future__ import annotations

import json
import logging
import mimetypes
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from core import Store, ValidationError, suggested_dose, to_iso, utcnow
from ha import Publisher

log = logging.getLogger("meditrack")
STATIC = Path(__file__).parent / "static"
INGRESS_IP = "172.30.32.2"
MAX_BODY = 64 * 1024


def load_options() -> dict:
    try:
        with open("/data/options.json", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


class App:
    def __init__(self, db_path: str, publish: bool):
        self.store = Store(db_path)
        self.publisher = Publisher(self.store, enabled=publish)
        # Als Add-on nur Zugriff über HA-Ingress zulassen
        self.ingress_only = bool(os.environ.get("SUPERVISOR_TOKEN"))


def make_handler(app: App):
    store = app.store

    class Handler(BaseHTTPRequestHandler):
        server_version = "MediTrack"

        def log_message(self, fmt, *args):  # ruhigeres Logging
            log.debug("%s - %s", self.address_string(), fmt % args)

        # ------------------------------------------------------------ utils
        def _send(self, status, payload=None, content_type="application/json",
                  raw: bytes | None = None, extra_headers=None):
            body = raw if raw is not None else json.dumps(
                payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra_headers or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json_body(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ValidationError("Anfrage zu gross")
            if not length:
                return {}
            try:
                data = json.loads(self.rfile.read(length))
            except ValueError as exc:
                raise ValidationError("Ungültiges JSON") from exc
            if not isinstance(data, dict):
                raise ValidationError("Ungültiges JSON")
            return data

        def _allowed(self):
            if app.ingress_only and self.client_address[0] != INGRESS_IP:
                self._send(HTTPStatus.FORBIDDEN, {"error": "Nur über Home Assistant erreichbar"})
                return False
            return True

        def _dispatch(self, method):
            if not self._allowed():
                return
            url = urlparse(self.path)
            path = re.sub(r"/+", "/", url.path)
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            try:
                if path.startswith("/api/"):
                    return self._api(method, path[len("/api/"):].strip("/"), query)
                if method in ("GET", "HEAD"):
                    return self._static(path)
                self._send(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Methode nicht erlaubt"})
            except ValidationError as exc:
                self._send(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except Exception:  # noqa: BLE001
                log.exception("Fehler bei %s %s", method, self.path)
                self._send(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "Interner Fehler"})

        def do_GET(self):
            self._dispatch("GET")

        def do_HEAD(self):
            self._dispatch("HEAD")

        def do_POST(self):
            self._dispatch("POST")

        def do_PUT(self):
            self._dispatch("PUT")

        def do_DELETE(self):
            self._dispatch("DELETE")

        # ----------------------------------------------------------- static
        def _static(self, path):
            name = "index.html" if path in ("", "/") else path.lstrip("/")
            target = (STATIC / name).resolve()
            if STATIC.resolve() not in target.parents or not target.is_file():
                return self._send(HTTPStatus.NOT_FOUND, {"error": "Nicht gefunden"})
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            self._send(HTTPStatus.OK, raw=target.read_bytes(), content_type=ctype)

        # -------------------------------------------------------------- api
        def _api(self, method, route, query):
            parts = route.split("/") if route else []
            res = parts[0] if parts else ""
            rid = None
            if len(parts) > 1:
                if not parts[1].isdigit() or len(parts) > 2:
                    return self._send(HTTPStatus.NOT_FOUND, {"error": "Nicht gefunden"})
                rid = int(parts[1])

            changed = False
            if res == "children":
                if method == "GET" and rid is None:
                    return self._send(200, store.list_children())
                if method == "POST" and rid is None:
                    changed = True
                    result = (201, store.create_child(self._json_body()))
                elif method == "PUT" and rid:
                    child = store.update_child(rid, self._json_body())
                    changed = True
                    result = (200, child) if child else (404, {"error": "Kind nicht gefunden"})
                elif method == "DELETE" and rid:
                    changed = True
                    result = (204, None) if store.delete_child(rid) else (404, {"error": "Kind nicht gefunden"})
                else:
                    result = (405, {"error": "Methode nicht erlaubt"})

            elif res == "medications":
                if method == "GET" and rid is None:
                    return self._send(200, store.list_medications(
                        include_archived=query.get("archived") == "1"))
                if method == "POST" and rid is None:
                    result = (201, store.create_medication(self._json_body()))
                elif method == "PUT" and rid:
                    med = store.update_medication(rid, self._json_body())
                    changed = True
                    result = (200, med) if med else (404, {"error": "Medikament nicht gefunden"})
                elif method == "DELETE" and rid:
                    result = (204, None) if store.delete_medication(rid) else (404, {"error": "Medikament nicht gefunden"})
                else:
                    result = (405, {"error": "Methode nicht erlaubt"})

            elif res == "doses":
                if method == "GET" and rid is None:
                    child_id = self._int(query.get("child_id"))
                    limit = min(self._int(query.get("limit")) or 200, 2000)
                    return self._send(200, store.list_doses(child_id, limit=limit))
                if method == "POST" and rid is None:
                    data = self._json_body()
                    dose_id, warnings = store.add_dose(data, force=bool(data.get("force")))
                    if dose_id is None:
                        result = (409, {"error": "Warnungen", "warnings": warnings})
                    else:
                        changed = True
                        result = (201, {"id": dose_id, "warnings": warnings})
                elif method == "PUT" and rid:
                    data = self._json_body()
                    res_upd = store.update_dose(rid, data, force=bool(data.get("force")))
                    if res_upd is None:
                        result = (404, {"error": "Gabe nicht gefunden"})
                    elif not res_upd[0]:
                        result = (409, {"error": "Warnungen", "warnings": res_upd[1]})
                    else:
                        changed = True
                        result = (200, {"id": rid, "warnings": res_upd[1]})
                elif method == "DELETE" and rid:
                    changed = True
                    result = (204, None) if store.delete_dose(rid) else (404, {"error": "Gabe nicht gefunden"})
                else:
                    result = (405, {"error": "Methode nicht erlaubt"})

            elif res == "check" and method == "POST":
                warnings, (child, med, *_rest) = store.check_dose(self._json_body())
                return self._send(200, {"warnings": warnings,
                                        "suggestion": suggested_dose(child, med)})

            elif res == "suggestion" and method == "GET":
                child = store.get_child(self._int(query.get("child_id")))
                med = store.get_medication(self._int(query.get("medication_id")))
                if not child or not med:
                    return self._send(404, {"error": "Nicht gefunden"})
                return self._send(200, {"suggestion": suggested_dose(child, med)})

            elif res == "recent" and method == "GET":
                return self._send(200, store.recent_medications(
                    self._int(query.get("child_id")),
                    limit=min(self._int(query.get("limit")) or 5, 20)))

            elif res == "status" and method == "GET":
                status = store.status(self._int(query.get("child_id")))
                if status is None:
                    return self._send(404, {"error": "Kind nicht gefunden"})
                return self._send(200, status)

            elif res == "export" and method == "GET":
                data = {
                    "exported_at": to_iso(utcnow()),
                    "children": store.list_children(),
                    "medications": store.list_medications(include_archived=True),
                    "doses": [d for c in store.list_children()
                              for d in store.list_doses(c["id"], limit=1_000_000)],
                }
                return self._send(200, data, extra_headers={
                    "Content-Disposition": 'attachment; filename="meditrack-export.json"'})

            elif res == "health":
                return self._send(200, {"ok": True})
            else:
                return self._send(404, {"error": "Nicht gefunden"})

            if changed:
                app.publisher.trigger()
            status, payload = result
            if status == 204:
                self.send_response(204)
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            return self._send(status, payload)

        @staticmethod
        def _int(value):
            if value in (None, ""):
                return None
            try:
                return int(value)
            except (TypeError, ValueError) as exc:
                raise ValidationError("Ungültige ID") from exc

    return Handler


def main():
    options = load_options()
    logging.basicConfig(
        level=getattr(logging, str(options.get("log_level", "info")).upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    db_path = os.environ.get("MEDITRACK_DB", "/data/meditrack.db")
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    app = App(db_path, publish=options.get("publish_sensors", True))
    app.publisher.start()
    host = os.environ.get("MEDITRACK_HOST", "0.0.0.0")
    port = int(os.environ.get("MEDITRACK_PORT", "8099"))
    server = ThreadingHTTPServer((host, port), make_handler(app))
    log.info("MediTrack läuft auf %s:%s (DB: %s)", host, port, db_path)
    server.serve_forever()


if __name__ == "__main__":
    main()
