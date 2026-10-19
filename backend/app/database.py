import sqlite3
from contextlib import contextmanager
from pathlib import Path


# Anchor the DB to the project root (…/noor ai/noor_ai.db) regardless of the
# process working directory. database.py lives at backend/app/, so parents[2]
# is the project root. This keeps every entry point (uvicorn, pytest, scripts)
# pointed at the same database file.
DATABASE_PATH = Path(__file__).resolve().parents[2] / "noor_ai.db"


def get_connection():
    # timeout + WAL + busy_timeout let many FastAPI worker threads read while a
    # write is in flight instead of raising "database is locked" under load.
    # (SQLite is still a single-writer store: see docs/SCALING.md for when to
    # move to Postgres.)
    #
    # ``journal_mode`` is deliberately NOT set here. Switching the journal mode
    # needs a brief exclusive lock, so doing it on every connection acquisition
    # serialised the entire process under load (measured: 63 req/s at 50-way
    # concurrency, collapsing to 32 req/s at 200). It is a persistent database
    # property, so it is applied once in ``initialize_database()``.
    connection = sqlite3.connect(DATABASE_PATH, timeout=5.0)
    connection.execute("PRAGMA busy_timeout = 5000")
    connection.execute("PRAGMA synchronous = NORMAL")
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA cache_size = -16000")  # ~16 MB page cache
    return connection


@contextmanager
def transaction():
    """One connection, one commit — reuse it across a request's related writes.

    Every ``get_connection()`` call is a new connection, three PRAGMAs, a commit
    and a close; a chat used to do that four to six times, and under concurrency
    it serialised hard on the single SQLite writer. ``transaction()`` lets a
    handler batch its writes so the lock is taken once and released once.
    """
    connection = get_connection()
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _ensure_wal() -> None:
    """Persist WAL mode (and a sane checkpoint threshold) exactly once."""
    with sqlite3.connect(DATABASE_PATH, timeout=5.0) as connection:
        if connection.execute("PRAGMA journal_mode").fetchone()[0].lower() != "wal":
            connection.execute("PRAGMA journal_mode = WAL")
        # Default is 1000 pages (~4 MB): on a busy instance that means a
        # checkpoint every few dozen requests, each one an fsync stall. Batch
        # them instead.
        connection.execute("PRAGMA wal_autocheckpoint = 4000")
        connection.execute("PRAGMA synchronous = NORMAL")


def _column_names(connection, table: str) -> set[str]:
    cursor = connection.execute(f"PRAGMA table_info({table})")
    return {row[1] for row in cursor.fetchall()}


def initialize_database() -> None:
    _ensure_wal()
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS conversations (
                conversation_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL DEFAULT 'local_user',
                title TEXT NOT NULL,
                gem_id TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                user_id TEXT PRIMARY KEY,
                email TEXT NOT NULL,
                name TEXT NOT NULL,
                avatar_url TEXT,
                provider TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        connection.execute("CREATE INDEX IF NOT EXISTS idx_messages_conv "
                           "ON messages(conversation_id, id)")
        connection.execute("CREATE INDEX IF NOT EXISTS idx_conversations_user "
                           "ON conversations(user_id, updated_at)")

        # Migrate databases created before conversations carried a user_id.
        if "user_id" not in _column_names(connection, "conversations"):
            connection.execute(
                "ALTER TABLE conversations "
                "ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local_user'"
            )

        # -------------------------------------------------------------------
        # Noor Intelligence Layer tables (SQLite equivalents of the Postgres
        # schema in the spec: TEXT ids instead of UUID, INTEGER booleans,
        # REAL money, CURRENT_TIMESTAMP defaults).
        # -------------------------------------------------------------------
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_style_profiles (
                user_id TEXT PRIMARY KEY,
                prefers_concise INTEGER NOT NULL DEFAULT 0,
                prefers_examples INTEGER NOT NULL DEFAULT 1,
                technical_level TEXT NOT NULL DEFAULT 'intermediate',
                preferred_language TEXT NOT NULL DEFAULT 'english',
                response_length_preference TEXT NOT NULL DEFAULT 'medium',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_topic_affinity (
                user_id TEXT NOT NULL,
                topic TEXT NOT NULL,
                count INTEGER NOT NULL DEFAULT 1,
                last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, topic)
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS request_savings (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                conversation_id TEXT,
                tokens_saved INTEGER,
                cost_saved_usd REAL,
                cache_hit INTEGER,
                memories_used INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_savings_summary (
                user_id TEXT PRIMARY KEY,
                total_tokens_saved INTEGER NOT NULL DEFAULT 0,
                total_cost_saved_usd REAL NOT NULL DEFAULT 0,
                total_cache_hits INTEGER NOT NULL DEFAULT 0,
                total_requests INTEGER NOT NULL DEFAULT 0,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        # Idempotency ledger: how far each conversation has been processed into
        # memory, so re-processing never double-counts or corrupts the profile.
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_conversations (
                conversation_id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                processed_message_count INTEGER NOT NULL DEFAULT 0,
                facts_extracted INTEGER NOT NULL DEFAULT 0,
                topics TEXT,
                processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )

        # -------------------------------------------------------------------
        # Admin Intelligence Dashboard tables (additive; see admin_store.py).
        # A unified per-request log fed best-effort by BOTH chat paths, a
        # ratings ledger, and a generic event stream. Nothing here is on the
        # hot path's critical section — capture writes are wrapped best-effort
        # so analytics can never break a chat response.
        # -------------------------------------------------------------------
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_request_log (
                id TEXT PRIMARY KEY,
                user_id TEXT,
                conversation_id TEXT,
                gem_id TEXT,
                source TEXT NOT NULL DEFAULT 'chat',
                question TEXT,
                response TEXT,
                provider TEXT,
                model TEXT,
                task_type TEXT,
                cache_result TEXT,
                memories_used INTEGER NOT NULL DEFAULT 0,
                tokens_saved INTEGER NOT NULL DEFAULT 0,
                cost_saved_usd REAL NOT NULL DEFAULT 0,
                latency_ms INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_admin_request_log_created "
            "ON admin_request_log(created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_admin_request_log_user "
            "ON admin_request_log(user_id)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS message_ratings (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                message_id INTEGER NOT NULL DEFAULT -1,
                rating INTEGER NOT NULL,
                comment TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, conversation_id, message_id)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_message_ratings_conv "
            "ON message_ratings(conversation_id)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS admin_events (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL DEFAULT 'info',
                user_id TEXT,
                detail TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_admin_events_created "
            "ON admin_events(created_at)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_admin_events_type "
            "ON admin_events(event_type)"
        )

        # -------------------------------------------------------------------
        # BYOK — user-supplied provider credentials (see backend/app/byok.py).
        # The credential itself is AES-256-GCM ciphertext, bound to
        # (user_id, provider) as AEAD associated data; `key_hint` is a masked
        # display string and `fingerprint` is a non-reversible SHA-256 prefix.
        # There is deliberately NO plaintext column to accidentally leak.
        # -------------------------------------------------------------------
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS user_api_keys (
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                ciphertext TEXT NOT NULL,
                key_hint TEXT NOT NULL,
                fingerprint TEXT,
                model TEXT,
                revoked INTEGER NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_verified_at TIMESTAMP,
                last_used_at TIMESTAMP,
                PRIMARY KEY (user_id, provider)
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_user_api_keys_user "
            "ON user_api_keys(user_id)"
        )
