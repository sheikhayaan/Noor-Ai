"""Shared, pooled HTTP clients for every outbound model call.

Why this exists: ``requests.post(...)`` (what the app did before) opens a fresh
TCP+TLS connection per request. At a few hundred concurrent users that burns
ephemeral ports and adds a full handshake to every chat turn. A single
``Session`` with a sized connection pool keeps sockets warm and reuses them.

Tuning knobs (see ``settings``):

* ``NOOR_HTTP_POOL_SIZE``       — connections kept per host (default 64)
* ``NOOR_HTTP_MAX_RETRIES``     — connect retries only (never replays a POST
  that may already have been billed upstream)
* ``NOOR_HTTP_KEEPALIVE_SECONDS`` — socket keep-alive

``requests.Session`` is thread-safe for concurrent ``request()`` calls (the
underlying urllib3 pool guards connection checkout), which matches FastAPI's
threaded sync handlers.
"""
from __future__ import annotations

import threading
from typing import Optional

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from backend.app.settings import (
    NOOR_HTTP_KEEPALIVE_SECONDS,
    NOOR_HTTP_MAX_RETRIES,
    NOOR_HTTP_POOL_SIZE,
)

_session: Optional[requests.Session] = None
_lock = threading.Lock()


def _build_session() -> requests.Session:
    session = requests.Session()
    # Retry connection failures only: replaying a chat POST after a read timeout
    # could double-bill the user's own provider key.
    retry = Retry(
        total=0,
        connect=max(0, NOOR_HTTP_MAX_RETRIES),
        read=0,
        status=0,
        backoff_factor=0.2,
        allowed_methods=None,
    )
    adapter = HTTPAdapter(
        pool_connections=max(4, NOOR_HTTP_POOL_SIZE),
        pool_maxsize=max(4, NOOR_HTTP_POOL_SIZE),
        max_retries=retry,
        pool_block=True,
    )
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    session.headers.update(
        {
            "User-Agent": "NoorAI/1.0 (+https://github.com/sheikhayaan/Noor-Ai)",
            "Accept-Encoding": "gzip, deflate",
        }
    )
    return session


def shared_session() -> requests.Session:
    """Process-wide pooled session (lazily built, thread-safe)."""
    global _session
    if _session is None:
        with _lock:
            if _session is None:
                _session = _build_session()
    return _session


def close_shared_session() -> None:
    """Release pooled sockets on shutdown (called from the app lifespan)."""
    global _session
    with _lock:
        if _session is not None:
            try:
                _session.close()
            finally:
                _session = None


__all__ = ["shared_session", "close_shared_session", "NOOR_HTTP_KEEPALIVE_SECONDS"]
