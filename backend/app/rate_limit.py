"""In-process rate limiting (token bucket, bounded memory).

Why in-process: the app ships as a single Node/Python deployment for most users,
and a Redis dependency would make "clone and run" impossible. With multiple
workers each process enforces its own budget (N × limit) — documented in
``docs/SCALING.md``; swap this module for Redis when you scale horizontally.

Design
------
* Per-identity bucket, keyed by resolved user id (falling back to client IP for
  anonymous/auth flows so login brute-force is still capped).
* **Bounded** registry (LRU eviction) — an attacker rotating ids cannot grow
  server memory without bound. This is the classic bug in naive limiters.
* Continuous-refill token bucket: steady ``per_minute`` rate with a ``burst``
  allowance, which behaves well for chat (bursty typing, then idle).
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import Depends, HTTPException, Request

from backend.app.auth import SessionIdentity, get_current_user
from backend.app.settings import (
    NOOR_RATE_LIMIT_AUTH_BURST,
    NOOR_RATE_LIMIT_AUTH_PER_MIN,
    NOOR_RATE_LIMIT_BYOK_BURST,
    NOOR_RATE_LIMIT_BYOK_PER_MIN,
    NOOR_RATE_LIMIT_CHAT_BURST,
    NOOR_RATE_LIMIT_CHAT_PER_MIN,
)

_MAX_KEYS = 50_000

_SCOPES: dict[str, tuple[int, int]] = {
    "chat": (NOOR_RATE_LIMIT_CHAT_PER_MIN, NOOR_RATE_LIMIT_CHAT_BURST),
    "auth": (NOOR_RATE_LIMIT_AUTH_PER_MIN, NOOR_RATE_LIMIT_AUTH_BURST),
    "byok": (NOOR_RATE_LIMIT_BYOK_PER_MIN, NOOR_RATE_LIMIT_BYOK_BURST),
}


@dataclass
class _Bucket:
    tokens: float
    updated: float


_lock = threading.Lock()
_buckets: "OrderedDict[str, _Bucket]" = OrderedDict()


def _client_ip(request: Request) -> str:
    # request.client is the TCP peer. X-Forwarded-For is only trusted when a
    # reverse proxy is configured; without that it is trivially spoofable, so we
    # ignore it deliberately (a spoofed key just evicts buckets).
    client = getattr(request, "client", None)
    return getattr(client, "host", None) or "unknown"


def _consume(key: str, per_minute: int, burst: int) -> tuple[bool, float]:
    """Return (allowed, retry_after_seconds). Refills continuously."""
    if per_minute <= 0:
        return True, 0.0
    rate_per_second = per_minute / 60.0
    capacity = max(1, burst or per_minute)
    now = time.monotonic()

    with _lock:
        bucket = _buckets.get(key)
        if bucket is None:
            bucket = _Bucket(tokens=float(capacity), updated=now)
            _buckets[key] = bucket
        else:
            elapsed = max(0.0, now - bucket.updated)
            bucket.tokens = min(float(capacity), bucket.tokens + elapsed * rate_per_second)
            bucket.updated = now
        _buckets.move_to_end(key)
        while len(_buckets) > _MAX_KEYS:
            _buckets.popitem(last=False)

        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return True, 0.0
        deficit = 1.0 - bucket.tokens
        return False, max(0.0, deficit / rate_per_second)


def limiter(scope: str, *, keyed_by_ip: bool = False) -> Callable[..., None]:
    """Build a FastAPI dependency enforcing ``scope``'s budget.

    ``keyed_by_ip=True`` is used for auth routes (no identity yet) and for any
    route where per-user keying could be bypassed.
    """
    per_minute, burst = _SCOPES.get(scope, (0, 0))

    def dependency(
        request: Request,
        session: Optional[SessionIdentity] = Depends(get_current_user),
    ) -> None:
        if per_minute <= 0:
            return
        if keyed_by_ip or session is None:
            identity = f"ip:{_client_ip(request)}"
        else:
            identity = f"user:{session.user_id}"
        allowed, retry_after = _consume(f"{scope}|{identity}", per_minute, burst)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "rate_limited",
                    "message": "Too many requests. Please slow down.",
                    "retry_after": round(retry_after, 1),
                },
                headers={"Retry-After": str(max(1, int(retry_after + 0.999)))},
            )

    return dependency


def chat_limiter() -> Callable[..., None]:
    """Chat budget keyed by the verified user (falls back to IP)."""
    return limiter("chat")


def auth_limiter() -> Callable[..., None]:
    """Strict IP budget for login endpoints (credential stuffing defence)."""
    return limiter("auth", keyed_by_ip=True)


def byok_limiter() -> Callable[..., None]:
    """Key-management budget (each save may call the provider's API)."""
    return limiter("byok")


def reset_for_tests() -> None:
    with _lock:
        _buckets.clear()
