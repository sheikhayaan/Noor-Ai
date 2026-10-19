"""Offline verification for Noor AI Phase 4 (auth / identity binding), Phase 5
(per-user concurrency + daily usage limits), and Phase 6 (Core Web Vitals
telemetry).

Runs against the real FastAPI app via Starlette's TestClient, but with a
throwaway SQLite DB and network-free generation, so it proves the wiring without
touching the real database or any model provider. Exits non-zero on any failure
so it can gate CI.

    .venv\\Scripts\\python.exe scripts\\verify_auth.py
"""
import os
import sys
import tempfile
import threading
from pathlib import Path

# Hermetic env — set BEFORE importing the app (settings reads these at import).
os.environ["NOOR_INTELLIGENCE_ENABLED"] = "false"
os.environ["NOOR_MODEL_PROVIDER"] = "fake"
os.environ.setdefault("NOOR_SESSION_SECRET", "verify-secret-key-not-for-production")

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Point the DB at a temp file so the real noor_ai.db is never touched.
import backend.app.database as database  # noqa: E402

_tmp = tempfile.mkdtemp(prefix="noor_verify_")
database.DATABASE_PATH = Path(_tmp) / "verify.db"

import backend.app.auth as auth  # noqa: E402
import backend.app.concurrency as conc  # noqa: E402
import backend.app.main as main_mod  # noqa: E402
import backend.app.intelligence.api as intel_api  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

# Deterministic, network-free generation for both chat paths.
main_mod.generate_response = lambda message, gem: "TEST_ANSWER"
main_mod.get_model_metadata = lambda: {"provider": "test", "model": "test-model"}
intel_api.generate_response = lambda message, gem: "TEST_ANSWER"
intel_api.get_model_metadata = lambda: {"provider": "test", "model": "test-model"}

app = main_mod.app

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


def bearer(user_id, provider="google"):
    return {"Authorization": f"Bearer {auth.sign_session(user_id, provider)}"}


# ---------------------------------------------------------------------------
print("== Phase 4: token codec (HS256, constant-time) ==")
tok = auth.sign_session("google:alice", "google", email="a@x.com", name="Alice")
claims = auth.verify_session(tok)
check("round-trip verifies subject", bool(claims) and claims["sub"] == "google:alice")
tampered = tok[:-2] + ("aa" if not tok.endswith("aa") else "bb")
check("tampered signature rejected", auth.verify_session(tampered) is None)
check("garbage token rejected", auth.verify_session("not.a.jwt") is None)
check("expired token rejected", auth.verify_session(auth.sign_session("google:eve", "google", ttl_seconds=-10)) is None)
_saved_secret = auth.NOOR_SESSION_SECRET
_good = auth.sign_session("google:bob", "google")
auth.NOOR_SESSION_SECRET = "a-completely-different-secret"
check("wrong-secret token rejected", auth.verify_session(_good) is None)
auth.NOOR_SESSION_SECRET = _saved_secret

# ---------------------------------------------------------------------------
print("== Phase 4: observe mode (enforce OFF) — backward compatible ==")
auth.NOOR_AUTH_ENFORCE = False
with TestClient(app) as c:
    r = c.post("/chat", json={"message": "hi", "gem_id": "general", "user_id": "legacyA"})
    check("legacy chat works with no session (200)", r.status_code == 200)
    conv = r.json().get("conversation_id") if r.status_code == 200 else None
    lst = c.get("/conversations", params={"user_id": "legacyA"})
    ids = [x["conversation_id"] for x in lst.json().get("conversations", [])] if lst.status_code == 200 else []
    check("legacy user sees own conversation", conv is not None and conv in ids)
    me = c.get("/auth/me").json()
    check("whoami: unauthenticated + enforce off", me["authenticated"] is False and me["enforce"] is False)

# ---------------------------------------------------------------------------
print("== Phase 4: enforce mode (enforce ON) — identity bound ==")
auth.NOOR_AUTH_ENFORCE = True
with TestClient(app) as c:
    r = c.post("/chat", json={"message": "hi", "gem_id": "general", "user_id": "legacyA"})
    check("no session -> 401", r.status_code == 401)

    g = c.post("/auth/guest")
    guest_id = g.json().get("user_id", "")
    check("guest session issued (guest: id + cookie set)",
          guest_id.startswith("guest:") and bool(c.cookies.get("noor_session")))
    me = c.get("/auth/me").json()
    check("whoami: authenticated guest", me["authenticated"] is True and me["is_guest"] is True)

    # Forged body user_id must be ignored — conversation is owned by the guest.
    r = c.post("/chat", json={"message": "hi", "gem_id": "general", "user_id": "attacker"})
    check("guest chat works (200)", r.status_code == 200)
    gconv = r.json().get("conversation_id")
    owned = c.get("/conversations").json().get("conversations", [])
    check("conversation owned by guest id, not forged 'attacker'",
          any(x["conversation_id"] == gconv and x["user_id"] == guest_id for x in owned))

with TestClient(app) as c:
    # alice creates a private conversation (forging user_id=bob in the body).
    ra = c.post("/chat", headers=bearer("google:alice"),
                json={"message": "secret", "gem_id": "general", "user_id": "google:bob"})
    check("alice (bearer) chat ok", ra.status_code == 200)
    aconv = ra.json().get("conversation_id")
    check("owner reads own messages",
          c.get(f"/conversations/{aconv}/messages", headers=bearer("google:alice")).status_code == 200)
    # bob forges query user_id=alice — must be ignored; bob is not the owner -> 404.
    rb = c.get(f"/conversations/{aconv}/messages", headers=bearer("google:bob"),
               params={"user_id": "google:alice"})
    check("IDOR blocked (read): forged user_id ignored, non-owner -> 404", rb.status_code == 404)
    rd = c.delete(f"/conversations/{aconv}", headers=bearer("google:bob"),
                  params={"user_id": "google:alice"})
    check("IDOR blocked (delete): non-owner -> 404", rd.status_code == 404)
    rl = c.get("/conversations", headers=bearer("google:alice"))
    check("bearer session lists own convos",
          rl.status_code == 200 and any(x["conversation_id"] == aconv for x in rl.json()["conversations"]))

# ---------------------------------------------------------------------------
print("== Phase 5: per-user concurrency limiter ==")
conc.NOOR_MAX_CONCURRENT_PER_USER = 1
conc.NOOR_CONCURRENCY_TIMEOUT_SECONDS = 0.2
conc._user_semaphores.clear()
_entered = threading.Event()
_release = threading.Event()


def _hold():
    with conc.concurrency_slot("uX"):
        _entered.set()
        _release.wait(2)


_t = threading.Thread(target=_hold)
_t.start()
_entered.wait(2)
_got_429 = False
try:
    with conc.concurrency_slot("uX"):
        pass
except HTTPException as e:
    _got_429 = e.status_code == 429
check("2nd concurrent slot for same user -> 429", _got_429)

_other_ok = False
try:
    with conc.concurrency_slot("uY"):
        _other_ok = True
except HTTPException:
    _other_ok = False
check("different user has independent slots", _other_ok)

_release.set()
_t.join(2)
_reuse_ok = False
try:
    with conc.concurrency_slot("uX"):
        _reuse_ok = True
except HTTPException:
    _reuse_ok = False
check("slot reusable after release", _reuse_ok)

# ---------------------------------------------------------------------------
print("== Phase 5: daily usage quota ==")
conc.NOOR_DAILY_MESSAGE_LIMIT = 2
conc._usage.clear()
conc.check_and_increment_daily_usage("quotaU")
conc.check_and_increment_daily_usage("quotaU")
_over = False
try:
    conc.check_and_increment_daily_usage("quotaU")
except HTTPException as e:
    _over = e.status_code == 429
check("message over daily limit -> 429", _over)
check("other user unaffected by first user's quota",
      conc.usage_snapshot("quotaOther")["used"] == 0)

conc.NOOR_DAILY_MESSAGE_LIMIT = 0
_disabled_ok = True
try:
    for _ in range(10):
        conc.check_and_increment_daily_usage("quotaU2")
except HTTPException:
    _disabled_ok = False
check("limit 0 disables quota (never blocks)", _disabled_ok)

# ---------------------------------------------------------------------------
print("== Phase 6: Core Web Vitals telemetry (exempt from enforce) ==")
# NOTE: NOOR_AUTH_ENFORCE is still True here (set in the Phase 4 enforce block),
# so this also proves the vitals endpoints accept anonymous reports under enforce.
check("enforce still ON for this section", auth.NOOR_AUTH_ENFORCE is True)
with TestClient(app) as c:
    r = c.post("/api/vitals", json={"name": "LCP", "value": 1200.0, "rating": "good", "path": "/"})
    check("vitals accepts a report with no session (200)",
          r.status_code == 200 and r.json().get("ok") is True)
    c.post("/api/vitals", json={"name": "LCP", "value": 4200.0})
    c.post("/api/vitals", json={"name": "CLS", "value": 0.02})
    s = c.get("/api/vitals")
    check("vitals summary returns 200", s.status_code == 200)
    metrics = {m["name"]: m for m in s.json().get("metrics", [])}
    check("LCP samples counted (>=2)", metrics.get("LCP", {}).get("count", 0) >= 2)
    check("LCP p75 carries a rating",
          metrics.get("LCP", {}).get("rating") in {"good", "needs-improvement", "poor"})
    check("CLS 0.02 rated good", metrics.get("CLS", {}).get("rating") == "good")

# ---------------------------------------------------------------------------
print(f"\n{'ALL PASS' if _fail == 0 else 'FAILURES PRESENT'}: {_pass} passed, {_fail} failed")
sys.exit(0 if _fail == 0 else 1)
