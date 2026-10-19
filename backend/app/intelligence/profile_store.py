"""SQLite persistence for the intelligence layer's relational state.

The tables are created in ``backend.app.database.initialize_database`` (SQLite
equivalents of the spec's Postgres schema). This module is the only place that
reads/writes them, mirroring the ``conversation_store`` pattern. Each function
opens its own short-lived connection (safe to call from worker threads, since
SQLite connections must not cross threads).

Covers: user_style_profiles, user_topic_affinity, request_savings,
user_savings_summary, processed_conversations.
"""
from __future__ import annotations

from typing import Any, Optional

from backend.app.database import get_connection

# ---------------------------------------------------------------------------
# Style profile — weighted-average merge (new 30% / existing 70%)
# ---------------------------------------------------------------------------
_TECH_LEVELS = {"beginner": 0, "intermediate": 1, "advanced": 2}
_TECH_LEVELS_INV = {0: "beginner", 1: "intermediate", 2: "advanced"}
_LENGTHS = {"short": 0, "medium": 1, "long": 2}
_LENGTHS_INV = {0: "short", 1: "medium", 2: "long"}

_STYLE_DEFAULTS = {
    "prefers_concise": False,
    "prefers_examples": True,
    "technical_level": "intermediate",
    "preferred_language": "english",
    "response_length_preference": "medium",
}

_NEW_WEIGHT = 0.30
_EXISTING_WEIGHT = 0.70


def get_style_profile(user_id: str) -> Optional[dict[str, Any]]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT prefers_concise, prefers_examples, technical_level,
                   preferred_language, response_length_preference, updated_at
            FROM user_style_profiles WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    return {
        "prefers_concise": bool(row[0]),
        "prefers_examples": bool(row[1]),
        "technical_level": row[2],
        "preferred_language": row[3],
        "response_length_preference": row[4],
        "updated_at": row[5],
    }


def _blend_bool(existing: bool, observed: bool) -> bool:
    """0.7*old + 0.3*new, thresholded at 0.5.

    A single unusual observation (30%) can never flip an established value —
    exactly the anti-override intent in the spec. NOTE: because only the
    thresholded boolean is persisted (not the underlying score), repeated
    identical new observations won't gradually shift a strong prior. True
    gradual drift would need persisted confidence columns (a small future
    migration); this is a documented, honest limitation.
    """
    return (_EXISTING_WEIGHT * float(existing) + _NEW_WEIGHT * float(observed)) >= 0.5


def _blend_ordinal(existing: str, observed: str, mapping: dict, inverse: dict, default_key: str) -> str:
    e = mapping.get(existing, mapping[default_key])
    o = mapping.get(observed, e)
    blended = round(_EXISTING_WEIGHT * e + _NEW_WEIGHT * o)
    return inverse[max(0, min(max(inverse), blended))]


def merge_style(existing: Optional[dict], observed: dict) -> dict:
    """Pure 70/30 merge. ``existing=None`` seeds from the first observation."""
    base = {**_STYLE_DEFAULTS, **(existing or {})}
    obs = {**base, **{k: v for k, v in observed.items() if v is not None}}

    if existing is None:
        # First ever observation: adopt it directly (nothing to average against).
        return {k: obs.get(k, base[k]) for k in _STYLE_DEFAULTS}

    return {
        "prefers_concise": _blend_bool(bool(base["prefers_concise"]), bool(obs["prefers_concise"])),
        "prefers_examples": _blend_bool(bool(base["prefers_examples"]), bool(obs["prefers_examples"])),
        "technical_level": _blend_ordinal(
            base["technical_level"], obs["technical_level"], _TECH_LEVELS, _TECH_LEVELS_INV, "intermediate"
        ),
        "response_length_preference": _blend_ordinal(
            base["response_length_preference"], obs["response_length_preference"], _LENGTHS, _LENGTHS_INV, "medium"
        ),
        # Language is categorical, not orderable — take the latest observation.
        "preferred_language": obs["preferred_language"],
    }


def save_style_profile(user_id: str, style: dict) -> dict:
    """Merge ``style`` (a raw observation) into the stored profile and persist."""
    merged = merge_style(get_style_profile(user_id), style)
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO user_style_profiles
                (user_id, prefers_concise, prefers_examples, technical_level,
                 preferred_language, response_length_preference, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                prefers_concise = excluded.prefers_concise,
                prefers_examples = excluded.prefers_examples,
                technical_level = excluded.technical_level,
                preferred_language = excluded.preferred_language,
                response_length_preference = excluded.response_length_preference,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                user_id,
                int(merged["prefers_concise"]),
                int(merged["prefers_examples"]),
                merged["technical_level"],
                merged["preferred_language"],
                merged["response_length_preference"],
            ),
        )
    return merged


# ---------------------------------------------------------------------------
# Topic affinity
# ---------------------------------------------------------------------------
def increment_topics(user_id: str, topics: list[str]) -> None:
    if not topics:
        return
    with get_connection() as conn:
        for topic in topics:
            t = (topic or "").strip().lower()[:100]
            if not t:
                continue
            conn.execute(
                """
                INSERT INTO user_topic_affinity (user_id, topic, count, last_seen)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, topic) DO UPDATE SET
                    count = count + 1,
                    last_seen = CURRENT_TIMESTAMP
                """,
                (user_id, t),
            )


def get_top_topics(user_id: str, limit: int = 10) -> list[dict[str, Any]]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT topic, count FROM user_topic_affinity
            WHERE user_id = ? ORDER BY count DESC, last_seen DESC LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    return [{"topic": r[0], "count": r[1]} for r in rows]


# ---------------------------------------------------------------------------
# Savings ledger + rolling summary
# ---------------------------------------------------------------------------
def record_request_savings(
    *,
    savings_id: str,
    user_id: str,
    conversation_id: str,
    tokens_saved: int,
    cost_saved_usd: float,
    cache_hit: bool,
    memories_used: int,
) -> None:
    """Append one request's savings and fold it into the user's rolling totals."""
    tokens_saved = max(0, int(tokens_saved))
    cost_saved_usd = max(0.0, float(cost_saved_usd))
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO request_savings
                (id, user_id, conversation_id, tokens_saved, cost_saved_usd,
                 cache_hit, memories_used, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """,
            (savings_id, user_id, conversation_id, tokens_saved, cost_saved_usd,
             int(cache_hit), int(memories_used)),
        )
        conn.execute(
            """
            INSERT INTO user_savings_summary
                (user_id, total_tokens_saved, total_cost_saved_usd,
                 total_cache_hits, total_requests, updated_at)
            VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id) DO UPDATE SET
                total_tokens_saved = total_tokens_saved + excluded.total_tokens_saved,
                total_cost_saved_usd = total_cost_saved_usd + excluded.total_cost_saved_usd,
                total_cache_hits = total_cache_hits + excluded.total_cache_hits,
                total_requests = total_requests + 1,
                updated_at = CURRENT_TIMESTAMP
            """,
            (user_id, tokens_saved, cost_saved_usd, int(cache_hit)),
        )


def get_savings_summary(user_id: str) -> dict[str, Any]:
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT total_tokens_saved, total_cost_saved_usd,
                   total_cache_hits, total_requests
            FROM user_savings_summary WHERE user_id = ?
            """,
            (user_id,),
        ).fetchone()
    if row is None:
        return {"total_tokens_saved": 0, "total_cost_saved_usd": 0.0,
                "total_cache_hits": 0, "total_requests": 0, "cache_hit_rate": 0.0}
    total_requests = int(row[3])
    return {
        "total_tokens_saved": int(row[0]),
        "total_cost_saved_usd": float(row[1]),
        "total_cache_hits": int(row[2]),
        "total_requests": total_requests,
        "cache_hit_rate": (int(row[2]) / total_requests) if total_requests else 0.0,
    }


def get_daily_savings(user_id: str, days: int = 30) -> list[dict[str, Any]]:
    """Tokens saved per day over the last ``days`` days (for the area chart)."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT date(created_at) AS day, SUM(tokens_saved)
            FROM request_savings
            WHERE user_id = ? AND created_at >= date('now', ?)
            GROUP BY day ORDER BY day ASC
            """,
            (user_id, f"-{int(days)} days"),
        ).fetchall()
    return [{"date": r[0], "tokens_saved": int(r[1] or 0)} for r in rows]


# ---------------------------------------------------------------------------
# Idempotency ledger — how far a conversation has been processed into memory
# ---------------------------------------------------------------------------
def get_processed_count(conversation_id: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT processed_message_count FROM processed_conversations WHERE conversation_id = ?",
            (conversation_id,),
        ).fetchone()
    return int(row[0]) if row else 0


def mark_processed(
    *, conversation_id: str, user_id: str, message_count: int, facts_extracted: int, topics: list[str]
) -> None:
    import json

    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO processed_conversations
                (conversation_id, user_id, processed_message_count,
                 facts_extracted, topics, processed_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(conversation_id) DO UPDATE SET
                processed_message_count = excluded.processed_message_count,
                facts_extracted = excluded.facts_extracted,
                topics = excluded.topics,
                processed_at = CURRENT_TIMESTAMP
            """,
            (conversation_id, user_id, int(message_count), int(facts_extracted), json.dumps(topics)),
        )


def count_processed_conversations(user_id: str) -> int:
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM processed_conversations WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    return int(row[0]) if row else 0


def reset_user(user_id: str) -> None:
    """Delete all SQLite intelligence state for a user (used by DELETE /api/memory)."""
    with get_connection() as conn:
        for table in (
            "user_style_profiles",
            "user_topic_affinity",
            "request_savings",
            "user_savings_summary",
            "processed_conversations",
        ):
            conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
