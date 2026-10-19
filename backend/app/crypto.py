"""Envelope encryption for user-supplied provider API keys (BYOK).

Threat model
------------
A stolen ``noor_ai.db`` (backup leak, misconfigured disk snapshot, SQL injection
elsewhere) must not hand an attacker usable Anthropic/OpenAI credentials.

Design
------
* **AES-256-GCM** (AEAD) from ``cryptography`` — confidentiality *and* integrity.
* A fresh 96-bit nonce per record (never reused; GCM forgery is catastrophic).
* **Associated data binds the ciphertext to its owner**: ``user_id|provider|v1``.
  Copying a victim's blob into your own row therefore fails decryption instead of
  granting you their key.
* **Key derivation**: ``NOOR_ENCRYPTION_KEY`` when set, else HKDF-SHA256 over
  ``NOOR_SESSION_SECRET`` with an explicit ``info`` label (domain separation, so
  the session-signing key and the encryption key are independent).
* Nothing here is ever logged; :func:`redact` scrubs secrets out of error strings
  that might otherwise reach logs or HTTP responses.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import os
from functools import lru_cache

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

from backend.app.settings import NOOR_ENCRYPTION_KEY, NOOR_SESSION_SECRET

_VERSION = b"\x01"
_NONCE_BYTES = 12
_INFO = b"noor-byok-envelope-v1"


class SecretDecryptionError(RuntimeError):
    """Ciphertext is corrupt, tampered with, or bound to a different identity."""


def _decode_master_key(raw: str) -> bytes:
    """Accept base64, hex, or a passphrase (hashed) for NOOR_ENCRYPTION_KEY."""
    candidate = raw.strip()
    for decoder in (
        lambda value: base64.b64decode(value, validate=True),
        lambda value: bytes.fromhex(value),
    ):
        try:
            decoded = decoder(candidate)
        except (binascii.Error, ValueError):
            continue
        if len(decoded) in (16, 24, 32):
            return decoded if len(decoded) == 32 else hashlib.sha256(decoded).digest()
    # Passphrase fallback: deterministic 256-bit key.
    return hashlib.sha256(candidate.encode("utf-8")).digest()


@lru_cache(maxsize=1)
def _master_key() -> bytes:
    if NOOR_ENCRYPTION_KEY:
        return _decode_master_key(NOOR_ENCRYPTION_KEY)
    return HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=_INFO,
    ).derive(NOOR_SESSION_SECRET.encode("utf-8"))


def _aad(user_id: str, provider: str) -> bytes:
    return f"{user_id}|{provider.lower()}|v1".encode("utf-8")


def encrypt_secret(secret: str, *, user_id: str, provider: str) -> str:
    """Encrypt ``secret`` for this user+provider; returns an ASCII blob."""
    if not secret:
        raise ValueError("secret must not be empty")
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(_master_key()).encrypt(
        nonce, secret.encode("utf-8"), _aad(user_id, provider)
    )
    return base64.urlsafe_b64encode(_VERSION + nonce + ciphertext).decode("ascii")


def decrypt_secret(blob: str, *, user_id: str, provider: str) -> str:
    """Decrypt a blob produced by :func:`encrypt_secret`."""
    try:
        raw = base64.urlsafe_b64decode(blob.encode("ascii"))
    except (binascii.Error, ValueError, UnicodeEncodeError) as error:
        raise SecretDecryptionError("malformed ciphertext") from error
    if len(raw) < 1 + _NONCE_BYTES + 16 or raw[:1] != _VERSION:
        raise SecretDecryptionError("unsupported ciphertext version")
    nonce, ciphertext = raw[1 : 1 + _NONCE_BYTES], raw[1 + _NONCE_BYTES :]
    try:
        return (
            AESGCM(_master_key())
            .decrypt(nonce, ciphertext, _aad(user_id, provider))
            .decode("utf-8")
        )
    except (InvalidTag, UnicodeDecodeError) as error:
        raise SecretDecryptionError("ciphertext failed authentication") from error


def fingerprint(secret: str) -> str:
    """Stable, non-reversible identifier for a key (dedupe + display)."""
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:16]


def mask_secret(secret: str) -> str:
    """Render a credential for display: never more than a hint of it."""
    if not secret:
        return ""
    if len(secret) <= 8:
        return "••••"
    return f"{secret[:4]}…{secret[-4:]}"


def redact(text: str, secret: str | None = None) -> str:
    """Remove a known secret (and common key shapes) from logs/error messages."""
    if not text:
        return text
    cleaned = text
    if secret:
        cleaned = cleaned.replace(secret, mask_secret(secret))
    # Defence in depth: scrub anything that looks like a provider key.
    import re

    return re.sub(r"\b(sk|pk|rk|xai|gsk|ngw)[-_][A-Za-z0-9_\-]{12,}\b", "«redacted»", cleaned)


def constant_time_equals(a: str, b: str) -> bool:
    """Timing-safe string compare for token/credential equality checks."""
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))
