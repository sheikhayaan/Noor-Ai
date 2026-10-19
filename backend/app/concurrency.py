"""Per-user concurrency + daily usage limits (server-authoritative).

The frontend enforces a soft daily cap, but a client-side limit protects
nothing — the API is directly callable. These guards live on the server and key
off the *resolved* identity (see ``auth.resolve_user_id``), so a client cannot
bypass them by editing a request.

Adapted to the real stack: Noor's routes are synchronous (FastAPI runs them in a
threadpool), so the concurrency gate is a per-user ``threading`` semaphore rather
than the spec's ``asyncio.Semaphore`` — same guarantee (at most N in-flight per
user), correct primitive for threaded handlers. A request that cannot get a slot
within ``NOOR_CONCURRENCY_TIMEOUT_SECONDS`` gets a 429 instead of queueing
forever. (A hard wall-clock kill of an in-flight request is not safe on threaded
sync handlers; the outbound model call already carries its own provider timeout,
so this bounds the queue, and the provider bounds the call.)
"""
from __future__ import annotations

import threading
import time
from collections import OrderedDict
from contextlib import contextmanager

from fastapi import HTTPException

from backend.app.settings import (
    NOOR_CONCURRENCY_TIMEOUT_SECONDS,
    NOOR_DAILY_MESSAGE_LIMIT,
    NOOR_MAX_CONCURRENT_GLOBAL,
    NOOR_MAX_CONCURRENT_PER_USER,
)

# Bounded registries. Without a cap, 1000s of distinct users (or rotated guest
# ids) grow these dicts forever — a slow memory leak that only shows up under
# the exact load this product is built for.
_MAX_TRACKED_USERS = 20_000

_registry_lock = threading.Lock()
_user_semaphores: "OrderedDict[str, threading.BoundedSemaphore]" = OrderedDict()
_global_semaphore: threading.BoundedSemaphore | None = None


def _semaphore_for(user_id: str) -> threading.BoundedSemaphore:
    with _registry_lock:
        sem = _user_semaphores.get(user_id)
        if sem is None:
            sem = threading.BoundedSemaphore(max(1, NOOR_MAX_CONCURRENT_PER_USER))
            _user_semaphores[user_id] = sem
        _user_semaphores.move_to_end(user_id)
        while len(_user_semaphores) > _MAX_TRACKED_USERS:
            _user_semaphores.popitem(last=False)
        return sem


def _global_sem() -> threading.BoundedSemaphore:
    global _global_semaphore
    if _global_semaphore is None:
        with _registry_lock:
            if _global_semaphore is None:
                _global_semaphore = threading.BoundedSemaphore(
                    max(1, NOOR_MAX_CONCURRENT_GLOBAL)
                )
    return _global_semaphore


@contextmanager
def concurrency_slot(user_id: str):
    """Hold one of the user's N concurrency slots for the duration of the block.

    Raises 429 if no slot frees within the timeout. No-op when
    ``NOOR_MAX_CONCURRENT_PER_USER <= 0``.
    """
    if NOOR_MAX_CONCURRENT_PER_USER <= 0:
        yield
        return
    sem = _semaphore_for(user_id)
    if not sem.acquire(timeout=max(0.0, NOOR_CONCURRENCY_TIMEOUT_SECONDS)):
        raise HTTPException(
            status_code=429,
            detail={
                "error": "too_many_concurrent_requests",
                "message": "You have too many requests in progress. Please wait for one to finish.",
            },
        )
    try:
        yield
    finally:
        sem.release()


@contextmanager
def global_slot():
    """Server-wide capacity gate around outbound model calls.

    Per-user limits protect against one noisy client; this protects the *box*
    (sockets, threads, memory) when 1000 users arrive at once. Excess requests
    queue briefly and then fail with a clean 503 + Retry-After instead of
    collapsing the process.
    """
    if NOOR_MAX_CONCURRENT_GLOBAL <= 0:
        yield
        return
    sem = _global_sem()
    if not sem.acquire(timeout=max(0.0, NOOR_CONCURRENCY_TIMEOUT_SECONDS)):
        raise HTTPException(
            status_code=503,
            detail={
                "error": "server_at_capacity",
                "message": "Noor is at capacity right now. Please retry in a moment.",
            },
            headers={"Retry-After": "2"},
        )
    try:
        yield
    finally:
        sem.release()


# ---------------------------------------------------------------------------
# Daily usage quota (per user, per UTC day). Disabled by default (limit 0), so
# the running app is unchanged until an operator opts in.
# ---------------------------------------------------------------------------
_usage_lock = threading.Lock()
_usage: "OrderedDict[str, tuple[str, int]]" = OrderedDict()  # user_id -> (utc_date, count)
_MAX_TRACKED_USAGE = 100_000


def _utc_day() -> str:
    return time.strftime("%Y-%m-%d", time.gmtime())


def check_and_increment_daily_usage(user_id: str) -> None:
    """Count one message against the user's daily quota; 429 when exceeded.

    No-op when ``NOOR_DAILY_MESSAGE_LIMIT <= 0``.
    """
    if NOOR_DAILY_MESSAGE_LIMIT <= 0:
        return
    today = _utc_day()
    with _usage_lock:
        day, count = _usage.get(user_id, (today, 0))
        if day != today:
            count = 0
        if count >= NOOR_DAILY_MESSAGE_LIMIT:
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "daily_limit_reached",
                    "message": f"Daily message limit ({NOOR_DAILY_MESSAGE_LIMIT}) reached. Try again tomorrow.",
                    "limit": NOOR_DAILY_MESSAGE_LIMIT,
                },
            )
        _usage[user_id] = (today, count + 1)
        _usage.move_to_end(user_id)
        while len(_usage) > _MAX_TRACKED_USAGE:
            _usage.popitem(last=False)


def usage_snapshot(user_id: str) -> dict:
    today = _utc_day()
    with _usage_lock:
        day, count = _usage.get(user_id, (today, 0))
        if day != today:
            count = 0
    limited = NOOR_DAILY_MESSAGE_LIMIT > 0
    return {
        "date": today,
        "used": count,
        "limit": NOOR_DAILY_MESSAGE_LIMIT,
        "remaining": max(0, NOOR_DAILY_MESSAGE_LIMIT - count) if limited else None,
        "max_concurrent": NOOR_MAX_CONCURRENT_PER_USER,
        "server_max_concurrent": NOOR_MAX_CONCURRENT_GLOBAL,
    }
