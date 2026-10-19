"""Direct provider adapters for Bring-Your-Own-Key (BYOK) chat.

Noor Gateway remains the default route (Noor pays, semantic cache applies).
When a user has stored their own key, requests are sent **straight to that
provider** with that key — no gateway hop, no shared cache, and the user's
credential never leaves the process boundary except towards its own vendor.

Supported wire protocols
------------------------
* ``openai``    — OpenAI, Groq, DeepSeek, OpenRouter, Mistral, Together, xAI…
                  (anything OpenAI-compatible: ``POST {base}/chat/completions``)
* ``anthropic`` — ``POST {base}/v1/messages`` (``x-api-key`` + version header)
* ``google``    — ``POST {base}/v1beta/models/{model}:generateContent``

Everything is synchronous (matching the rest of the backend) and goes through
the pooled :mod:`backend.app.http_client` session.

A ``ContextVar`` carries the active user route, so *every* internal LLM call
(memory extraction, history compression, the final answer) automatically uses
the user's key for the duration of that request — their content never needs to
fall back to Noor's infrastructure just because it happens off the hot path.
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator, Optional

import requests

from backend.app.crypto import redact
from backend.app.http_client import shared_session
from backend.app.settings import NOOR_GATEWAY_TIMEOUT_SECONDS

_MODEL_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@\-]{0,79}$")
_ANTHROPIC_VERSION = "2023-06-01"
_MESSAGE_CHAR_BUDGET = 120_000  # hard stop before we post something absurd


class GenerationError(RuntimeError):
    """Fatal generation failure surfaced to the route layer with an HTTP status."""

    def __init__(self, message: str, *, status: int = 502):
        super().__init__(message)
        self.status = status


class ProviderError(RuntimeError):
    """A provider call failed. Messages are safe to surface to the client."""

    def __init__(self, message: str, *, status: int = 502, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


@dataclass(frozen=True)
class Route:
    """Where one request should go. ``api_key`` is never serialised/logged."""

    provider: str
    kind: str                 # openai | anthropic | google
    base_url: str
    model: str
    label: str = ""
    api_key: Optional[str] = field(default=None, repr=False)

    @property
    def is_byok(self) -> bool:
        return self.api_key is not None

    def public(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "model": self.model,
            "label": self.label or self.model,
            "byok": self.is_byok,
        }


@dataclass
class ChatResult:
    """One completion plus the metadata the savings math needs."""

    content: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    cache_result: str = ""      # "hit" | "miss" | "" (absent)
    model_used: str = ""
    usage_estimated: bool = False
    raw: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def cache_hit(self) -> bool:
        return self.cache_result.lower() == "hit"


# ---------------------------------------------------------------------------
# Active route (per request, thread/async-safe)
# ---------------------------------------------------------------------------
_route_var: ContextVar[Optional[Route]] = ContextVar("noor_active_route", default=None)


def current_route() -> Optional[Route]:
    return _route_var.get()


@contextmanager
def use_route(route: Optional[Route]) -> Iterator[None]:
    """Bind ``route`` for this request; internal LLM calls inherit it."""
    token = _route_var.set(route)
    try:
        yield
    finally:
        _route_var.reset(token)


def validate_model_id(model: str) -> str:
    """Reject anything that could smuggle a path/query into a provider URL."""
    candidate = (model or "").strip()
    if not _MODEL_ID_RE.match(candidate):
        raise ProviderError("Invalid model id.", status=422)
    return candidate


def _estimate_tokens(text: str) -> int:
    return max(1, len(text or "") // 4)


def _estimate_from_messages(messages: list[dict]) -> int:
    return max(1, sum(len(str(m.get("content") or "")) for m in messages) // 4)


def _safe_json(response: requests.Response) -> dict:
    try:
        data = response.json()
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def _error_message(response: requests.Response, api_key: Optional[str]) -> str:
    body = _safe_json(response)
    detail = ""
    error = body.get("error")
    if isinstance(error, dict):
        detail = str(error.get("message") or error.get("type") or "")
    elif isinstance(error, str):
        detail = error
    if not detail:
        detail = str(body.get("message") or "").strip()
    if not detail:
        detail = (response.text or "").strip()[:200]
    detail = redact(detail[:300], api_key)
    return detail or f"HTTP {response.status_code}"


def _chat_url(route: Route) -> str:
    base = route.base_url.rstrip("/")
    if route.kind == "openai":
        return f"{base}/chat/completions"
    if route.kind == "anthropic":
        return f"{base}/v1/messages"
    return f"{base}/v1beta/models/{route.model}:generateContent"


def _headers(route: Route) -> dict[str, str]:
    if route.kind == "openai":
        return {
            "Authorization": f"Bearer {route.api_key}",
            "Content-Type": "application/json",
        }
    if route.kind == "anthropic":
        return {
            "x-api-key": route.api_key or "",
            "anthropic-version": _ANTHROPIC_VERSION,
            "Content-Type": "application/json",
        }
    return {"Content-Type": "application/json"}


def _split_system(messages: list[dict]) -> tuple[str, list[dict]]:
    system_parts = [str(m.get("content") or "") for m in messages if m.get("role") == "system"]
    rest = [m for m in messages if m.get("role") != "system"]
    return "\n\n".join(part for part in system_parts if part), rest


def _merge_roles(messages: list[dict], *, assistant_role: str) -> list[dict]:
    """Collapse consecutive same-role turns (Anthropic/Gemini require alternation)."""
    merged: list[dict] = []
    for message in messages:
        role = assistant_role if message.get("role") == "assistant" else "user"
        content = str(message.get("content") or "")
        if not content:
            continue
        if merged and merged[-1]["role"] == role:
            merged[-1]["content"] = f"{merged[-1]['content']}\n\n{content}"
        else:
            merged.append({"role": role, "content": content})
    while merged and merged[0]["role"] != "user":
        merged.pop(0)
    return merged


def _openai_body(route: Route, messages: list[dict], temperature: Optional[float], max_tokens: Optional[int]) -> dict:
    body: dict[str, Any] = {
        "model": route.model,
        "messages": [
            {"role": m.get("role", "user"), "content": str(m.get("content") or "")} for m in messages
        ],
    }
    if temperature is not None:
        body["temperature"] = float(temperature)
    if max_tokens:
        body["max_tokens"] = int(max_tokens)
    return body


def _anthropic_body(route: Route, messages: list[dict], temperature: Optional[float], max_tokens: Optional[int]) -> dict:
    system, rest = _split_system(messages)
    body: dict[str, Any] = {
        "model": route.model,
        # Anthropic requires max_tokens; 4096 is a sane answer ceiling.
        "max_tokens": int(max_tokens or 4096),
        "messages": [
            {"role": m["role"], "content": m["content"]}
            for m in _merge_roles(rest, assistant_role="assistant")
        ],
    }
    if system:
        body["system"] = system
    if temperature is not None:
        body["temperature"] = float(temperature)
    return body


def _google_body(route: Route, messages: list[dict], temperature: Optional[float], max_tokens: Optional[int]) -> dict:
    system, rest = _split_system(messages)
    body: dict[str, Any] = {
        "contents": [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
            for m in _merge_roles(rest, assistant_role="assistant")
        ]
    }
    if system:
        body["systemInstruction"] = {"parts": [{"text": system}]}
    generation: dict[str, Any] = {}
    if temperature is not None:
        generation["temperature"] = float(temperature)
    if max_tokens:
        generation["maxOutputTokens"] = int(max_tokens)
    if generation:
        body["generationConfig"] = generation
    return body


def _openai_result(route: Route, data: dict, messages: list[dict]) -> ChatResult:
    choices = data.get("choices") or []
    content = ""
    if choices and isinstance(choices[0], dict):
        content = str((choices[0].get("message") or {}).get("content") or "")
    usage = data.get("usage") or {}
    hit = bool(usage.get("total_tokens") is not None)
    prompt_tokens = int(usage.get("prompt_tokens") or 0) if hit else _estimate_from_messages(messages)
    completion_tokens = int(usage.get("completion_tokens") or 0) if hit else _estimate_tokens(content)
    return ChatResult(
        content=content,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=int(usage.get("total_tokens") or prompt_tokens + completion_tokens),
        cache_result="off",
        model_used=str(data.get("model") or route.model),
        usage_estimated=not hit,
        raw=data,
    )


def _anthropic_result(route: Route, data: dict, messages: list[dict]) -> ChatResult:
    blocks = data.get("content") or []
    content = "".join(
        str(block.get("text") or "") for block in blocks if isinstance(block, dict)
    ).strip()
    usage = data.get("usage") or {}
    hit = bool(usage)
    prompt_tokens = int(usage.get("input_tokens") or 0) if hit else _estimate_from_messages(messages)
    completion_tokens = int(usage.get("output_tokens") or 0) if hit else _estimate_tokens(content)
    return ChatResult(
        content=content,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
        cache_result="off",
        model_used=str(data.get("model") or route.model),
        usage_estimated=not hit,
        raw=data,
    )


def _google_result(route: Route, data: dict, messages: list[dict]) -> ChatResult:
    candidates = data.get("candidates") or []
    content = ""
    if candidates and isinstance(candidates[0], dict):
        parts = ((candidates[0].get("content") or {}).get("parts")) or []
        content = "".join(str(p.get("text") or "") for p in parts if isinstance(p, dict)).strip()
    usage = data.get("usageMetadata") or {}
    hit = bool(usage)
    prompt_tokens = int(usage.get("promptTokenCount") or 0) if hit else _estimate_from_messages(messages)
    completion_tokens = int(usage.get("candidatesTokenCount") or 0) if hit else _estimate_tokens(content)
    return ChatResult(
        content=content,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=int(usage.get("totalTokenCount") or prompt_tokens + completion_tokens),
        cache_result="off",
        model_used=route.model,
        usage_estimated=not hit,
        raw=data,
    )


def chat_completion(
    messages: list[dict],
    route: Route,
    *,
    timeout: Optional[float] = None,
    temperature: Optional[float] = None,
    max_tokens: Optional[int] = None,
) -> ChatResult:
    """Call ``route``'s provider directly and return content + usage."""
    if not route.api_key:
        raise ProviderError("No credential supplied for this provider.", status=400)
    validate_model_id(route.model)

    chars = sum(len(str(m.get("content") or "")) for m in messages)
    if chars > _MESSAGE_CHAR_BUDGET:
        raise ProviderError("Conversation too large for a single request.", status=413)

    builders = {
        "openai": _openai_body,
        "anthropic": _anthropic_body,
        "google": _google_body,
    }
    parsers = {
        "openai": _openai_result,
        "anthropic": _anthropic_result,
        "google": _google_result,
    }
    if route.kind not in builders:
        raise ProviderError(f"Unsupported provider protocol: {route.kind}", status=400)

    body = builders[route.kind](route, messages, temperature, max_tokens)
    url = _chat_url(route)
    headers = _headers(route)
    params = {"key": route.api_key} if route.kind == "google" else None

    try:
        response = shared_session().post(
            url,
            json=body,
            headers=headers,
            params=params,
            timeout=timeout or NOOR_GATEWAY_TIMEOUT_SECONDS,
        )
    except requests.exceptions.Timeout as error:
        raise ProviderError("The provider timed out. Please retry.", status=504, retryable=True) from error
    except requests.exceptions.RequestException as error:
        raise ProviderError(
            f"Could not reach {route.provider}: {redact(str(error), route.api_key)}",
            status=502,
            retryable=True,
        ) from error

    if response.status_code >= 400:
        status = response.status_code
        # Never leak a provider's 401 verbatim: it can echo key fragments.
        if status in (401, 403):
            raise ProviderError(
                f"{route.provider} rejected the API key. Check it in Settings → API keys.",
                status=401,
            )
        if status == 429:
            raise ProviderError(
                f"{route.provider} rate limit hit. Retry shortly or switch models.",
                status=429,
                retryable=True,
            )
        raise ProviderError(
            f"{route.provider} error ({status}): {_error_message(response, route.api_key)}",
            status=502,
            retryable=status >= 500,
        )

    data = _safe_json(response)
    if not data:
        raise ProviderError(f"{route.provider} returned an unreadable response.", status=502)

    result = parsers[route.kind](route, data, messages)
    if not result.content:
        raise ProviderError(f"{route.provider} returned an empty response.", status=502, retryable=True)
    return result


# ---------------------------------------------------------------------------
# Credential verification (used before/while storing a BYOK key)
# ---------------------------------------------------------------------------
_PROBE_TIMEOUT = 12.0


def verify_credentials(kind: str, base_url: str, api_key: str, provider: str) -> tuple[bool, str]:
    """Cheaply prove a key works: list models, don't burn tokens.

    Returns ``(ok, human_message)``; the message never contains the key.
    """
    base = base_url.rstrip("/")
    try:
        if kind == "openai":
            response = shared_session().get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {api_key}"},
                timeout=_PROBE_TIMEOUT,
            )
        elif kind == "anthropic":
            response = shared_session().get(
                f"{base}/v1/models",
                headers={"x-api-key": api_key, "anthropic-version": _ANTHROPIC_VERSION},
                timeout=_PROBE_TIMEOUT,
            )
        elif kind == "google":
            response = shared_session().get(
                f"{base}/v1beta/models",
                params={"key": api_key},
                timeout=_PROBE_TIMEOUT,
            )
        else:
            return False, f"Provider '{provider}' is not supported."
    except requests.exceptions.RequestException as error:
        return False, f"Could not reach {provider}: {redact(str(error), api_key)}"

    if response.status_code in (401, 403):
        return False, f"{provider} rejected this key (invalid, revoked, or wrong project)."
    if response.status_code == 429:
        # Rate limited ≠ invalid: accept it, the key authenticated.
        return True, f"Key accepted by {provider} (currently rate limited)."
    if response.status_code >= 400:
        return False, f"{provider} error ({response.status_code}): {_error_message(response, api_key)}"
    return True, f"Key verified with {provider}."
