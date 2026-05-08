from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import json
import urllib.request
import urllib.error
import urllib.parse
import base64
import http.client

ROOT = Path(__file__).parent
HOST = "127.0.0.1"
PORT = 8888


def build_auth_header(password: str) -> str:
    token = base64.b64encode(f"opencode:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/proxy-sse":
            self.handle_proxy_sse(parsed)
            return
        super().do_GET()

    def do_POST(self):
        if self.path == "/api/send-prompt":
            self.handle_send_prompt()
            return
        if self.path == "/api/create-session":
            self.handle_create_session()
            return
        self.send_error(404, "Not Found")

    def handle_proxy_sse(self, parsed):
        upstream = None
        try:
            query = urllib.parse.parse_qs(parsed.query)
            target_url = str(query.get("url", [""])[0]).strip()
            if not target_url:
                self._json(400, {"ok": False, "error": "url is required"})
                return

            req = urllib.request.Request(
                target_url,
                headers={
                    "Accept": "text/event-stream",
                    "Cache-Control": "no-cache",
                },
                method="GET",
            )
            upstream = urllib.request.urlopen(req, timeout=60)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            while True:
                try:
                    chunk = upstream.read(1024)
                except http.client.IncompleteRead as exc:
                    chunk = exc.partial
                    if not chunk:
                        break
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                    self.wfile.flush()
                except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                    break
        except urllib.error.HTTPError as exc:
            self.handle_http_error(exc)
        except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
            return
        except Exception as exc:
            try:
                self._json(500, {"ok": False, "error": str(exc), "reason": repr(exc)})
            except (BrokenPipeError, ConnectionAbortedError, ConnectionResetError):
                return
        finally:
            if upstream is not None:
                try:
                    upstream.close()
                except Exception:
                    pass

    def handle_send_prompt(self):
        try:
            body = self.read_json_body()
            prompt = str(body.get("prompt", "")).strip()
            target_url = str(body.get("url", "")).strip()
            session_id = str(body.get("sessionId", "")).strip()
            password = str(body.get("password", "")).strip()

            if not prompt:
                self._json(400, {"ok": False, "error": "prompt is required"})
                return
            if not target_url:
                self._json(400, {"ok": False, "error": "url is required"})
                return
            if not session_id:
                self._json(400, {"ok": False, "error": "sessionId is required"})
                return

            headers = {"Content-Type": "application/json"}
            if password:
                headers["Authorization"] = build_auth_header(password)

            req = urllib.request.Request(
                target_url,
                data=json.dumps(
                    {
                        "parts": [
                            {
                                "type": "text",
                                "text": prompt,
                            }
                        ]
                    }
                ).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            payload = self.forward(req)
            self._json(200, {"ok": True, "sessionId": session_id, "forwarded_to": target_url, "response": payload})
        except urllib.error.HTTPError as exc:
            self.handle_http_error(exc)
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc), "reason": repr(exc)})

    def handle_create_session(self):
        try:
            body = self.read_json_body()
            target_url = str(body.get("url", "")).strip()
            title = str(body.get("title", "")).strip()
            password = str(body.get("password", "")).strip()

            if not target_url:
                self._json(400, {"ok": False, "error": "url is required"})
                return

            headers = {"Content-Type": "application/json"}
            if password:
                headers["Authorization"] = build_auth_header(password)

            payload_body = {"title": title} if title else {}
            req = urllib.request.Request(
                target_url,
                data=json.dumps(payload_body).encode("utf-8"),
                headers=headers,
                method="POST",
            )
            payload = self.forward(req)
            self._json(200, {"ok": True, "session": payload, "forwarded_to": target_url})
        except urllib.error.HTTPError as exc:
            self.handle_http_error(exc)
        except Exception as exc:
            self._json(500, {"ok": False, "error": str(exc), "reason": repr(exc)})

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8") or "{}")

    def forward(self, req):
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
            try:
                return json.loads(text) if text else {"status": resp.status}
            except json.JSONDecodeError:
                return {"raw": text, "status": resp.status}

    def handle_http_error(self, exc):
        text = exc.read().decode("utf-8", errors="replace")
        self._json(
            exc.code,
            {
                "ok": False,
                "error": text or str(exc),
                "status": exc.code,
                "reason": str(exc),
            },
        )

    def _json(self, status, payload):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Serving on http://{HOST}:{PORT}")
    server.serve_forever()
