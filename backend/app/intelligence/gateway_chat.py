"""Rich Noor Gateway client for the intelligence layer.

``model_provider.generate_gateway_response`` only handles the simple
``(message, gem) -> str`` product path. The intelligence layer needs more:
send a full ``messages`` array (for memory extraction, context compression, and
the final assembled prompt), and read back token usage + the ``x-noor-*``
response headers so savings can be measured honestly.

Everything here is synchronous (``requests``), matching ``model_provider`` and
the "synchronous first, SSE later" build decision. All model/caching concerns
still live in the gateway — this module only speaks its OpenAI-compatible wire
protocol.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import requests

from backend.app import providers
from backend.app.crypto import redact
from backend.app.http_client import shared_session
from backend.app.settings import (
    NOOR_GATEWAY_API_KEY,
    NOOR_GATEWAY_BASE_URL,
    NOOR_GATEWAY_MODEL,
    NOOR_GATEWAY_TIMEOUT_SECONDS,
)

_BASE = NOOR_GATEWAY_BASE_URL.rstrip("/")
_CHAT_URL = f"{_BASE}/v1/chat/completions"
_CACHE_TEST_URL = f"{_BASE}/v1/cache/semantic/test"
_HEADERS = {
    "Authorization": f"Bearer {NOOR_GATEWAY_API_KEY}",
    "Content-Type": "application/json",
}


class GatewayError(RuntimeError):
    """Raised when the gateway is unreachable or returns an error.

    ``status`` carries the HTTP status a route should return (401 for a rejected
    BYOK key, 429 for a provider rate limit, 502/504 otherwise).
    """

    def __init__(self, message: str, *, status: int = 502):
        super().__init__(message)
        self.status = status


# The result type is shared with the direct (BYOK) provider adapters so the
# handler and savings math work identically for both routes.
ChatResult = providers.ChatResult


@dataclass
class CacheLookupResult:
    hit: bool
    similarity: float
    cached_response: Optional[str] = None


def _estimate_tokens_from_messages(messages: list[dict]) -> int:
    """~1 token / 4 chars fallback when the gateway omits a usage object."""
    chars = sum(len(str(m.get("content") or "")) for m in messages)
    return max(1, chars // 4)


def chat(
    messages: list[dict],
    *,
    model: Optional[str] = None,
    temperature: Optional[float] = None,
    timeout: Optional[float] = None,
) -> ChatResult:
    """Send a messages array to the gateway and return content + metadata.

    Raises ``GatewayError`` on transport/HTTP/shape failures so callers can
    decide whether the failure is fatal (final answer) or swallowable
    (best-effort extraction / compression).

    If a BYOK route is active for this request (see ``providers.use_route``),
    the call goes straight to the user's provider with the user's key — no
    gateway hop and no shared cache — so *every* internal LLM call (memory
    extraction, compression, the final answer) honors their credential.
    """
    route = providers.current_route()
    if route is not None:
        try:
            return providers.chat_completion(
                messages,
                route,
                timeout=timeout,
                temperature=temperature,
            )
        except providers.ProviderError as error:
            raise GatewayError(str(error), status=error.status) from error

    payload: dict[str, Any] = {
        "model": model or NOOR_GATEWAY_MODEL,
        "messages": messages,
    }
    if temperature is not None:
        payload["temperature"] = temperature

    try:
        response = shared_session().post(
            _CHAT_URL,
            json=payload,
            headers=_HEADERS,
            timeout=timeout or NOOR_GATEWAY_TIMEOUT_SECONDS,
        )
    except requests.exceptions.ConnectionError as error:
        raise GatewayError(
            f"Cannot reach Noor Gateway at {NOOR_GATEWAY_BASE_URL}. Is it running?"
        ) from error
    except requests.exceptions.RequestException as error:
        raise GatewayError(f"Noor Gateway request failed: {redact(str(error))}") from error

    if response.status_code >= 400:
        raise GatewayError(
            f"Noor Gateway error ({response.status_code}): "
            f"{redact(response.text[:200])}"
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"] or ""
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise GatewayError(f"Noor Gateway returned an unexpected response: {error}") from error

    usage = data.get("usage") or {}
    has_usage = bool(usage) and usage.get("total_tokens") is not None
    if has_usage:
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
        total_tokens = int(usage.get("total_tokens") or (prompt_tokens + completion_tokens))
    else:
        # Gateway/provider did not report usage — estimate from characters so
        # downstream savings math still has a number to work with (flagged).
        prompt_tokens = _estimate_tokens_from_messages(messages)
        completion_tokens = _estimate_tokens_from_messages(
            [{"content": content}]
        )
        total_tokens = prompt_tokens + completion_tokens

    return ChatResult(
        content=content,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens,
        cache_result=response.headers.get("x-noor-cache-result", ""),
        model_used=response.headers.get("x-noor-model-used", payload["model"]),
        usage_estimated=not has_usage,
        raw=data if isinstance(data, dict) else {},
    )


def cache_lookup(
    text: str,
    *,
    model: Optional[str] = None,
    namespace: str = "default",
    threshold: Optional[float] = None,
) -> CacheLookupResult:
    """Pure semantic-cache probe via POST /v1/cache/semantic/test — no generation.

    The gateway has no ``/v1/cache/semantic/lookup`` (the spec's name); its
    ``/test`` endpoint is the read-only probe. Returns a safe miss on any
    failure — a cache probe must never break a chat request.
    """
    payload: dict[str, Any] = {"text": text, "model": model or NOOR_GATEWAY_MODEL, "namespace": namespace}
    if threshold is not None:
        payload["threshold"] = threshold
    try:
        response = shared_session().post(
            _CACHE_TEST_URL, json=payload, headers=_HEADERS, timeout=NOOR_GATEWAY_TIMEOUT_SECONDS
        )
        if response.status_code >= 400:
            return CacheLookupResult(hit=False, similarity=0.0)
        # Envelope: { success: true, data: { hit, similarity, entry, ... } }
        data = (response.json() or {}).get("data") or {}
    except (requests.RequestException, ValueError):
        return CacheLookupResult(hit=False, similarity=0.0)

    entry = data.get("entry") or {}
    cached = None
    if isinstance(entry, dict):
        # Different gateway versions nest the cached completion differently.
        cached = entry.get("response") or entry.get("content") or entry.get("completion")
    return CacheLookupResult(
        hit=bool(data.get("hit")),
        similarity=float(data.get("similarity") or 0.0),
        cached_response=cached,
    )
