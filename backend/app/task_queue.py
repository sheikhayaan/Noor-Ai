"""Bounded background worker pool for post-response work (memory extraction).

FastAPI's ``BackgroundTasks`` runs after the response on the same threadpool that
serves requests. Each memory extraction may make 1–2 LLM calls, so under load it
silently steals capacity from chat itself — the classic "background task" outage.

Here work goes to a fixed pool with a **bounded queue**. When the queue is full,
work is dropped and logged (memory can be rebuilt by re-processing the
conversation later) rather than growing without limit and OOM-ing the process.

Tuning: ``NOOR_BG_WORKERS`` / ``NOOR_BG_QUEUE_SIZE``.
"""
from __future__ import annotations

import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Optional

from backend.app.settings import NOOR_BG_QUEUE_SIZE, NOOR_BG_WORKERS

logger = logging.getLogger("noor.bg")

_pool: Optional["BackgroundPool"] = None
_lock = threading.Lock()


class BackgroundPool:
    def __init__(self, workers: int, queue_size: int) -> None:
        self.workers = max(1, workers)
        self.queue_size = max(1, queue_size)
        self._executor = ThreadPoolExecutor(
            max_workers=self.workers, thread_name_prefix="noor-bg"
        )
        self._pending = 0
        self._pending_lock = threading.Lock()
        self.dropped = 0

    def submit(self, fn: Callable[..., object], *args: object) -> bool:
        """Queue ``fn(*args)``; returns False when the queue is saturated."""
        with self._pending_lock:
            if self._pending >= self.queue_size:
                self.dropped += 1
                # Warn sparingly: the counters in logs are enough for operators.
                if self.dropped % 50 == 1:
                    logger.warning(
                        "Background queue full (%s pending); dropped %s tasks so far.",
                        self._pending,
                        self.dropped,
                    )
                return False
            self._pending += 1

        def _run() -> None:
            try:
                fn(*args)
            except Exception as error:  # noqa: BLE001 - never kill the worker
                logger.warning("Background task failed: %s", error)
            finally:
                with self._pending_lock:
                    self._pending -= 1

        try:
            self._executor.submit(_run)
        except RuntimeError:  # executor already shut down
            with self._pending_lock:
                self._pending -= 1
            return False
        return True

    def shutdown(self, wait: bool = False) -> None:
        self._executor.shutdown(wait=wait, cancel_futures=True)


def get_pool() -> BackgroundPool:
    global _pool
    if _pool is None:
        with _lock:
            if _pool is None:
                _pool = BackgroundPool(NOOR_BG_WORKERS, NOOR_BG_QUEUE_SIZE)
    return _pool


def submit(fn: Callable[..., object], *args: object) -> bool:
    return get_pool().submit(fn, *args)


def shutdown_pool(wait: bool = False) -> None:
    global _pool
    with _lock:
        if _pool is not None:
            _pool.shutdown(wait=wait)
            _pool = None


def stats() -> dict:
    pool = _pool
    if pool is None:
        return {"workers": NOOR_BG_WORKERS, "pending": 0, "dropped": 0}
    with pool._pending_lock:  # noqa: SLF001 - same module owns the state
        pending = pool._pending
    return {"workers": pool.workers, "pending": pending, "dropped": pool.dropped}
