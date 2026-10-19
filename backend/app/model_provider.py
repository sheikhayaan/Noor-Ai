import requests
from openai import OpenAI

from backend.app.crypto import redact
from backend.app.http_client import shared_session

from backend.app.settings import (
    MODEL_PROVIDER,
    NOOR_GATEWAY_API_KEY,
    NOOR_GATEWAY_BASE_URL,
    NOOR_GATEWAY_MODEL,
    NOOR_GATEWAY_TIMEOUT_SECONDS,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    OPENAI_TIMEOUT_SECONDS,
)


def generate_fake_response(message: str, gem: dict) -> str:
    gem_name = gem["name"]

    if gem_name == "Tutor Gem":
        return f"Let's learn this step by step: {message}"

    if gem_name == "Coding Gem":
        return f"Let's solve this like an engineer. Problem: {message}"

    if gem_name == "Content Creator Gem":
        return f"Let's turn this into engaging content: {message}"

    if gem_name == "Research Gem":
        return f"Let's analyze this carefully: {message}"

    if gem_name == "Image Prompt Gem":
        return f"Here's an image prompt direction for: {message}"

    if gem_name == "Business Gem":
        return f"Let's turn this into a business plan: {message}"

    return f"{gem_name} response: I received your message '{message}'."


def generate_openai_response(message: str, gem: dict) -> str:
    if not OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY is required when NOOR_MODEL_PROVIDER=openai")

    client = OpenAI(
        api_key=OPENAI_API_KEY,
        timeout=OPENAI_TIMEOUT_SECONDS,
    )

    try:
        completion = client.chat.completions.create(
            model=OPENAI_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": gem["system_prompt"],
                },
                {
                    "role": "user",
                    "content": message,
                },
            ],
        )
    except Exception as error:
        raise ValueError(f"OpenAI request failed: {error}") from error

    return completion.choices[0].message.content or ""


def _extract_gateway_error(response: "requests.Response") -> str:
    try:
        body = response.json()
    except ValueError:
        return (response.text or "").strip()[:200] or f"HTTP {response.status_code}"
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict):
            return error.get("message") or error.get("type") or str(error)
        if isinstance(error, str):
            return error
        if body.get("message"):
            return str(body["message"])
    return str(body)[:200]


def generate_gateway_response(message: str, gem: dict) -> str:
    """Route the request through Noor Gateway's OpenAI-compatible endpoint.

    Noor AI hands the gateway the gem's system prompt plus the user message and
    asks for the routing model (``noor-auto`` by default); the gateway selects
    the real model, applies caching, and returns an OpenAI-shaped completion.
    """
    url = f"{NOOR_GATEWAY_BASE_URL.rstrip('/')}/v1/chat/completions"
    payload = {
        "model": NOOR_GATEWAY_MODEL,
        "messages": [
            {"role": "system", "content": gem["system_prompt"]},
            {"role": "user", "content": message},
        ],
    }
    headers = {
        "Authorization": f"Bearer {NOOR_GATEWAY_API_KEY}",
        "Content-Type": "application/json",
    }

    try:
        # Pooled keep-alive connection: a fresh TLS handshake per chat turn was
        # costing ~100 ms and burning ephemeral ports under load.
        response = shared_session().post(
            url,
            json=payload,
            headers=headers,
            timeout=NOOR_GATEWAY_TIMEOUT_SECONDS,
        )
    except requests.exceptions.ConnectionError as error:
        raise ValueError(
            f"Cannot reach Noor Gateway at {NOOR_GATEWAY_BASE_URL}. Is it running?"
        ) from error
    except requests.exceptions.RequestException as error:
        raise ValueError(f"Noor Gateway request failed: {redact(str(error))}") from error

    if response.status_code >= 400:
        raise ValueError(
            f"Noor Gateway error ({response.status_code}): "
            f"{redact(_extract_gateway_error(response))}"
        )

    try:
        data = response.json()
        content = data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise ValueError(f"Noor Gateway returned an unexpected response: {error}") from error

    if not content:
        raise ValueError("Noor Gateway returned an empty response")

    return content


def generate_response(message: str, gem: dict) -> str:
    if MODEL_PROVIDER == "fake":
        return generate_fake_response(message, gem)

    if MODEL_PROVIDER == "gateway":
        return generate_gateway_response(message, gem)

    if MODEL_PROVIDER == "openai":
        return generate_openai_response(message, gem)

    raise ValueError(f"Unsupported model provider: {MODEL_PROVIDER}")


def get_model_metadata() -> dict:
    if MODEL_PROVIDER == "fake":
        return {
            "provider": "fake",
            "model": "fake-noor-v1",
        }

    # Routing is invisible to the user: expose the gateway, not the model it
    # ultimately selected downstream.
    if MODEL_PROVIDER == "gateway":
        return {
            "provider": "noor-gateway",
            "model": NOOR_GATEWAY_MODEL,
        }

    if MODEL_PROVIDER == "openai":
        return {
            "provider": "openai",
            "model": OPENAI_MODEL,
        }

    return {
        "provider": MODEL_PROVIDER,
        "model": "unknown",
    }