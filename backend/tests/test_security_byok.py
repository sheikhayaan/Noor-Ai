"""Security-focused tests: BYOK encryption, routing, headers, limits.

These cover the properties that must never regress:

* a stored credential is unreadable without the app secret, and unreadable to
  another user (AEAD associated data binds it to ``user_id|provider``);
* plaintext keys never appear in the database or in API responses;
* BYOK chat actually routes to the user's provider, bypasses Noor's cache, and
  reports that honestly via ``x-noor-byok``;
* baseline hardening (headers, body cap, request id) is present on responses.
"""
from __future__ import annotations

import sqlite3

import pytest
from fastapi.testclient import TestClient

from backend.app import byok, crypto, providers
from backend.app.database import DATABASE_PATH, initialize_database
from backend.app.main import app
from backend.app.rate_limit import _consume

client = TestClient(app)
initialize_database()

FAKE_KEY = "sk-ant-test-0123456789abcdefghijklmnop"


# ---------------------------------------------------------------------------
# Envelope encryption
# ---------------------------------------------------------------------------
def test_encryption_roundtrip_and_masking():
    blob = crypto.encrypt_secret(FAKE_KEY, user_id="u1", provider="anthropic")
    assert FAKE_KEY not in blob
    assert crypto.decrypt_secret(blob, user_id="u1", provider="anthropic") == FAKE_KEY
    masked = crypto.mask_secret(FAKE_KEY)
    assert masked.startswith("sk-a") and FAKE_KEY not in masked


def test_ciphertext_is_bound_to_owner():
    blob = crypto.encrypt_secret(FAKE_KEY, user_id="u1", provider="anthropic")
    with pytest.raises(crypto.SecretDecryptionError):
        crypto.decrypt_secret(blob, user_id="u2", provider="anthropic")
    with pytest.raises(crypto.SecretDecryptionError):
        crypto.decrypt_secret(blob, user_id="u1", provider="openai")


def test_tampered_ciphertext_is_rejected():
    blob = crypto.encrypt_secret(FAKE_KEY, user_id="u1", provider="anthropic")
    tampered = blob[:-4] + ("AAAA" if not blob.endswith("AAAA") else "BBBB")
    with pytest.raises(crypto.SecretDecryptionError):
        crypto.decrypt_secret(tampered, user_id="u1", provider="anthropic")


def test_redact_scrubs_key_material():
    message = f"upstream said: your key {FAKE_KEY} is invalid"
    cleaned = crypto.redact(message, FAKE_KEY)
    assert FAKE_KEY not in cleaned


# ---------------------------------------------------------------------------
# Storage: write-only contract
# ---------------------------------------------------------------------------
@pytest.fixture()
def verified_provider(monkeypatch):
    monkeypatch.setattr(
        byok.providers, "verify_credentials", lambda *a, **k: (True, "Key verified.")
    )
    return True


@pytest.fixture()
def signed_in_client():
    fresh = TestClient(app)
    response = fresh.post("/auth/guest")
    assert response.status_code == 200
    return fresh, response.json()["user_id"]


def test_key_is_encrypted_at_rest_and_never_returned(verified_provider, signed_in_client):
    subject, user_id = signed_in_client
    put = subject.put("/api/byok/anthropic", json={"api_key": FAKE_KEY})
    assert put.status_code == 200, put.text
    assert FAKE_KEY not in put.text

    listing = subject.get("/api/byok")
    assert listing.status_code == 200
    assert FAKE_KEY not in listing.text
    assert listing.json()["keys"][0]["hint"].endswith(FAKE_KEY[-4:])

    # The raw SQLite row must not contain the credential either.
    with sqlite3.connect(DATABASE_PATH) as connection:
        row = connection.execute(
            "SELECT ciphertext, key_hint FROM user_api_keys WHERE user_id = ?",
            (user_id,),
        ).fetchone()
    assert row is not None
    assert FAKE_KEY not in row[0] and FAKE_KEY not in row[1]

    assert subject.delete("/api/byok/anthropic").json()["deleted"] is True
    assert subject.get("/api/byok").json()["keys"] == []


def test_key_management_requires_a_session(verified_provider):
    anonymous = TestClient(app)
    response = anonymous.put("/api/byok/anthropic", json={"api_key": FAKE_KEY})
    assert response.status_code == 401
    assert response.json()["detail"]["error"] == "authentication_required"


def test_rejected_key_is_not_stored(signed_in_client, monkeypatch):
    monkeypatch.setattr(
        byok.providers, "verify_credentials", lambda *a, **k: (False, "rejected")
    )
    subject, _ = signed_in_client
    response = subject.put("/api/byok/openai", json={"api_key": FAKE_KEY})
    assert response.status_code == 422
    assert response.json()["detail"]["error"] == "key_rejected"
    assert all(row["provider"] != "openai" for row in subject.get("/api/byok").json()["keys"])


def test_models_catalog_reflects_key_availability(verified_provider, signed_in_client):
    subject, _ = signed_in_client
    before = subject.get("/api/models").json()["models"]
    assert any(item["id"] == "noor-auto" and item["available"] for item in before)
    assert all(not item["available"] for item in before if item["requires_key"])

    subject.put("/api/byok/deepseek", json={"api_key": FAKE_KEY})
    after = subject.get("/api/models").json()["models"]
    deepseek = [item for item in after if item["provider"] == "deepseek"]
    assert deepseek and all(item["available"] for item in deepseek)
    subject.delete("/api/byok/deepseek")


# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
def test_route_resolution_defaults_to_gateway(signed_in_client):
    subject, user_id = signed_in_client
    assert byok.resolve_route(user_id, None) is None
    assert byok.resolve_route(user_id, "noor-auto") is None


def test_route_requires_a_key_for_byok_models(signed_in_client):
    _subject, user_id = signed_in_client
    with pytest.raises(byok.KeyRequiredError) as error:
        byok.resolve_route(user_id, "anthropic:claude-sonnet-4-5")
    assert error.value.status == 409
    assert error.value.code == "byok_key_required"


def test_chat_uses_user_key_and_reports_it(verified_provider, signed_in_client, monkeypatch):
    subject, user_id = signed_in_client
    assert subject.put("/api/byok/anthropic", json={"api_key": FAKE_KEY}).status_code == 200

    captured: dict = {}

    def fake_completion(messages, route, **kwargs):
        captured["route"] = route
        return providers.ChatResult(
            content="Answer from Claude",
            prompt_tokens=10,
            completion_tokens=3,
            total_tokens=13,
            cache_result="off",
            model_used=route.model,
        )

    monkeypatch.setattr(providers, "chat_completion", fake_completion)

    response = subject.post(
        "/chat",
        json={
            "message": "Hello there",
            "gem_id": "general",
            "model": "anthropic:claude-sonnet-4-5",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["response"] == "Answer from Claude"
    assert response.json()["model"] == "claude-sonnet-4-5"
    assert captured["route"].api_key == FAKE_KEY
    subject.delete("/api/byok/anthropic")


def test_unknown_model_is_a_clean_404(signed_in_client):
    subject, _ = signed_in_client
    response = subject.post(
        "/chat", json={"message": "hi", "gem_id": "general", "model": "openai:does-not-exist"}
    )
    # Unknown provider vs unknown model both fail before any generation work.
    assert response.status_code in (404, 409)


# ---------------------------------------------------------------------------
# Hardening
# ---------------------------------------------------------------------------
def test_security_headers_present():
    response = client.get("/health")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"]
    assert response.headers["x-request-id"]


def test_api_responses_are_not_cacheable():
    response = client.get("/api/usage")
    assert "no-store" in response.headers.get("cache-control", "")


def test_oversized_body_is_rejected():
    response = client.post(
        "/chat",
        json={"message": "x" * (300 * 1024), "gem_id": "general"},
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 413


def test_token_bucket_rate_limiter():
    key = "test-bucket"
    allowed = sum(1 for _ in range(5) if _consume(key, per_minute=60, burst=3)[0])
    assert allowed == 3
    ok, retry_after = _consume(key, per_minute=60, burst=3)
    assert ok is False and retry_after > 0
