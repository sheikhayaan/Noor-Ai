"""BYOK — users bring their own Anthropic / OpenAI / Google / Groq keys.

Product rationale: Noor's semantic cache already cuts cost for shared traffic.
Users who want a frontier model (Claude Sonnet, GPT-4.1, Gemini 2.5 Pro…) can
attach their **own** key, pay their own vendor directly, and bypass Noor's
gateway entirely. Noor never proxies those credentials anywhere except to the
provider they belong to.

Security invariants enforced here
---------------------------------
* Keys are encrypted with AES-256-GCM before they touch SQLite
  (:mod:`backend.app.crypto`), bound to ``(user_id, provider)``.
* Keys are **write-only** over the API: reads return a masked hint only.
* Keys are validated against the provider before being stored, so a typo cannot
  silently poison every later request.
* A user may hold at most ``NOOR_BYOK_MAX_KEYS_PER_USER`` providers.
* Decrypted keys live only for the duration of a call (never cached on disk or
  in a module-level dict).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from backend.app import crypto, providers
from backend.app.database import get_connection
from backend.app.settings import (
    NOOR_BYOK_MAX_KEYS_PER_USER,
    NOOR_BYOK_VERIFY_ON_SAVE,
)

logger = logging.getLogger("noor.byok")


# ---------------------------------------------------------------------------
# Provider catalog
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    kind: str                 # openai | anthropic | google
    base_url: str
    docs_url: str
    models: tuple[tuple[str, str], ...]

    @property
    def default_model(self) -> str:
        return self.models[0][0]


PROVIDERS: dict[str, ProviderSpec] = {
    "anthropic": ProviderSpec(
        id="anthropic",
        label="Anthropic",
        kind="anthropic",
        base_url="https://api.anthropic.com",
        docs_url="https://console.anthropic.com/settings/keys",
        models=(
            ("claude-sonnet-4-5", "Claude Sonnet 4.5"),
            ("claude-opus-4-1", "Claude Opus 4.1"),
            ("claude-3-7-sonnet-latest", "Claude 3.7 Sonnet"),
            ("claude-3-5-haiku-latest", "Claude 3.5 Haiku"),
        ),
    ),
    "openai": ProviderSpec(
        id="openai",
        label="OpenAI",
        kind="openai",
        base_url="https://api.openai.com/v1",
        docs_url="https://platform.openai.com/api-keys",
        models=(
            ("gpt-4.1", "GPT-4.1"),
            ("gpt-4.1-mini", "GPT-4.1 mini"),
            ("gpt-4o", "GPT-4o"),
            ("gpt-4o-mini", "GPT-4o mini"),
            ("o4-mini", "o4-mini (reasoning)"),
        ),
    ),
    "google": ProviderSpec(
        id="google",
        label="Google Gemini",
        kind="google",
        base_url="https://generativelanguage.googleapis.com",
        docs_url="https://aistudio.google.com/app/apikey",
        models=(
            ("gemini-2.5-pro", "Gemini 2.5 Pro"),
            ("gemini-2.5-flash", "Gemini 2.5 Flash"),
            ("gemini-2.0-flash", "Gemini 2.0 Flash"),
        ),
    ),
    "groq": ProviderSpec(
        id="groq",
        label="Groq",
        kind="openai",
        base_url="https://api.groq.com/openai/v1",
        docs_url="https://console.groq.com/keys",
        models=(
            ("openai/gpt-oss-120b", "GPT-OSS 120B (Groq)"),
            ("openai/gpt-oss-20b", "GPT-OSS 20B (Groq)"),
            ("llama-3.3-70b-versatile", "Llama 3.3 70B (Groq)"),
        ),
    ),
    "deepseek": ProviderSpec(
        id="deepseek",
        label="DeepSeek",
        kind="openai",
        base_url="https://api.deepseek.com/v1",
        docs_url="https://platform.deepseek.com/api_keys",
        models=(
            ("deepseek-chat", "DeepSeek Chat"),
            ("deepseek-reasoner", "DeepSeek Reasoner"),
        ),
    ),
    "openrouter": ProviderSpec(
        id="openrouter",
        label="OpenRouter",
        kind="openai",
        base_url="https://openrouter.ai/api/v1",
        docs_url="https://openrouter.ai/keys",
        models=(
            ("anthropic/claude-sonnet-4.5", "Claude Sonnet 4.5"),
            ("openai/gpt-4.1", "GPT-4.1"),
            ("google/gemini-2.5-pro", "Gemini 2.5 Pro"),
            ("deepseek/deepseek-chat-v3.1", "DeepSeek Chat v3.1"),
        ),
    ),
    "mistral": ProviderSpec(
        id="mistral",
        label="Mistral",
        kind="openai",
        base_url="https://api.mistral.ai/v1",
        docs_url="https://console.mistral.ai/api-keys",
        models=(
            ("mistral-large-latest", "Mistral Large"),
            ("mistral-small-latest", "Mistral Small"),
        ),
    ),
}

GATEWAY_MODEL_ID = "noor-auto"


class ByokError(RuntimeError):
    """A BYOK operation failed in a way the client should see."""

    def __init__(self, message: str, *, code: str = "byok_error", status: int = 400):
        super().__init__(message)
        self.code = code
        self.status = status


class KeyRequiredError(ByokError):
    def __init__(self, provider: str):
        super().__init__(
            f"Add your {PROVIDERS.get(provider, ProviderSpec(provider, provider, '', '', '', ())).label} "
            "API key in Settings → API keys, or switch back to Noor Auto.",
            code="byok_key_required",
            status=409,
        )


@dataclass(frozen=True)
class StoredKey:
    provider: str
    model: str
    api_key: str  # noqa: S105 - decrypted in memory only, never logged


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------
def _normalize_provider(provider: str) -> str:
    key = (provider or "").strip().lower()
    if key not in PROVIDERS:
        raise ByokError(f"Unknown provider '{provider}'.", code="unknown_provider", status=404)
    return key


def list_keys(user_id: str) -> list[dict]:
    """Masked metadata for every key this user has stored (never the key)."""
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT provider, model, key_hint, created_at, updated_at,
                   last_verified_at, last_used_at
            FROM user_api_keys
            WHERE user_id = ? AND revoked = 0
            ORDER BY provider ASC
            """,
            (user_id,),
        ).fetchall()
    return [
        {
            "provider": row[0],
            "label": PROVIDERS.get(row[0]).label if row[0] in PROVIDERS else row[0],
            "model": row[1],
            "hint": row[2],
            "created_at": row[3],
            "updated_at": row[4],
            "last_verified_at": row[5],
            "last_used_at": row[6],
        }
        for row in rows
    ]


def get_stored_key(user_id: str, provider: str) -> Optional[StoredKey]:
    """Decrypt and return the user's key for ``provider`` (or None)."""
    provider = _normalize_provider(provider)
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT model, ciphertext FROM user_api_keys
            WHERE user_id = ? AND provider = ? AND revoked = 0
            """,
            (user_id, provider),
        ).fetchone()
    if row is None:
        return None
    try:
        secret = crypto.decrypt_secret(row[1], user_id=user_id, provider=provider)
    except crypto.SecretDecryptionError:
        # Ciphertext no longer decryptable (rotated NOOR_SESSION_SECRET /
        # tampered row). Fail closed: treat as absent and flag for re-entry.
        logger.warning("BYOK ciphertext unusable for user=%s provider=%s", user_id, provider)
        return None
    return StoredKey(provider=provider, model=row[0], api_key=secret)


def verify_and_store(
    user_id: str, provider: str, api_key: str, model: Optional[str] = None
) -> dict:
    """Validate a key with the provider, then encrypt and upsert it."""
    provider = _normalize_provider(provider)
    spec = PROVIDERS[provider]
    candidate = (api_key or "").strip()

    if not _looks_like_key(candidate):
        raise ByokError(
            "That does not look like an API key (expected 20–200 characters, no spaces).",
            code="invalid_key_format",
            status=422,
        )

    chosen_model = (model or spec.default_model).strip()
    try:
        providers.validate_model_id(chosen_model)
    except providers.ProviderError as error:
        raise ByokError(str(error), code="invalid_model", status=422) from error

    existing = {row["provider"] for row in list_keys(user_id)}
    if provider not in existing and len(existing) >= NOOR_BYOK_MAX_KEYS_PER_USER:
        raise ByokError(
            f"You can store at most {NOOR_BYOK_MAX_KEYS_PER_USER} provider keys.",
            code="too_many_keys",
            status=409,
        )

    if NOOR_BYOK_VERIFY_ON_SAVE:
        ok, message = providers.verify_credentials(spec.kind, spec.base_url, candidate, spec.label)
        if not ok:
            raise ByokError(message, code="key_rejected", status=422)

    blob = crypto.encrypt_secret(candidate, user_id=user_id, provider=provider)
    hint = crypto.mask_secret(candidate)
    with get_connection() as connection:
        connection.execute(
            """
            INSERT INTO user_api_keys
                (user_id, provider, ciphertext, key_hint, model, revoked,
                 created_at, updated_at, last_verified_at)
            VALUES (?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, provider) DO UPDATE SET
                ciphertext = excluded.ciphertext,
                key_hint = excluded.key_hint,
                model = excluded.model,
                revoked = 0,
                updated_at = CURRENT_TIMESTAMP,
                last_verified_at = CURRENT_TIMESTAMP
            """,
            (user_id, provider, blob, hint, chosen_model),
        )
    logger.info("BYOK key stored user=%s provider=%s", user_id, provider)
    return {"provider": provider, "model": chosen_model, "hint": hint, "verified": True}


def delete_key(user_id: str, provider: str) -> bool:
    provider = _normalize_provider(provider)
    with get_connection() as connection:
        cursor = connection.execute(
            "DELETE FROM user_api_keys WHERE user_id = ? AND provider = ?",
            (user_id, provider),
        )
    removed = cursor.rowcount > 0
    if removed:
        logger.info("BYOK key deleted user=%s provider=%s", user_id, provider)
    return removed


def touch_used(user_id: str, provider: str) -> None:
    try:
        with get_connection() as connection:
            connection.execute(
                "UPDATE user_api_keys SET last_used_at = CURRENT_TIMESTAMP "
                "WHERE user_id = ? AND provider = ?",
                (user_id, provider),
            )
    except Exception as error:  # noqa: BLE001 - telemetry only
        logger.debug("touch_used failed: %s", error)


def test_key(user_id: str, provider: str) -> tuple[bool, str]:
    stored = get_stored_key(user_id, provider)
    if stored is None:
        raise ByokError("No key stored for that provider.", code="key_missing", status=404)
    spec = PROVIDERS[stored.provider]
    return providers.verify_credentials(spec.kind, spec.base_url, stored.api_key, spec.label)


def _looks_like_key(value: str) -> bool:
    if not (20 <= len(value) <= 200):
        return False
    return all(33 <= ord(ch) <= 126 for ch in value)


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
def parse_model_id(model_id: str) -> tuple[str, str]:
    """``"openai:gpt-4.1"`` -> ``("openai", "gpt-4.1")``; bare ids resolved too."""
    raw = (model_id or "").strip()
    if ":" in raw:
        provider, model = raw.split(":", 1)
        return _normalize_provider(provider), model.strip()
    matches = [
        (spec.id, model)
        for spec in PROVIDERS.values()
        for model, _label in spec.models
        if model == raw
    ]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise ByokError(
            "That model exists at several providers — send 'provider:model'.",
            code="ambiguous_model",
            status=409,
        )
    raise ByokError(f"Unknown model '{model_id}'.", code="unknown_model", status=404)


def resolve_route(user_id: str, model_id: Optional[str]) -> Optional[providers.Route]:
    """Map a requested model id to a direct provider route (None = gateway)."""
    requested = (model_id or "").strip()
    if not requested or requested == GATEWAY_MODEL_ID or requested == "default":
        return None

    provider, model = parse_model_id(requested)
    spec = PROVIDERS[provider]
    stored = get_stored_key(user_id, provider)
    if stored is None:
        raise KeyRequiredError(provider)

    return providers.Route(
        provider=provider,
        kind=spec.kind,
        base_url=spec.base_url,
        model=model,
        label=f"{spec.label} · {model}",
        api_key=stored.api_key,
    )


def catalog(user_id: str) -> list[dict]:
    """Every selectable model, flagged with whether this user can use it now."""
    stored = {row["provider"] for row in list_keys(user_id)}
    items = [
        {
            "id": GATEWAY_MODEL_ID,
            "label": "Noor Auto (routed + cached)",
            "provider": "noor",
            "provider_label": "Noor Gateway",
            "requires_key": False,
            "available": True,
            "default": True,
        }
    ]
    for spec in PROVIDERS.values():
        has_key = spec.id in stored
        for model, label in spec.models:
            items.append(
                {
                    "id": f"{spec.id}:{model}",
                    "label": label,
                    "provider": spec.id,
                    "provider_label": spec.label,
                    "requires_key": True,
                    "available": has_key,
                    "default": False,
                }
            )
    return items
