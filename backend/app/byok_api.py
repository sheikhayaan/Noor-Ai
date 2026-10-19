"""BYOK REST API — list models, attach/verify/remove provider credentials.

Routes (mounted under ``/api``):

    GET    /api/models                 selectable models + availability for this user
    GET    /api/byok                   stored keys (masked) + provider catalog
    PUT    /api/byok/{provider}        validate, encrypt and store a key
    DELETE /api/byok/{provider}        forget a key
    POST   /api/byok/{provider}/test   live re-verify a stored key

Security contract
-----------------
* A verified session is required by default (``NOOR_BYOK_REQUIRE_SESSION``) even
  in auth-observe mode: storing a credential for an unauthenticated, client-named
  user would be an account-takeover primitive.
* Responses never contain plaintext credentials — only a masked hint.
* All mutations are rate limited and audit-logged (provider name only).
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException

from backend.app import admin_store, byok, crypto, providers
from backend.app.auth import SessionIdentity, get_current_user, resolve_user_id
from backend.app.rate_limit import byok_limiter
from backend.app.schemas import (
    ByokKeyInfo,
    ByokKeyRequest,
    ByokKeyResponse,
    ByokListResponse,
    ByokProviderInfo,
    ByokTestResponse,
    DeleteByokKeyResponse,
    ModelInfo,
    ModelsResponse,
)
from backend.app.settings import NOOR_BYOK_ENABLED, NOOR_BYOK_MAX_KEYS_PER_USER

logger = logging.getLogger("noor.byok.api")

router = APIRouter(prefix="/api", tags=["byok"])


def _require_user(session: SessionIdentity | None, legacy_user_id: str) -> str:
    if not NOOR_BYOK_ENABLED:
        raise HTTPException(
            status_code=403,
            detail={"error": "byok_disabled", "message": "Bring-your-own-key is disabled."},
        )
    if session is None:
        raise HTTPException(
            status_code=401,
            detail={
                "error": "authentication_required",
                "message": "Sign in (or start a guest session) to manage API keys.",
            },
        )
    return resolve_user_id(session, legacy_user_id)


def _to_http(error: byok.ByokError) -> HTTPException:
    return HTTPException(
        status_code=error.status,
        detail={"error": error.code, "message": str(error)},
    )


@router.get("/models", response_model=ModelsResponse)
def list_models(
    session: SessionIdentity | None = Depends(get_current_user),
    user_id: str = "local_user",
):
    """Every model the user can pick, with availability flags for the picker."""
    resolved = resolve_user_id(session, user_id)
    return ModelsResponse(
        models=[ModelInfo(**item) for item in byok.catalog(resolved)],
        byok_enabled=NOOR_BYOK_ENABLED,
    )


@router.get("/byok", response_model=ByokListResponse)
def list_byok_keys(
    session: SessionIdentity | None = Depends(get_current_user),
    user_id: str = "local_user",
):
    resolved = _require_user(session, user_id)
    keys = [ByokKeyInfo(**row) for row in byok.list_keys(resolved)]
    catalog = [
        ByokProviderInfo(
            id=spec.id,
            label=spec.label,
            docs_url=spec.docs_url,
            models=[
                ModelInfo(
                    id=f"{spec.id}:{model}",
                    label=label,
                    provider=spec.id,
                    provider_label=spec.label,
                    requires_key=True,
                    available=any(key.provider == spec.id for key in keys),
                )
                for model, label in spec.models
            ],
        )
        for spec in byok.PROVIDERS.values()
    ]
    return ByokListResponse(
        keys=keys,
        max_keys=NOOR_BYOK_MAX_KEYS_PER_USER,
        providers=catalog,
    )


@router.put(
    "/byok/{provider}",
    response_model=ByokKeyResponse,
    dependencies=[Depends(byok_limiter())],
)
def upsert_byok_key(
    provider: str,
    request: ByokKeyRequest,
    session: SessionIdentity | None = Depends(get_current_user),
    user_id: str = "local_user",
):
    """Validate against the provider, then store the key encrypted."""
    resolved = _require_user(session, user_id)
    try:
        stored = byok.verify_and_store(
            resolved, provider, request.api_key, request.model
        )
    except byok.ByokError as error:
        admin_store.log_event(
            event_type="byok.key_rejected",
            severity="warning",
            user_id=resolved,
            detail={"provider": provider, "reason": error.code},
        )
        raise _to_http(error) from error
    finally:
        # Never let a credential sit in a traceback local longer than needed.
        request.api_key = ""

    admin_store.log_event(
        event_type="byok.key_saved",
        user_id=resolved,
        detail={"provider": stored["provider"]},
    )
    return ByokKeyResponse(
        provider=stored["provider"],
        model=stored["model"],
        hint=stored["hint"],
        verified=stored["verified"],
        message=f"{provider} key saved. Requests using this model now go straight to {provider}.",
    )


@router.delete(
    "/byok/{provider}",
    response_model=DeleteByokKeyResponse,
    dependencies=[Depends(byok_limiter())],
)
def delete_byok_key(
    provider: str,
    session: SessionIdentity | None = Depends(get_current_user),
    user_id: str = "local_user",
):
    resolved = _require_user(session, user_id)
    try:
        removed = byok.delete_key(resolved, provider)
    except byok.ByokError as error:
        raise _to_http(error) from error
    if not removed:
        raise HTTPException(status_code=404, detail={"error": "key_missing"})
    admin_store.log_event(
        event_type="byok.key_deleted", user_id=resolved, detail={"provider": provider}
    )
    return DeleteByokKeyResponse(provider=provider, deleted=True)


@router.post(
    "/byok/{provider}/test",
    response_model=ByokTestResponse,
    dependencies=[Depends(byok_limiter())],
)
def test_byok_key(
    provider: str,
    session: SessionIdentity | None = Depends(get_current_user),
    user_id: str = "local_user",
):
    resolved = _require_user(session, user_id)
    try:
        ok, message = byok.test_key(resolved, provider)
    except byok.ByokError as error:
        raise _to_http(error) from error
    return ByokTestResponse(provider=provider, ok=ok, message=crypto.redact(message))


# Exposed for the admin dashboard: whether this deployment has BYOK enabled.
def byok_status() -> dict:
    return {"enabled": NOOR_BYOK_ENABLED, "providers": list(byok.PROVIDERS)}


__all__ = ["router", "byok_status", "providers"]
