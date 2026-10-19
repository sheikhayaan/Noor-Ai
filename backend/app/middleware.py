"""HTTP hardening middleware: security headers, body-size cap, request ids.

Pure-ASGI (no ``BaseHTTPMiddleware``) so it adds a single layer to the stack and
never interferes with streaming responses or background tasks.

* **Security headers** — clickjacking, MIME sniffing, referrer leakage, and
  (in production) HSTS. API responses are marked ``no-store`` so a shared cache
  can never serve one user's chat history to another.
* **Body-size cap** — a 50 MB JSON body is a cheap denial-of-service. Reject it
  at the edge (``Content-Length`` and, defensively, a streaming counter).
* **Request id** — one correlation id per request, echoed as ``x-request-id``,
  so a user-reported error can be found in server logs.
"""
from __future__ import annotations

import uuid
from typing import Any, Awaitable, Callable

from backend.app.settings import IS_PRODUCTION, NOOR_MAX_BODY_BYTES

Scope = dict[str, Any]
Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]
ASGIApp = Callable[[Scope, Receive, Send], Awaitable[None]]

_BASE_HEADERS: tuple[tuple[bytes, bytes], ...] = (
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"camera=(), microphone=(), geolocation=()"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"cross-origin-resource-policy", b"same-site"),
)

# Endpoints that must never be cached by a proxy or the browser.
_NO_STORE_PREFIXES = ("/api/", "/auth/", "/conversations", "/chat", "/memory", "/savings")


class _BodyTooLarge(Exception):
    pass


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app
        self._hsts = IS_PRODUCTION

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        extra = list(_BASE_HEADERS)
        if self._hsts:
            extra.append(
                (b"strict-transport-security", b"max-age=31536000; includeSubDomains")
            )
        if path.startswith(_NO_STORE_PREFIXES):
            extra.append((b"cache-control", b"no-store, max-age=0"))

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                present = {key.lower() for key, _ in headers}
                for key, value in extra:
                    if key not in present:
                        headers.append((key, value))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_headers)


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int = NOOR_MAX_BODY_BYTES) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.max_bytes <= 0:
            await self.app(scope, receive, send)
            return

        for key, value in scope.get("headers") or []:
            if key == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    await _send_413(send, self.max_bytes)
                    return
                break

        total = 0
        started = False

        async def limited_receive() -> Message:
            nonlocal total
            message = await receive()
            if message["type"] == "http.request":
                total += len(message.get("body") or b"")
                if total > self.max_bytes:
                    raise _BodyTooLarge
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not started:
                await _send_413(send, self.max_bytes)


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = ""
        for key, value in scope.get("headers") or []:
            if key == b"x-request-id":
                incoming = value.decode("latin-1")[:64]
                break
        request_id = incoming or uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                headers.append((b"x-request-id", request_id.encode("latin-1")))
                message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, send_with_id)


async def _send_413(send: Send, limit: int) -> None:
    body = (
        b'{"detail":{"error":"payload_too_large","message":"Request body exceeds '
        + str(limit).encode()
        + b' bytes."}}'
    )
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"connection", b"close"),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})
