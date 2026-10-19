"""Reachability probe for Noor Gateway - shared by the scripts in this folder.

Deliberately mirrors the env vars (and defaults) of ``backend/app/settings.py``
without importing it, so it can run before the app imports anything, from any
working directory, inside a PowerShell preflight or CI step. Uses only the
stdlib.

    from gateway_probe import probe, require_gateway

    up, detail = probe()                      # (True, "GET .../health -> 200")
    require_gateway("verify_phase_a.py")      # clear fix + exit 2 when down

Exit code 2 is the "gateway is down, nothing could be tested" signal that
``verify_all.ps1`` turns into a non-fatal SKIP.
"""
from __future__ import annotations

import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://127.0.0.1:8080"
DEFAULT_API_KEY = "ngw_sk_dev"

START_HINT = (
    "  Start it in another terminal:\n"
    "    powershell -ExecutionPolicy Bypass -File scripts\\start_gateway.ps1\n"
    "  Or point Noor AI elsewhere with NOOR_GATEWAY_BASE_URL in .env.\n"
    "  Diagnose the wiring with:\n"
    "    .venv\\Scripts\\python.exe scripts\\check_gateway.py"
)


def base_url() -> str:
    return (os.getenv("NOOR_GATEWAY_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def api_key() -> str:
    return os.getenv("NOOR_GATEWAY_API_KEY") or DEFAULT_API_KEY


def auth_headers(extra: dict[str, str] | None = None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {api_key()}"}
    if extra:
        headers.update(extra)
    return headers


def probe(timeout: float = 2.0) -> tuple[bool, str]:
    """(up, detail) - up is True only when /health answers 200 over real HTTP."""
    url = f"{base_url()}/health"
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 - trusted local URL
            return response.status == 200, f"GET {url} -> {response.status}"
    except urllib.error.HTTPError as error:
        return False, f"GET {url} -> HTTP {error.code}"
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        return False, f"GET {url} -> {error}"


def require_gateway(script: str, timeout: float = 2.0) -> None:
    """Exit 2 with an actionable message when the gateway is not answering."""
    up, detail = probe(timeout=timeout)
    if up:
        return
    print(f"[{script}] {detail}", file=sys.stderr)
    print(f"Noor Gateway is not answering at {base_url()}.", file=sys.stderr)
    print(START_HINT, file=sys.stderr)
    raise SystemExit(2)
