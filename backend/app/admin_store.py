"""SQLite persistence + aggregation for the Admin Intelligence Dashboard.

This module owns the three admin tables created in
``backend.app.database.initialize_database`` — ``admin_request_log``,
``message_ratings`` and ``admin_events`` — mirroring the ``profile_store``
pattern: every function opens its own short-lived connection (SQLite
connections must not cross threads, and FastAPI may run sync routes in a
threadpool).

Two contracts live here:

* **Capture writes** (``log_request`` / ``log_event``) are *best-effort*: they
  swallow their own exceptions and return a bool, because analytics must never
  break a chat response. Call them at the tail of a request with no try/except
  of your own.
* **Reads** (the ``get_*`` / ``list_*`` aggregations that feed the dashboard)
  raise normally — the admin router is the right place to turn a failure into a
  500. ``record_rating`` also raises, since a silently-dropped rating would be a
  UX lie (it is an explicit user action, not hot-path capture).
"""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Optional

from backend.app.database import get_connection

logger = logging.getLogger("noor.admin_store")


def _truncate(value: Optional[str], limit: int) -> Optional[str]:
    if value is None:
        return None
    text = str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


# ---------------------------------------------------------------------------
# Capture writes — best-effort, never raise on the request path
# ---------------------------------------------------------------------------
def log_request(
    *,
    user_id: str,
    conversation_id: str,
    gem_id: Optional[str],
    source: str,
    question: str,
    response: str,
    provider: Optional[str] = None,
    model: Optional[str] = None,
    task_type: Optional[str] = None,
    cache_result: Optional[str] = None,
    memories_used: int = 0,
    tokens_saved: int = 0,
    cost_saved_usd: float = 0.0,
    latency_ms: Optional[int] = None,
    connection: Any = None,
) -> bool:
    """Append one chat request to the unified admin log. Best-effort.

    Returns True on success, False if anything went wrong (already logged). Both
    chat paths call this at the tail of a successful turn, so the analytics log
    is the single source of truth for per-request activity across ``/chat`` and
    ``/api/chat``.
    """
    def _apply(conn) -> None:
        conn.execute(
                """
                INSERT INTO admin_request_log
                    (id, user_id, conversation_id, gem_id, source, question,
                     response, provider, model, task_type, cache_result,
                     memories_used, tokens_saved, cost_saved_usd, latency_ms,
                     created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                        CURRENT_TIMESTAMP)
                """,
                (
                    str(uuid.uuid4()),
                    user_id,
                    conversation_id,
                    gem_id,
                    source,
                    question,
                    response,
                    provider,
                    model,
                    task_type,
                    cache_result,
                    max(0, int(memories_used or 0)),
                    max(0, int(tokens_saved or 0)),
                    max(0.0, float(cost_saved_usd or 0.0)),
                    None if latency_ms is None else max(0, int(latency_ms)),
                ),
            )

    try:
        # ``connection`` folds this row into the caller's write transaction so a
        # chat turn commits once instead of twice (SQLite has one writer).
        if connection is not None:
            _apply(connection)
        else:
            with get_connection() as conn:
                _apply(conn)
        return True
    except Exception as error:  # noqa: BLE001
        logger.warning("admin log_request failed (best-effort): %s", error)
        return False


def log_event(
    event_type: str,
    *,
    user_id: Optional[str] = None,
    severity: str = "info",
    detail: Optional[dict[str, Any]] = None,
) -> bool:
    """Append a generic admin/security event. Best-effort (never raises)."""
    try:
        payload = json.dumps(detail or {}, separators=(",", ":"), default=str)
        with get_connection() as conn:
            conn.execute(
                """
                INSERT INTO admin_events
                    (id, event_type, severity, user_id, detail, created_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                """,
                (str(uuid.uuid4()), event_type, severity, user_id, payload),
            )
        return True
    except Exception as error:  # noqa: BLE001
        logger.warning("admin log_event failed (best-effort): %s", error)
        return False


# ---------------------------------------------------------------------------
# Ratings — explicit user action, so this one raises on failure
# ---------------------------------------------------------------------------
def record_rating(
    *,
    user_id: str,
    conversation_id: str,
    rating: int,
    message_id: Optional[int] = None,
    comment: Optional[str] = None,
) -> dict[str, Any]:
    """Record (or replace) a thumbs rating for a message. Latest wins.

    ``rating`` is normalized to its sign: +1 (up) or -1 (down); 0 is rejected by
    the caller. Uniqueness is on ``(user_id, conversation_id, message_id)`` so a
    user re-rating the same turn updates in place rather than piling up rows.
    """
    normalized = 1 if int(rating) > 0 else -1
    mid = -1 if message_id is None else int(message_id)
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO message_ratings
                (id, user_id, conversation_id, message_id, rating, comment,
                 created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, conversation_id, message_id) DO UPDATE SET
                rating = excluded.rating,
                comment = excluded.comment,
                updated_at = CURRENT_TIMESTAMP
            """,
            (str(uuid.uuid4()), user_id, conversation_id, mid, normalized, comment),
        )
    return {
        "conversation_id": conversation_id,
        "message_id": None if mid == -1 else mid,
        "rating": normalized,
    }


# ---------------------------------------------------------------------------
# Reads / aggregations — feed the dashboard (raise on failure)
# ---------------------------------------------------------------------------
def get_overview() -> dict[str, Any]:
    """Top-line totals across the whole platform."""
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*),
                   COALESCE(SUM(tokens_saved), 0),
                   COALESCE(SUM(cost_saved_usd), 0.0),
                   COALESCE(SUM(CASE WHEN cache_result = 'HIT' THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN cache_result IS NOT NULL THEN 1 ELSE 0 END), 0),
                   AVG(latency_ms),
                   COUNT(DISTINCT user_id)
            FROM admin_request_log
            """
        ).fetchone()
        users = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        conversations = conn.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
        messages = conn.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
        ratings = conn.execute(
            """
            SELECT COALESCE(SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN rating < 0 THEN 1 ELSE 0 END), 0)
            FROM message_ratings
            """
        ).fetchone()

    total_requests = int(row[0] or 0)
    cache_hits = int(row[3] or 0)
    cacheable = int(row[4] or 0)
    return {
        "total_requests": total_requests,
        "active_users": int(row[6] or 0),
        "registered_users": int(users or 0),
        "total_conversations": int(conversations or 0),
        "total_messages": int(messages or 0),
        "total_tokens_saved": int(row[1] or 0),
        "total_cost_saved_usd": float(row[2] or 0.0),
        "cache_hits": cache_hits,
        "cache_lookups": cacheable,
        "cache_hit_rate": (cache_hits / cacheable) if cacheable else 0.0,
        "avg_latency_ms": round(float(row[5]), 1) if row[5] is not None else None,
        "ratings_up": int(ratings[0] or 0),
        "ratings_down": int(ratings[1] or 0),
    }


def list_recent_requests(
    *, limit: int = 50, offset: int = 0, user_id: Optional[str] = None
) -> list[dict[str, Any]]:
    """Most-recent requests first, with previews (full text is not shipped)."""
    limit = max(1, min(500, int(limit)))
    offset = max(0, int(offset))
    where = ""
    params: list[Any] = []
    if user_id:
        where = "WHERE user_id = ?"
        params.append(user_id)
    params.extend([limit, offset])
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, user_id, conversation_id, gem_id, source, question,
                   response, provider, model, task_type, cache_result,
                   memories_used, tokens_saved, cost_saved_usd, latency_ms,
                   created_at
            FROM admin_request_log
            {where}
            ORDER BY created_at DESC, rowid DESC
            LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()
    return [
        {
            "id": r[0],
            "user_id": r[1],
            "conversation_id": r[2],
            "gem_id": r[3],
            "source": r[4],
            "question": _truncate(r[5], 500),
            "response": _truncate(r[6], 500),
            "provider": r[7],
            "model": r[8],
            "task_type": r[9],
            "cache_result": r[10],
            "memories_used": int(r[11] or 0),
            "tokens_saved": int(r[12] or 0),
            "cost_saved_usd": float(r[13] or 0.0),
            "latency_ms": None if r[14] is None else int(r[14]),
            "created_at": r[15],
        }
        for r in rows
    ]


def list_users_overview(*, limit: int = 100) -> list[dict[str, Any]]:
    """Per-user activity rollup, busiest first."""
    limit = max(1, min(1000, int(limit)))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT l.user_id,
                   COUNT(*) AS requests,
                   MAX(l.created_at) AS last_active,
                   COALESCE(SUM(l.tokens_saved), 0),
                   COALESCE(SUM(l.cost_saved_usd), 0.0),
                   COALESCE(SUM(CASE WHEN l.cache_result = 'HIT' THEN 1 ELSE 0 END), 0),
                   u.email, u.name, u.provider
            FROM admin_request_log l
            LEFT JOIN users u ON u.user_id = l.user_id
            GROUP BY l.user_id
            ORDER BY requests DESC, last_active DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return [
        {
            "user_id": r[0],
            "requests": int(r[1] or 0),
            "last_active": r[2],
            "tokens_saved": int(r[3] or 0),
            "cost_saved_usd": float(r[4] or 0.0),
            "cache_hits": int(r[5] or 0),
            "email": r[6],
            "name": r[7],
            "provider": r[8],
        }
        for r in rows
    ]


def get_requests_timeseries(*, days: int = 30) -> list[dict[str, Any]]:
    """Daily activity series for the dashboard's area charts."""
    days = max(1, min(365, int(days)))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT date(created_at) AS day,
                   COUNT(*),
                   COALESCE(SUM(tokens_saved), 0),
                   COALESCE(SUM(cost_saved_usd), 0.0),
                   COALESCE(SUM(CASE WHEN cache_result = 'HIT' THEN 1 ELSE 0 END), 0)
            FROM admin_request_log
            WHERE created_at >= date('now', ?)
            GROUP BY day ORDER BY day ASC
            """,
            (f"-{days} days",),
        ).fetchall()
    return [
        {
            "date": r[0],
            "requests": int(r[1] or 0),
            "tokens_saved": int(r[2] or 0),
            "cost_saved_usd": float(r[3] or 0.0),
            "cache_hits": int(r[4] or 0),
        }
        for r in rows
    ]


def list_events(*, limit: int = 100, event_type: Optional[str] = None) -> list[dict[str, Any]]:
    """Most-recent admin/security events first."""
    limit = max(1, min(500, int(limit)))
    where = ""
    params: list[Any] = []
    if event_type:
        where = "WHERE event_type = ?"
        params.append(event_type)
    params.append(limit)
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, event_type, severity, user_id, detail, created_at
            FROM admin_events
            {where}
            ORDER BY created_at DESC, rowid DESC
            LIMIT ?
            """,
            params,
        ).fetchall()
    events = []
    for r in rows:
        try:
            detail = json.loads(r[4]) if r[4] else {}
        except (ValueError, TypeError):
            detail = {"raw": r[4]}
        events.append(
            {
                "id": r[0],
                "event_type": r[1],
                "severity": r[2],
                "user_id": r[3],
                "detail": detail,
                "created_at": r[5],
            }
        )
    return events


def get_rating_summary(*, limit: int = 20) -> dict[str, Any]:
    """Up/down totals plus the most recent individual ratings."""
    limit = max(1, min(200, int(limit)))
    with get_connection() as conn:
        totals = conn.execute(
            """
            SELECT COALESCE(SUM(CASE WHEN rating > 0 THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN rating < 0 THEN 1 ELSE 0 END), 0),
                   COUNT(*)
            FROM message_ratings
            """
        ).fetchone()
        recent = conn.execute(
            """
            SELECT user_id, conversation_id, message_id, rating, comment, updated_at
            FROM message_ratings
            ORDER BY updated_at DESC, rowid DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return {
        "up": int(totals[0] or 0),
        "down": int(totals[1] or 0),
        "total": int(totals[2] or 0),
        "recent": [
            {
                "user_id": r[0],
                "conversation_id": r[1],
                "message_id": None if r[2] == -1 else int(r[2]),
                "rating": int(r[3]),
                "comment": r[4],
                "updated_at": r[5],
            }
            for r in recent
        ],
    }
