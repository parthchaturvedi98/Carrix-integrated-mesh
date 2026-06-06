"""A tiny stdlib HTTP framework (no FastAPI/uvicorn dependency).

Just enough routing, JSON handling, CORS, and Server-Sent-Events to run the mock systems and
the orchestrator API on one ThreadingHTTPServer. A real deployment would swap this for a
production server — the route handlers are plain functions and would not change.
"""
from __future__ import annotations

import json
import mimetypes
import re
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import urlparse

# path prefixes that are API/mock routes — never served as static files
_API_PREFIXES = ("/api", "/tos", "/emodal", "/ais", "/as400", "/admin")


class HTTPError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


# handler(params, body) -> (status, obj)   |   sse handler -> Iterable[dict]
Handler = Callable[[dict, Any], Any]


class _Route:
    __slots__ = ("method", "regex", "handler", "sse")

    def __init__(self, method: str, path: str, handler: Handler, sse: bool):
        self.method = method.upper()
        self.regex = self._compile(path)
        self.handler = handler
        self.sse = sse

    @staticmethod
    def _compile(path: str) -> re.Pattern:
        pattern = re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", path)
        return re.compile(f"^{pattern}$")


class Router:
    def __init__(self) -> None:
        self._routes: list[_Route] = []

    def add(self, method: str, path: str, handler: Handler, sse: bool = False) -> None:
        self._routes.append(_Route(method, path, handler, sse))

    def get(self, path: str, handler: Handler, sse: bool = False) -> None:
        self.add("GET", path, handler, sse)

    def post(self, path: str, handler: Handler) -> None:
        self.add("POST", path, handler)

    def match(self, method: str, path: str):
        for r in self._routes:
            if r.method != method.upper():
                continue
            m = r.regex.match(path)
            if m:
                return r, m.groupdict()
        return None, None


def _make_handler_class(router: Router, static_dir: Path | None):
    class _Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def handle(self):  # swallow benign client-side disconnects (keep-alive resets)
            try:
                super().handle()
            except (ConnectionResetError, BrokenPipeError, ConnectionAbortedError):
                pass

        # --- helpers ---------------------------------------------------------
        def _cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _send_json(self, status: int, obj: Any) -> None:
            body = json.dumps(obj).encode("utf-8") if obj is not None else b""
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self._cors_headers()
            self.end_headers()
            if body:
                self.wfile.write(body)

        def _read_body(self) -> Any:
            length = int(self.headers.get("Content-Length", 0) or 0)
            if not length:
                return None
            raw = self.rfile.read(length)
            try:
                return json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                raise HTTPError(400, "invalid JSON body")

        # --- verbs -----------------------------------------------------------
        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(204)
            self._cors_headers()
            self.end_headers()

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._dispatch("POST")

        def _serve_static(self, path: str) -> None:
            """Serve the built SPA: real files when they exist, else index.html (client routing).
            API/mock prefixes never fall through here."""
            if any(path == p or path.startswith(p + "/") for p in _API_PREFIXES):
                self._send_json(404, {"error": f"no route for GET {path}"})
                return
            index = static_dir / "index.html"
            rel = path.lstrip("/") or "index.html"
            target = (static_dir / rel).resolve()
            try:
                target.relative_to(static_dir.resolve())  # block path traversal
                serve = target if target.is_file() else index
            except ValueError:
                serve = index
            if not serve.is_file():
                self._send_json(404, {"error": "not found"})
                return
            body = serve.read_bytes()
            ctype = mimetypes.guess_type(str(serve))[0] or "application/octet-stream"
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self._cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _dispatch(self, method: str) -> None:
            path = urlparse(self.path).path
            route, params = router.match(method, path)
            if route is None:
                if method == "GET" and static_dir is not None:
                    self._serve_static(path)
                else:
                    self._send_json(404, {"error": f"no route for {method} {path}"})
                return
            try:
                body = self._read_body() if method == "POST" else None
                if route.sse:
                    self._stream_sse(route.handler(params, body))
                else:
                    status, obj = route.handler(params, body)
                    self._send_json(status, obj)
            except HTTPError as exc:
                self._send_json(exc.status, {"error": exc.message})
            except KeyError as exc:
                self._send_json(404, {"error": str(exc)})
            except PermissionError as exc:
                self._send_json(403, {"error": str(exc)})
            except Exception as exc:  # pragma: no cover - defensive
                traceback.print_exc()
                self._send_json(500, {"error": str(exc)})

        def _stream_sse(self, events: Iterable[dict]) -> None:
            self.close_connection = True  # close socket when the stream ends
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "close")
            self._cors_headers()
            self.end_headers()
            try:
                for event in events:
                    chunk = f"data: {json.dumps(event)}\n\n".encode("utf-8")
                    self.wfile.write(chunk)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, fmt: str, *args: Any) -> None:  # quieter logs
            return

    return _Handler


class _Server(ThreadingHTTPServer):
    # Fail loudly if the port is already taken instead of silently co-binding (Windows
    # SO_REUSEADDR lets multiple servers share a port, which scrambles responses).
    allow_reuse_address = False
    daemon_threads = True


def serve(router: Router, host: str, port: int, static_dir: Path | None = None) -> ThreadingHTTPServer:
    return _Server((host, port), _make_handler_class(router, static_dir))
