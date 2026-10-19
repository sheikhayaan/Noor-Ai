"""Admin Intelligence Dashboard API — read-only analytics over everything the
platform captured, gated by an env allowlist on the *verified session identity*.

Mounted under ``/api/admin`` by ``backend.app.main``. Every route depends on
:func:`require_admin`, which grants access iff either:

* the caller presents a signed session whose email or user_id is on
  ``NOOR_ADMIN_EMAILS`` / ``NOOR_ADMIN_USER_IDS`` (identity comes from the same
  HS256 session the rest of auth trusts — a client-supplied id is never used), or
* the request arrives on the loopback interface and ``NOOR_ADMIN_ALLOW_LOOPBACK``
  is on (local-dev convenience; keyed off the real TCP peer, not a spoofable
  header).

Reads are honest aggregations from ``admin_store``; the cache panel is a
server-side proxy to the gateway's ``/v1/cache/health`` (Phase 1), so the
gateway dev key never reaches the browser. Denied attempts are recorded to the
event stream; successful reads are not (that would flood the very feed the
dashboard shows).
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.request

from fastapi import APIRouter, Depends, HTTPException, Request

from backend.app import admin_store
from backend.app.auth import SessionIdentity, auth_enforced, get_current_user
from backend.app.settings import (
    NOOR_ADMIN_ALLOW_LOOPBACK,
    NOOR_ADMIN_EMAILS,
    NOOR_ADMIN_USER_IDS,
    NOOR_GATEWAY_API_KEY,
    NOOR_GATEWAY_BASE_URL,
)

logger = logging.getLogger("noor.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])

_LOOPBACK_HOSTS = {"127.0.0.1", "::1", "localhost"}


# ---------------------------------------------------------------------------
# Access control
# ---------------------------------------------------------------------------
def _is_loopback(request: Request) -> bool:
    client = request.client
    return bool(client) and client.host in _LOOPBACK_HOSTS


def _admin_grant(
    request: Request, session: SessionIdentity | None
) -> tuple[bool, str, SessionIdentity | None]:
    """Decide admin access. Returns (allowed, granted_via, identity)."""
    if session is not None:
        email = (session.email or "").lower()
        uid = (session.user_id or "").lower()
        if (email and email in NOOR_ADMIN_EMAILS) or (uid and uid in NOOR_ADMIN_USER_IDS):
            return True, "session", session
    if NOOR_ADMIN_ALLOW_LOOPBACK and _is_loopback(request):
        return True, "loopback", session
    return False, "denied", session


def require_admin(
    request: Request,
    session: SessionIdentity | None = Depends(get_current_user),
) -> SessionIdentity:
    """FastAPI dependency: the admin identity, or 403. Records denied attempts."""
    allowed, via, ident = _admin_grant(request, session)
    if not allowed:
        client = request.client
        admin_store.log_event(
            "admin.denied",
            user_id=session.user_id if session else None,
            severity="warning",
            detail={
                "path": request.url.path,
                "peer": client.host if client else None,
                "had_session": session is not None,
            },
        )
        raise HTTPException(
            status_code=403,
            detail={
                "error": "admin_required",
                "message": "Admin access is restricted to allowlisted accounts.",
            },
        )
    # Synthesize a stable identity for the loopback-without-session case so
    # downstream code always has a user_id to work with.
    return ident or SessionIdentity(user_id="loopback:admin", provider="loopback")


# ---------------------------------------------------------------------------
# Gateway cache health proxy (Phase 1 surfaced in the dashboard)
# ---------------------------------------------------------------------------
def _fetch_gateway_cache_health() -> dict:
    url = f"{NOOR_GATEWAY_BASE_URL.rstrip('/')}/v1/cache/health"
    req = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {NOOR_GATEWAY_API_KEY}"}
    )
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:  # noqa: S310 (trusted local URL)
            body = json.loads(resp.read().decode("utf-8"))
        # Gateway envelope is {success, data}; unwrap to the report itself.
        data = body.get("data", body) if isinstance(body, dict) else body
        return {"reachable": True, "health": data}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
        return {
            "reachable": False,
            "error": str(error),
            "base_url": NOOR_GATEWAY_BASE_URL,
        }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@router.get("/whoami")
def whoami(
    request: Request,
    admin: SessionIdentity = Depends(require_admin),
    session: SessionIdentity | None = Depends(get_current_user),
):
    _, via, _ident = _admin_grant(request, session)
    return {
        "admin": True,
        "granted_via": via,
        "user_id": admin.user_id,
        "email": admin.email,
        "name": admin.name,
        "provider": admin.provider,
        "enforce": auth_enforced(),
        "allowlist": {
            "emails": len(NOOR_ADMIN_EMAILS),
            "user_ids": len(NOOR_ADMIN_USER_IDS),
            "allow_loopback": NOOR_ADMIN_ALLOW_LOOPBACK,
        },
    }


@router.get("/overview")
def overview(admin: SessionIdentity = Depends(require_admin)):
    return admin_store.get_overview()


@router.get("/requests")
def requests_log(
    limit: int = 50,
    offset: int = 0,
    user_id: str | None = None,
    admin: SessionIdentity = Depends(require_admin),
):
    rows = admin_store.list_recent_requests(limit=limit, offset=offset, user_id=user_id)
    return {"requests": rows, "count": len(rows), "limit": limit, "offset": offset}


@router.get("/users")
def users(limit: int = 100, admin: SessionIdentity = Depends(require_admin)):
    rows = admin_store.list_users_overview(limit=limit)
    return {"users": rows, "count": len(rows)}


@router.get("/timeseries")
def timeseries(days: int = 30, admin: SessionIdentity = Depends(require_admin)):
    return {"days": days, "series": admin_store.get_requests_timeseries(days=days)}


@router.get("/events")
def events(
    limit: int = 100,
    event_type: str | None = None,
    admin: SessionIdentity = Depends(require_admin),
):
    rows = admin_store.list_events(limit=limit, event_type=event_type)
    return {"events": rows, "count": len(rows)}


@router.get("/ratings")
def ratings(limit: int = 20, admin: SessionIdentity = Depends(require_admin)):
    return admin_store.get_rating_summary(limit=limit)


@router.get("/cache")
def cache_health(admin: SessionIdentity = Depends(require_admin)):
    """Server-side proxy to the gateway cache-lifecycle health report."""
    return _fetch_gateway_cache_health()
