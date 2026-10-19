"""Doctor for the Noor AI <-> Noor Gateway wiring.

Answers one question: is this repo really connected to the gateway, end to end?

    .venv\\Scripts\\python.exe scripts\\check_gateway.py
    .venv\\Scripts\\python.exe scripts\\check_gateway.py --chat
    .venv\\Scripts\\python.exe scripts\\check_gateway.py --gateway-dir "D:\\code\\noor gateway"

Checks, in order:
  1. config      - provider=gateway, base URL / key / model as loaded by settings
  2. cross-repo  - gateway repo's GATEWAY_PORT / NOOR_DEV_API_KEY match ours
  3. liveness    - GET /health
  4. auth        - GET /v1/models with the key (and 401 without it)
  5. cache       - GET /v1/cache/health (what the admin dashboard proxies)
  6. embeddings  - POST /v1/debug/embed, dimensions match the Qdrant collections
  7. chat        - (--chat) real completion through model_provider + the rich
                   intelligence client (model routing, cache result, tokens)

Exit codes: 0 all green, 1 a check failed, 2 gateway unreachable (nothing to test).
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

# Gateway replies are printed below and may contain characters the Windows console
# code page cannot encode - never let a print() fail the doctor.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

import requests  # noqa: E402

import gateway_probe  # noqa: E402
from backend.app.settings import (  # noqa: E402
    EMBEDDING_DIMENSIONS,
    MODEL_PROVIDER,
    NOOR_GATEWAY_API_KEY,
    NOOR_GATEWAY_BASE_URL,
    NOOR_GATEWAY_MODEL,
)

_pass = 0
_fail = 0
_skip = 0
_failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> bool:
    global _pass, _fail
    if ok:
        _pass += 1
        print(f"  PASS  {name}" + (f"   [{detail}]" if detail else ""))
    else:
        _fail += 1
        _failures.append(name)
        print(f"  FAIL  {name}" + (f"   [{detail}]" if detail else ""))
    return ok


def skip(name: str, why: str) -> None:
    global _skip
    _skip += 1
    print(f"  SKIP  {name}   [{why}]")


def section(title: str) -> None:
    print(f"\n== {title} ==")


def get(url: str, headers: dict | None = None, timeout: float = 5.0):
    return requests.get(url, headers=headers or gateway_probe.auth_headers(), timeout=timeout)


def read_gateway_env(gateway_dir: Path) -> dict[str, str]:
    """Parse the gateway repo's .env (KEY=VALUE, '#' comments) - no dotenv needed."""
    env_file = gateway_dir / ".env"
    if not env_file.is_file():
        return {}
    values: dict[str, str] = {}
    for line in env_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, raw = line.partition("=")
        values[key.strip()] = raw.split("#", 1)[0].strip().strip('"').strip("'")
    return values


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify the Noor AI <-> Noor Gateway wiring.")
    parser.add_argument(
        "--gateway-dir",
        default=None,
        help="Path to the Noor Gateway checkout, to cross-check its port/key env.",
    )
    parser.add_argument(
        "--chat",
        action="store_true",
        help="Also run a real completion through the gateway (model_provider + intelligence client).",
    )
    args = parser.parse_args()

    base = NOOR_GATEWAY_BASE_URL.rstrip("/")

    print("Noor AI -> Noor Gateway doctor")
    print(f"  repo           : {ROOT}")

    # -- 1. config ----------------------------------------------------------
    section("1) Configuration (backend/app/settings.py)")
    check("NOOR_MODEL_PROVIDER is 'gateway'", MODEL_PROVIDER == "gateway",
          f"NOOR_MODEL_PROVIDER={MODEL_PROVIDER}"
          + ("" if MODEL_PROVIDER == "gateway" else " (set it to gateway in .env)"))
    check("gateway base URL configured", bool(base), base)
    check("gateway API key configured", bool(NOOR_GATEWAY_API_KEY),
          "set" if NOOR_GATEWAY_API_KEY else "missing")
    print(f"        model          = {NOOR_GATEWAY_MODEL}")
    print(f"        embedding dims = {EMBEDDING_DIMENSIONS}")

    # -- 2. cross-repo port/key --------------------------------------------
    section("2) Cross-repo agreement (gateway .env)")
    raw_dir = args.gateway_dir or os.getenv("NOOR_GATEWAY_DIR", "")
    gateway_dir = Path(raw_dir) if raw_dir else None
    if gateway_dir is None:
        skip("gateway repo .env cross-check", "pass --gateway-dir to enable")
    elif not gateway_dir.is_dir():
        check("gateway repo directory exists", False, str(gateway_dir))
    else:
        env = read_gateway_env(gateway_dir)
        if not env:
            skip("gateway repo .env cross-check", f"no .env in {gateway_dir}")
        else:
            port = env.get("GATEWAY_PORT", "8080")
            check("gateway GATEWAY_PORT matches our base URL port",
                  f":{port}" in base, f"gateway :{port} vs ours {base}")
            gw_key = env.get("NOOR_DEV_API_KEY", "")
            check("gateway NOOR_DEV_API_KEY matches NOOR_GATEWAY_API_KEY",
                  gw_key == NOOR_GATEWAY_API_KEY,
                  "match" if gw_key == NOOR_GATEWAY_API_KEY else f"gateway={gw_key!r} vs ours={NOOR_GATEWAY_API_KEY!r}")
            if env.get("ALLOW_MOCK_PROVIDERS", "true").lower() == "true":
                print("        note: ALLOW_MOCK_PROVIDERS=true (missing provider keys fall back to mocks)")

    # -- 3. liveness --------------------------------------------------------
    section("3) Liveness")
    up, detail = gateway_probe.probe(timeout=3)
    if not check("GET /health answers 200", up, detail):
        print(f"\nNoor Gateway is not answering at {base} - is it running?")
        print(gateway_probe.START_HINT.replace("  ", "", 1))
        print(f"\nResult: 1 unreachable service, {_pass} checks passed before it.")
        return 2

    # -- 4. auth ------------------------------------------------------------
    section("4) API-key authentication")
    try:
        r = get(f"{base}/v1/models")
    except requests.RequestException as error:
        check("GET /v1/models reachable", False, type(error).__name__)
        r = None
    if r is not None:
        ok = check("GET /v1/models with key -> 200", r.status_code == 200, str(r.status_code))
        if ok:
            try:
                models = [m.get("id") for m in (r.json().get("data") or [])]
            except ValueError:
                models = []
            check("gateway advertises at least one model", bool(models), ", ".join(map(str, models[:6])))
            # "noor-auto" (and any *-auto) is a ROUTING ALIAS resolved inside
            # /v1/chat/completions - it never appears in the /v1/models catalog,
            # so only a concrete model id can be validated against the list.
            alias = NOOR_GATEWAY_MODEL.endswith("-auto") or NOOR_GATEWAY_MODEL in ("auto", "")
            check("requested model is routable by the gateway",
                  alias or NOOR_GATEWAY_MODEL in models,
                  f"{NOOR_GATEWAY_MODEL} = auto-routing alias (gateway picks the model)"
                  if alias else NOOR_GATEWAY_MODEL)
    try:
        anon = requests.get(f"{base}/v1/models", timeout=5)
        check("request without a key -> 401 (auth enforced)", anon.status_code == 401, str(anon.status_code))
    except requests.RequestException as error:
        check("request without a key -> 401 (auth enforced)", False, type(error).__name__)

    # -- 5. cache health ----------------------------------------------------
    section("5) Cache health (backs the admin dashboard)")
    try:
        r = get(f"{base}/v1/cache/health")
        ok = check("GET /v1/cache/health -> 200", r.status_code == 200, str(r.status_code))
        if ok:
            body = r.json()
            data = body.get("data", body) if isinstance(body, dict) else body
            check("health report is an object", isinstance(data, dict), type(data).__name__)
    except (requests.RequestException, ValueError) as error:
        check("GET /v1/cache/health -> 200", False, type(error).__name__)

    # -- 6. embeddings ------------------------------------------------------
    section("6) Embeddings (POST /v1/debug/embed)")
    try:
        r = requests.post(f"{base}/v1/debug/embed", json={"text": "noor gateway wiring check"},
                          headers=gateway_probe.auth_headers({"Content-Type": "application/json"}), timeout=90)
        if check("POST /v1/debug/embed -> 200", r.status_code == 200, str(r.status_code)):
            payload = r.json()
            vector = (payload.get("data") or {}).get("embedding") if payload.get("success") else None
            check("response carries an embedding vector", isinstance(vector, list) and bool(vector),
                  f"{len(vector) if isinstance(vector, list) else 0} dims")
            check("dimensions match NOOR_EMBEDDING_DIMENSIONS (Qdrant collections)",
                  isinstance(vector, list) and len(vector) == EMBEDDING_DIMENSIONS,
                  f"gateway={len(vector) if isinstance(vector, list) else '?'} vs configured={EMBEDDING_DIMENSIONS}")
    except (requests.RequestException, ValueError) as error:
        check("POST /v1/debug/embed -> 200", False, type(error).__name__)

    # -- 7. real chat -------------------------------------------------------
    section("7) Chat round-trip")
    if not args.chat:
        skip("real completion through the gateway", "pass --chat to spend a request")
    else:
        from backend.app import model_provider  # imported late: only --chat needs it

        try:
            reply = model_provider.generate_response(
                "Reply with exactly the word PONG.",
                {"name": "doctor", "system_prompt": "You are a terse test assistant."},
            )
            check("model_provider.generate_response returns text", bool(reply.strip()), reply.strip()[:60])
        except Exception as error:  # noqa: BLE001 - report any failure, don't crash the doctor
            check("model_provider.generate_response returns text", False, f"{type(error).__name__}: {error}")

        from backend.app.intelligence import gateway_chat

        try:
            result = gateway_chat.chat([{"role": "user", "content": "Reply with exactly the word PONG."}])
            check("intelligence client returns content", bool(result.content.strip()), result.content.strip()[:60])
            print(f"        routed model={result.model_used} cache={result.cache_result or '-'} "
                  f"tokens={result.total_tokens}")
        except gateway_chat.GatewayError as error:
            check("intelligence client returns content", False, str(error)[:120])

    # -- summary ------------------------------------------------------------
    print("\n" + "=" * 68)
    if _fail == 0:
        print(f"WIRED AND HEALTHY - {_pass} checks passed"
              + (f", {_skip} skipped." if _skip else "."))
        return 0
    print(f"WIRING ISSUES - {_fail} failed, {_pass} passed, {_skip} skipped:")
    for name in _failures:
        print(f"  - {name}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
