"""Signed session layer for Noor AI — identity binding (the core auth fix).

The hole this closes: every endpoint historically trusted a client-supplied
``user_id`` (request body or query string), so any client could read, rename or
delete *another* user's conversations and memory simply by naming their id.
``/auth/google`` verified a Google identity but issued nothing to bind it, so the
verification was decorative. This module replaces that trust with a
*server-signed* session.

Design
------
* **Stateless HS256 tokens** (compact, JWT-shaped), signed with
  ``NOOR_SESSION_SECRET``. No database, no new dependency — HMAC-SHA256 from the
  standard library, verified with a constant-time compare.
* **Two identity kinds.** Google sign-in mints ``sub="google:<subject>"`` — the
  *same* id the app already stored, so existing history stays reachable. Guests
  get a server-minted ``sub="guest:<uuid>"`` the client can never choose.
* **Transport.** An HttpOnly cookie (primary — JS can't read it, so XSS can't
  lift it) with an ``Authorization: Bearer`` fallback for tools and tests.
* **Rollout.** ``NOOR_AUTH_ENFORCE`` gates enforcement. OFF (default) = observe
  mode: a valid session wins, but a request without one still falls back to the
  legacy client ``user_id`` so the running app is untouched. ON = the client id
  is ignored entirely and a missing/invalid session is a 401. Flip it once the
  frontend issues sessions everywhere.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import time
import uuid
from dataclasses import dataclass
from typing import Optional

from fastapi import HTTPException, Request, Response

from backend.app.settings import (
    NOOR_AUTH_ENFORCE,
    NOOR_SESSION_COOKIE_NAME,
    NOOR_SESSION_COOKIE_SECURE,
    NOOR_SESSION_SECRET,
    NOOR_SESSION_TTL_SECONDS,
)

logger = logging.getLogger("noor.auth")

_ALG = "HS256"
_ISS = "noor-ai"


# ---------------------------------------------------------------------------
# Token codec (compact HS256 — header.payload.signature, base64url, no padding)
# ---------------------------------------------------------------------------
def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(segment: str) -> bytes:
    padding = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + padding)


def _sign(signing_input: bytes) -> str:
    digest = hmac.new(
        NOOR_SESSION_SECRET.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    return _b64url_encode(digest)


def sign_session(
    user_id: str,
    provider: str,
    *,
    email: Optional[str] = None,
    name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
) -> str:
    """Mint a signed session token for ``user_id``."""
    now = int(time.time())
    ttl = int(ttl_seconds if ttl_seconds is not None else NOOR_SESSION_TTL_SECONDS)
    claims = {"iss": _ISS, "sub": user_id, "prov": provider, "iat": now, "exp": now + ttl}
    if email:
        claims["email"] = email
    if name:
        claims["name"] = name
    if avatar_url:
        claims["pic"] = avatar_url

    header = {"alg": _ALG, "typ": "JWT"}
    segments = [
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url_encode(json.dumps(claims, separators=(",", ":")).encode("utf-8")),
    ]
    signing_input = ".".join(segments).encode("ascii")
    segments.append(_sign(signing_input))
    return ".".join(segments)


def verify_session(token: str) -> Optional[dict]:
    """Return the claims for a valid, unexpired, correctly-signed token, else None."""
    if not token or token.count(".") != 2:
        return None
    header_b64, payload_b64, sig = token.split(".")
    expected = _sign(f"{header_b64}.{payload_b64}".encode("ascii"))
    # Constant-time compare defeats signature-timing attacks.
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        claims = json.loads(_b64url_decode(payload_b64))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(claims, dict) or claims.get("iss") != _ISS:
        return None
    exp = claims.get("exp")
    if not isinstance(exp, int) or exp < int(time.time()):
        return None
    if not claims.get("sub"):
        return None
    return claims


# ---------------------------------------------------------------------------
# Identity
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class SessionIdentity:
    user_id: str
    provider: str
    email: Optional[str] = None
    name: Optional[str] = None
    avatar_url: Optional[str] = None

    @property
    def is_guest(self) -> bool:
        return self.provider == "guest" or self.user_id.startswith("guest:")


def identity_from_claims(claims: dict) -> SessionIdentity:
    return SessionIdentity(
        user_id=claims["sub"],
        provider=claims.get("prov", "unknown"),
        email=claims.get("email"),
        name=claims.get("name"),
        avatar_url=claims.get("pic"),
    )


def new_guest_id() -> str:
    return f"guest:{uuid.uuid4().hex}"


# ---------------------------------------------------------------------------
# FastAPI wiring
# ---------------------------------------------------------------------------
def _token_from_request(request: Request) -> Optional[str]:
    # Cookie first (the browser default), then Authorization: Bearer (tools/tests).
    cookie = request.cookies.get(NOOR_SESSION_COOKIE_NAME)
    if cookie:
        return cookie
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def get_current_user(request: Request) -> Optional[SessionIdentity]:
    """FastAPI dependency: the verified session identity, or None.

    Never raises — a missing/invalid/expired token yields None. Enforcement is
    decided in :func:`resolve_user_id` so the observe-vs-enforce policy lives in
    exactly one place.
    """
    token = _token_from_request(request)
    if not token:
        return None
    claims = verify_session(token)
    if claims is None:
        return None
    return identity_from_claims(claims)


def auth_enforced() -> bool:
    return NOOR_AUTH_ENFORCE


def resolve_user_id(
    session: Optional[SessionIdentity], legacy_user_id: Optional[str]
) -> str:
    """The single chokepoint that decides *whose* data a request may touch.

    * Signed session present -> its subject wins; the client ``user_id`` is ignored.
    * No session, enforce OFF -> fall back to the legacy client id (observe mode,
      unchanged behavior) and log that it happened.
    * No session, enforce ON  -> 401. A client-supplied id is never trusted.
    """
    if session is not None:
        return session.user_id
    if NOOR_AUTH_ENFORCE:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "authentication_required",
                "message": "A valid Noor session is required.",
            },
        )
    resolved = (legacy_user_id or "local_user").strip() or "local_user"
    logger.info("auth.legacy_identity user_id=%s (no session; enforce off)", resolved)
    return resolved


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=NOOR_SESSION_COOKIE_NAME,
        value=token,
        max_age=NOOR_SESSION_TTL_SECONDS,
        httponly=True,
        secure=NOOR_SESSION_COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=NOOR_SESSION_COOKIE_NAME, path="/")
