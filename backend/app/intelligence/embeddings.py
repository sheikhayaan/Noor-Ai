"""Thin wrapper around Noor Gateway's POST /v1/debug/embed endpoint.

Noor AI never runs its own embedding model — consistent with the rule that all
model/infra concerns live in Noor Gateway. This module is the single place the
intelligence layer turns text into vectors, so if the embedding source changes
(local MiniLM vs a hosted API), nothing here or downstream needs to change.

Both a sync and an async variant are provided: the async one is used on the hot
path (parallel retrieval via asyncio.gather); the sync one is convenient for
background tasks and tests.
"""
from __future__ import annotations

import requests

from backend.app.settings import (
    NOOR_GATEWAY_API_KEY,
    NOOR_GATEWAY_BASE_URL,
    NOOR_GATEWAY_EMBED_TIMEOUT_SECONDS,
)

_EMBED_URL = f"{NOOR_GATEWAY_BASE_URL.rstrip('/')}/v1/debug/embed"
_HEADERS = {
    "Authorization": f"Bearer {NOOR_GATEWAY_API_KEY}",
    "Content-Type": "application/json",
}


class EmbeddingError(RuntimeError):
    """Raised when the gateway cannot produce an embedding."""


def _parse(payload: dict) -> list[float]:
    # Gateway envelope: { success: true, data: { embedding, dimensions, provider } }
    if not payload.get("success"):
        raise EmbeddingError(str(payload.get("error") or "embedding request failed"))
    vector = (payload.get("data") or {}).get("embedding")
    if not isinstance(vector, list) or not vector:
        raise EmbeddingError("gateway returned no embedding vector")
    return [float(x) for x in vector]


def embed_text_sync(text: str) -> list[float]:
    """Blocking embed — for background tasks and scripts."""
    try:
        response = requests.post(
            _EMBED_URL,
            json={"text": text},
            headers=_HEADERS,
            timeout=NOOR_GATEWAY_EMBED_TIMEOUT_SECONDS,
        )
    except requests.RequestException as error:
        raise EmbeddingError(f"cannot reach gateway embed endpoint: {error}") from error
    if response.status_code >= 400:
        raise EmbeddingError(f"gateway embed HTTP {response.status_code}: {response.text[:200]}")
    return _parse(response.json())


async def embed_text(text: str) -> list[float]:
    """Async embed — for the request hot path."""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=NOOR_GATEWAY_EMBED_TIMEOUT_SECONDS) as client:
            response = await client.post(_EMBED_URL, json={"text": text}, headers=_HEADERS)
    except httpx.HTTPError as error:
        raise EmbeddingError(f"cannot reach gateway embed endpoint: {error}") from error
    if response.status_code >= 400:
        raise EmbeddingError(f"gateway embed HTTP {response.status_code}: {response.text[:200]}")
    return _parse(response.json())
