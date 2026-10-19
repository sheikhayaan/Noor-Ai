"""LIVE smoke test for Noor AI — boots a real uvicorn server on a real TCP port
and drives it with the `requests` HTTP client (real sockets, real cookie jar,
real headers). This closes the gap the offline verifier leaves: verify_auth.py
uses the in-process ASGI TestClient, whereas this proves the running server —
Set-Cookie handling, cross-request cookies, enforce/observe, IDOR, and the
enforce-exempt vitals endpoint — actually works over the wire.

    .venv\\Scripts\\python.exe scripts\\smoke_live.py

Hermetic: throwaway SQLite DB, fake model provider, intelligence off. Exits
non-zero on any failure.
"""
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

# Hermetic env — MUST be set before importing the app (settings reads at import).
os.environ["NOOR_INTELLIGENCE_ENABLED"] = "false"
os.environ["NOOR_MODEL_PROVIDER"] = "fake"
os.environ.setdefault("NOOR_SESSION_SECRET", "live-smoke-" + "s" * 48)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import backend.app.database as database  # noqa: E402

_tmp = tempfile.mkdtemp(prefix="noor_smoke_")
database.DATABASE_PATH = Path(_tmp) / "smoke.db"

import backend.app.auth as auth  # noqa: E402
import backend.app.main as main_mod  # noqa: E402
import requests  # noqa: E402
import uvicorn  # noqa: E402

# Deterministic, network-free generation.
main_mod.generate_response = lambda message, gem: "LIVE_TEST_ANSWER"
main_mod.get_model_metadata = lambda: {"provider": "test", "model": "test-model"}

HOST, PORT = "127.0.0.1", 8099
BASE = f"http://{HOST}:{PORT}"

_pass = 0
_fail = 0


def check(name, cond):
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  PASS  {name}")
    else:
        _fail += 1
        print(f"  FAIL  {name}")


def bearer(uid, provider="google"):
    return {"Authorization": f"Bearer {auth.sign_session(uid, provider)}"}


# --- boot a real server in a background thread ------------------------------
config = uvicorn.Config(main_mod.app, host=HOST, port=PORT, log_level="warning")
server = uvicorn.Server(config)
thread = threading.Thread(target=server.run, daemon=True)
thread.start()

# Wait until it actually answers over TCP.
_ready = False
for _ in range(100):
    try:
        if requests.get(f"{BASE}/health", timeout=1).status_code == 200:
            _ready = True
            break
    except requests.RequestException:
        time.sleep(0.1)
check("server boots and answers /health over real HTTP", _ready)
if not _ready:
    print("\nFAILURES PRESENT: server never came up")
    sys.exit(1)

try:
    # --- observe mode (enforce OFF) -----------------------------------------
    print("== LIVE: observe mode (enforce OFF) ==")
    auth.NOOR_AUTH_ENFORCE = False
    s = requests.Session()  # fresh cookie jar
    r = s.post(f"{BASE}/chat", json={"message": "hi", "gem_id": "general", "user_id": "liveLegacy"})
    check("legacy chat works with no session (200)", r.status_code == 200)
    conv = r.json().get("conversation_id") if r.ok else None
    lst = s.get(f"{BASE}/conversations", params={"user_id": "liveLegacy"})
    ids = [x["conversation_id"] for x in lst.json().get("conversations", [])] if lst.ok else []
    check("legacy user sees own conversation", conv is not None and conv in ids)
    me = s.get(f"{BASE}/auth/me").json()
    check("whoami: unauthenticated + enforce off", me["authenticated"] is False and me["enforce"] is False)

    # --- enforce mode (enforce ON) ------------------------------------------
    print("== LIVE: enforce mode (enforce ON) ==")
    auth.NOOR_AUTH_ENFORCE = True
    anon = requests.Session()
    r = anon.post(f"{BASE}/chat", json={"message": "hi", "gem_id": "general", "user_id": "liveLegacy"})
    check("no session -> 401", r.status_code == 401)

    guest = requests.Session()
    g = guest.post(f"{BASE}/auth/guest")
    guest_id = g.json().get("user_id", "")
    check("guest session issued + Set-Cookie honored by client",
          guest_id.startswith("guest:") and bool(guest.cookies.get("noor_session")))
    me = guest.get(f"{BASE}/auth/me").json()
    check("whoami: authenticated guest", me["authenticated"] is True and me["is_guest"] is True)

    # Forged body user_id must be ignored — the conversation is owned by the guest.
    r = guest.post(f"{BASE}/chat", json={"message": "hi", "gem_id": "general", "user_id": "attacker"})
    check("guest chat works with cookie (200)", r.status_code == 200)
    gconv = r.json().get("conversation_id") if r.ok else None
    owned = guest.get(f"{BASE}/conversations").json().get("conversations", [])
    check("conversation owned by guest id, not forged 'attacker'",
          any(x["conversation_id"] == gconv and x["user_id"] == guest_id for x in owned))

    # IDOR over the wire: alice creates a conv (Bearer); bob may not read it.
    ra = requests.post(f"{BASE}/chat", headers=bearer("google:liveAlice"),
                       json={"message": "secret", "gem_id": "general", "user_id": "google:bob"})
    check("alice (bearer) chat ok", ra.status_code == 200)
    aconv = ra.json().get("conversation_id") if ra.ok else None
    check("owner reads own messages",
          requests.get(f"{BASE}/conversations/{aconv}/messages",
                       headers=bearer("google:liveAlice")).status_code == 200)
    rb = requests.get(f"{BASE}/conversations/{aconv}/messages", headers=bearer("google:bob"),
                      params={"user_id": "google:liveAlice"})
    check("IDOR blocked (read): non-owner -> 404", rb.status_code == 404)
    rd = requests.delete(f"{BASE}/conversations/{aconv}", headers=bearer("google:bob"))
    check("IDOR blocked (delete): non-owner -> 404", rd.status_code == 404)

    # --- vitals: unauthenticated + enforce-exempt, live ---------------------
    print("== LIVE: Core Web Vitals (enforce still ON) ==")
    v = requests.post(f"{BASE}/api/vitals", json={"name": "LCP", "value": 1234.0, "rating": "good", "path": "/"})
    check("vitals accepts anonymous report under enforce (200)", v.status_code == 200 and v.json().get("ok") is True)
    vs = requests.get(f"{BASE}/api/vitals")
    names = {m["name"] for m in vs.json().get("metrics", [])} if vs.ok else set()
    check("vitals summary lists LCP", vs.status_code == 200 and "LCP" in names)
finally:
    server.should_exit = True
    thread.join(timeout=5)

print(f"\n{'ALL PASS' if _fail == 0 else 'FAILURES PRESENT'}: {_pass} passed, {_fail} failed")
sys.exit(0 if _fail == 0 else 1)
