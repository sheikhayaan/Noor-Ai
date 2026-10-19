import logging
import os
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


MODEL_PROVIDER = os.getenv("NOOR_MODEL_PROVIDER", "fake")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
OPENAI_TIMEOUT_SECONDS = float(os.getenv("OPENAI_TIMEOUT_SECONDS", "30"))

# Noor Gateway — the infrastructure layer Noor AI routes through. Noor AI never
# calls models directly; when MODEL_PROVIDER=gateway it forwards chat to the
# gateway's OpenAI-compatible endpoint and lets the gateway pick the model.
NOOR_GATEWAY_BASE_URL = os.getenv("NOOR_GATEWAY_BASE_URL", "http://127.0.0.1:8080")
NOOR_GATEWAY_API_KEY = os.getenv("NOOR_GATEWAY_API_KEY", "ngw_sk_dev")
NOOR_GATEWAY_MODEL = os.getenv("NOOR_GATEWAY_MODEL", "noor-auto")
NOOR_GATEWAY_TIMEOUT_SECONDS = float(os.getenv("NOOR_GATEWAY_TIMEOUT_SECONDS", "45"))

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

# ---------------------------------------------------------------------------
# Noor Intelligence Layer
# ---------------------------------------------------------------------------
# Master switch. Tests set NOOR_INTELLIGENCE_ENABLED=false so the suite never
# opens the on-disk Qdrant store (keeps tests hermetic + avoids storage locks).
NOOR_INTELLIGENCE_ENABLED = os.getenv("NOOR_INTELLIGENCE_ENABLED", "true").lower() != "false"

# Embedding dimensionality — must match the gateway's embedding model output
# (all-MiniLM-L6-v2 = 384) and the Qdrant collections' vector size.
EMBEDDING_DIMENSIONS = int(os.getenv("NOOR_EMBEDDING_DIMENSIONS", "384"))

# Embedded (on-disk) Qdrant storage directory — anchored at the repo root so it
# is stable regardless of the process working directory. No server/Docker.
QDRANT_PATH = os.getenv(
    "NOOR_QDRANT_PATH",
    str(Path(__file__).resolve().parents[2] / "qdrant_data"),
)

# The gateway embed call may block on a one-time model download the very first
# time, so give it a generous timeout.
NOOR_GATEWAY_EMBED_TIMEOUT_SECONDS = float(os.getenv("NOOR_GATEWAY_EMBED_TIMEOUT_SECONDS", "60"))

# Cost accounting for savings math. Approximate blended USD per token; used only
# for the honest savings display (tokens_saved * cost_per_token).
NOOR_COST_PER_TOKEN_USD = float(os.getenv("NOOR_COST_PER_TOKEN_USD", "0.0000006"))

# ---------------------------------------------------------------------------
# Session / auth — identity binding (see backend/app/auth.py)
# ---------------------------------------------------------------------------
# Signing key for stateless HS256 session tokens. MUST be a long random value in
# production (e.g. `openssl rand -hex 32`). If unset we mint a random ephemeral
# key at boot so dev works with zero config — but every restart then invalidates
# live sessions and it is unsafe across multiple workers, so never lean on the
# fallback in production.
NOOR_SESSION_SECRET = os.getenv("NOOR_SESSION_SECRET") or ""
if not NOOR_SESSION_SECRET:
    import secrets as _secrets

    NOOR_SESSION_SECRET = _secrets.token_hex(32)
    logging.getLogger("noor.auth").warning(
        "NOOR_SESSION_SECRET is unset — using an ephemeral dev key; sessions will "
        "not survive a restart. Set NOOR_SESSION_SECRET in production."
    )

# Session lifetime and cookie behavior.
NOOR_SESSION_TTL_SECONDS = int(os.getenv("NOOR_SESSION_TTL_SECONDS", str(30 * 24 * 3600)))
NOOR_SESSION_COOKIE_NAME = os.getenv("NOOR_SESSION_COOKIE_NAME", "noor_session")
# Secure cookies require HTTPS; default off so local http://127.0.0.1 dev works.
NOOR_SESSION_COOKIE_SECURE = os.getenv("NOOR_SESSION_COOKIE_SECURE", "false").lower() == "true"

# Enforcement switch (observe -> enforce rollout). OFF: a valid session wins but
# requests without one fall back to the client-supplied user_id (legacy, unchanged).
# ON: the client id is ignored and a missing/invalid session is a 401.
NOOR_AUTH_ENFORCE = os.getenv("NOOR_AUTH_ENFORCE", "false").lower() == "true"

# ---------------------------------------------------------------------------
# Concurrency + usage limits (server-authoritative; see backend/app/concurrency.py)
# ---------------------------------------------------------------------------
# Max chat requests a single user may have in flight at once. <= 0 disables.
NOOR_MAX_CONCURRENT_PER_USER = int(os.getenv("NOOR_MAX_CONCURRENT_PER_USER", "3"))
# How long a request waits for a free slot before giving up with a 429.
NOOR_CONCURRENCY_TIMEOUT_SECONDS = float(os.getenv("NOOR_CONCURRENCY_TIMEOUT_SECONDS", "10"))
# Per-user per-UTC-day message cap. 0 = unlimited (default — the client shows a
# soft cap; set this to make the server authoritative, e.g. 200).
NOOR_DAILY_MESSAGE_LIMIT = int(os.getenv("NOOR_DAILY_MESSAGE_LIMIT", "0"))

# ---------------------------------------------------------------------------
# Admin Intelligence Dashboard access (env allowlist; see backend/app/admin.py)
# ---------------------------------------------------------------------------
# Who may reach /api/admin. A caller is admin iff their VERIFIED session email
# or user_id is on one of these allowlists — the client-supplied id is never
# trusted (identity comes from the signed session, same chokepoint as the rest
# of auth). Empty lists => no session grants admin (loopback may still, below).
def _csv_env(name: str) -> frozenset[str]:
    raw = os.getenv(name, "") or ""
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


NOOR_ADMIN_EMAILS = _csv_env("NOOR_ADMIN_EMAILS")
NOOR_ADMIN_USER_IDS = _csv_env("NOOR_ADMIN_USER_IDS")

# Allow requests arriving on the loopback interface (127.0.0.1 / ::1) to reach
# the admin API without an allowlisted session — convenient for local dev and
# server-side tooling on the same box. We key this off the real TCP peer
# (request.client.host), NOT the spoofable X-Forwarded-For header, so a remote
# client cannot fake loopback. Caveat: behind a reverse proxy that terminates
# on localhost every request looks loopback — set this false and use the email/
# user-id allowlist in that deployment. Defaults ON for the local-first app.
NOOR_ADMIN_ALLOW_LOOPBACK = os.getenv("NOOR_ADMIN_ALLOW_LOOPBACK", "true").lower() == "true"

# ===========================================================================
# Deployment, BYOK (bring-your-own-key) and scale-out configuration
# ===========================================================================
# Environment name drives production-grade guards (secure cookies, strict
# secrets, no dev-only auth shortcuts). Deployment sets NOOR_ENV=production.
NOOR_ENV = (os.getenv("NOOR_ENV", "development") or "development").strip().lower()
IS_PRODUCTION = NOOR_ENV in {"production", "prod"}

# Extra CORS origins (comma separated). Local dev defaults are always allowed so
# a fresh clone works; production must set its own public origin(s).
NOOR_EXTRA_ORIGINS = _csv_env("NOOR_ALLOWED_ORIGINS")

# Request hardening: reject oversized bodies and absurd message lengths *before*
# they reach the model (a 10 MB prompt is a denial-of-service, not a feature).
NOOR_MAX_BODY_BYTES = int(os.getenv("NOOR_MAX_BODY_BYTES", str(1 << 18)))   # 256 KiB
NOOR_MAX_MESSAGE_CHARS = int(os.getenv("NOOR_MAX_MESSAGE_CHARS", "8000"))

# Server-wide concurrency ceiling. Per-user slots stop one client hogging the
# box; this stops 1000 clients from exhausting sockets/threads/memory at once.
# Requests queue (bounded by NOOR_CONCURRENCY_TIMEOUT_SECONDS) rather than 500.
NOOR_MAX_CONCURRENT_GLOBAL = int(os.getenv("NOOR_MAX_CONCURRENT_GLOBAL", "256"))
NOOR_HTTP_POOL_SIZE = int(os.getenv("NOOR_HTTP_POOL_SIZE", "64"))
NOOR_HTTP_MAX_RETRIES = int(os.getenv("NOOR_HTTP_MAX_RETRIES", "1"))
NOOR_HTTP_KEEPALIVE_SECONDS = int(os.getenv("NOOR_HTTP_KEEPALIVE_SECONDS", "30"))

# Background memory extraction runs off-request. A bounded pool keeps it from
# competing with chat threads for CPU when traffic spikes; work is dropped (and
# logged) instead of growing an unbounded queue.
NOOR_BG_WORKERS = int(os.getenv("NOOR_BG_WORKERS", "4"))
NOOR_BG_QUEUE_SIZE = int(os.getenv("NOOR_BG_QUEUE_SIZE", "500"))

# Per-identity request budgets (requests per 60s window). 0 disables a class.
NOOR_RATE_LIMIT_CHAT_PER_MIN = int(os.getenv("NOOR_RATE_LIMIT_CHAT_PER_MIN", "60"))
NOOR_RATE_LIMIT_CHAT_BURST = int(os.getenv("NOOR_RATE_LIMIT_CHAT_BURST", "10"))
NOOR_RATE_LIMIT_AUTH_PER_MIN = int(os.getenv("NOOR_RATE_LIMIT_AUTH_PER_MIN", "20"))
NOOR_RATE_LIMIT_AUTH_BURST = int(os.getenv("NOOR_RATE_LIMIT_AUTH_BURST", "5"))
NOOR_RATE_LIMIT_BYOK_PER_MIN = int(os.getenv("NOOR_RATE_LIMIT_BYOK_PER_MIN", "20"))
NOOR_RATE_LIMIT_BYOK_BURST = int(os.getenv("NOOR_RATE_LIMIT_BYOK_BURST", "5"))

# ---------------------------------------------------------------------------
# BYOK — users bring their own Anthropic/OpenAI/Google/... key. We never bill
# them, but we do store the credential, so it is envelope-encrypted at rest
# (AES-256-GCM) and bound to (user_id, provider) as AEAD associated data.
# ---------------------------------------------------------------------------
NOOR_BYOK_ENABLED = os.getenv("NOOR_BYOK_ENABLED", "true").lower() != "false"
# Optional dedicated master key: base64 (32 bytes) / hex (64 chars) / passphrase.
# When unset we derive one from NOOR_SESSION_SECRET with HKDF-SHA256 (domain
# separated), so a single well-managed secret is enough to run the product.
NOOR_ENCRYPTION_KEY = os.getenv("NOOR_ENCRYPTION_KEY") or ""
# Live-validate a key against the provider before storing it (recommended).
NOOR_BYOK_VERIFY_ON_SAVE = os.getenv("NOOR_BYOK_VERIFY_ON_SAVE", "true").lower() != "false"
NOOR_BYOK_TIMEOUT_SECONDS = float(os.getenv("NOOR_BYOK_TIMEOUT_SECONDS", "15"))
NOOR_BYOK_MAX_KEYS_PER_USER = int(os.getenv("NOOR_BYOK_MAX_KEYS_PER_USER", "8"))

# ---------------------------------------------------------------------------
# Session secret hardening: persist a dev secret so sessions and encrypted BYOK
# keys survive restarts instead of silently becoming undecryptable.
# ---------------------------------------------------------------------------
NOOR_SESSION_SECRET_IS_EPHEMERAL = not NOOR_SESSION_SECRET
if NOOR_SESSION_SECRET_IS_EPHEMERAL:
    _secret_file = Path(
        os.getenv("NOOR_SECRET_FILE", str(Path(__file__).resolve().parents[2] / ".noor_secret"))
    )
    _persisted = ""
    try:
        if _secret_file.exists():
            _persisted = _secret_file.read_text(encoding="utf-8").strip()
        elif os.getenv("NOOR_EPHEMERAL_SECRET", "").lower() not in {"1", "true", "yes"}:
            import os as _os
            import secrets as _secrets_file

            _candidate = _secrets_file.token_hex(32)
            _fd = _os.open(_secret_file, _os.O_CREAT | _os.O_EXCL | _os.O_WRONLY, 0o600)
            try:
                _os.write(_fd, _candidate.encode("utf-8"))
            finally:
                _os.close(_fd)
            _persisted = _candidate
    except OSError:
        _persisted = ""

    if _persisted and len(_persisted) >= 32:
        NOOR_SESSION_SECRET = _persisted
        NOOR_SESSION_SECRET_IS_EPHEMERAL = False
        logging.getLogger("noor.auth").info(
            "NOOR_SESSION_SECRET loaded from %s (dev persistence).", _secret_file
        )
    else:
        import secrets as _secrets_fallback

        NOOR_SESSION_SECRET = _secrets_fallback.token_hex(32)
        logging.getLogger("noor.auth").warning(
            "NOOR_SESSION_SECRET is unset — using an ephemeral dev key; sessions and "
            "saved BYOK keys will not survive a restart. Set NOOR_SESSION_SECRET in production."
        )

if IS_PRODUCTION and NOOR_SESSION_SECRET_IS_EPHEMERAL:
    raise RuntimeError(
        "NOOR_SESSION_SECRET must be set in production (e.g. `openssl rand -hex 32`)."
    )

# Production defaults: cookies must be Secure (HTTPS) and auth must be enforced.
if IS_PRODUCTION:
    if not NOOR_SESSION_COOKIE_SECURE:
        logging.getLogger("noor.auth").warning(
            "NOOR_SESSION_COOKIE_SECURE=false in production — enable HTTPS and set it true."
        )
    if not NOOR_AUTH_ENFORCE:
        logging.getLogger("noor.auth").warning(
            "NOOR_AUTH_ENFORCE=false in production — client-supplied user ids are trusted."
        )
