"""Phase C verification — the intelligence HTTP routes end-to-end.

Drives the real FastAPI app via TestClient (so routing, Pydantic validation,
persistence, isolation, and the x-noor-* headers are all exercised) against the
live Noor Gateway on :8080. Intelligence is force-enabled here; env is set
BEFORE importing settings/app.

Run (from anywhere, gateway up, no dev server holding Qdrant):
    .venv\\Scripts\\python.exe scripts\\verify_phase_c.py

Exits 0 on PASS, 1 on FAIL, 2 when the gateway is not running.
Uses a throwaway user and deletes all its data (SQLite + Qdrant) on the way out.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))       # `backend.app`
sys.path.insert(0, str(Path(__file__).resolve().parent))           # `gateway_probe`

# Provider replies land in prints below and may contain characters the Windows
# console code page cannot encode - don't let that crash a verification run.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

os.environ["NOOR_INTELLIGENCE_ENABLED"] = "true"
os.environ.setdefault("NOOR_MODEL_PROVIDER", "gateway")

from fastapi.testclient import TestClient  # noqa: E402

from backend.app import auth  # noqa: E402
from backend.app.main import app  # noqa: E402
from gateway_probe import require_gateway  # noqa: E402

USER = "verify_phase_c_user"
OTHER = "verify_phase_c_intruder"


def bearer(user_id: str) -> dict[str, str]:
    """Signed session header.

    Auth enforcement (NOOR_AUTH_ENFORCE=true) ignores a body/query user_id, so
    every request must carry a real identity - otherwise everything 401s and
    the isolation checks below would be testing nothing.
    """
    return {"Authorization": f"Bearer {auth.sign_session(user_id, 'google')}"}


def check(label: str, ok: bool, detail: str = "") -> bool:
    ok = bool(ok)  # `a and b` can yield None, which would poison sum(results)
    print(f"   [{'PASS' if ok else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))
    return ok


def main() -> int:
    # 2 = "the gateway this script needs is not running" (see scripts/gateway_probe.py).
    require_gateway("verify_phase_c.py")

    results: list[bool] = []
    with TestClient(app) as client:
        # Clean slate.
        client.request("DELETE", "/api/memory", params={"user_id": USER}, headers=bearer(USER))

        print("\n1) POST /api/chat")
        r1 = client.post("/api/chat", json={
            "message": "Hi, I'm building Noor AI with FastAPI and Next.js. "
                       "I prefer short answers with code examples.",
            "user_id": USER, "gem_id": "coding",
        }, headers=bearer(USER))
        results.append(check("chat 200", r1.status_code == 200, str(r1.status_code)))
        body = r1.json() if r1.status_code == 200 else {}
        results.append(check("chat returns an answer", bool(body.get("response")),
                             str(body.get("response", ""))[:50]))
        results.append(check("savings headers present",
                             "x-noor-tokens-saved" in r1.headers and "x-noor-cache-result" in r1.headers,
                             f"saved={r1.headers.get('x-noor-tokens-saved')}, "
                             f"cache={r1.headers.get('x-noor-cache-result')}"))
        results.append(check("body carries honest savings fields",
                             "tokens_saved" in body and body.get("intelligence_enabled") is True,
                             f"tokens_saved={body.get('tokens_saved')}, mem={body.get('memories_used')}"))
        conv_id = body.get("conversation_id")

        # Second turn in the same conversation (history now non-empty).
        r2 = client.post("/api/chat", json={
            "message": "Remind me which web framework I'm using?",
            "user_id": USER, "gem_id": "coding", "conversation_id": conv_id,
        }, headers=bearer(USER))
        results.append(check("second turn 200 + answer", r2.status_code == 200 and bool(r2.json().get("response")),
                             str(r2.json().get("response", ""))[:50]))

        print("\n1b) BACKGROUND AUTO-PROCESSING (Phase D)")
        # No explicit /process yet — memory must already be populated by the
        # background task scheduled on each /api/chat turn.
        auto = client.get("/api/memory", params={"user_id": USER}, headers=bearer(USER)).json()
        background_facts = auto.get("counts", {}).get("facts", 0)
        results.append(check("chat auto-extracted memory in the background",
                             background_facts > 0,
                             f"counts={auto.get('counts')}"))

        print("\n2) ISOLATION")
        r_iso = client.post("/api/chat", json={
            "message": "whose conversation is this?", "user_id": OTHER, "conversation_id": conv_id,
        }, headers=bearer(OTHER))
        results.append(check("other user cannot post into this conversation (404)",
                             r_iso.status_code == 404, str(r_iso.status_code)))

        print("\n3) POST /api/memory/process")
        rp = client.post("/api/memory/process", json={"user_id": USER, "conversation_id": conv_id},
                         headers=bearer(USER))
        results.append(check("process 200", rp.status_code == 200, str(rp.status_code)))
        pj = rp.json() if rp.status_code == 200 else {}
        # The Phase D background task already processed this conversation, so an
        # explicit /process legitimately reports 0 NEW facts. What must hold is:
        # the route succeeds and memory is populated either way.
        results.append(check("process ok and memory populated (explicit or background)",
                             bool(pj.get("processed")) and (pj.get("facts", 0) > 0 or background_facts > 0),
                             f"new_facts={pj.get('facts')}, background_facts={background_facts}"))
        # Idempotency at the route layer.
        rp2 = client.post("/api/memory/process", json={"user_id": USER, "conversation_id": conv_id},
                          headers=bearer(USER))
        results.append(check("re-process does not re-apply accumulators",
                             rp2.json().get("accumulators_applied") is False,
                             str(rp2.json().get("accumulators_applied"))))
        # Intruder cannot process someone else's conversation.
        rp_iso = client.post("/api/memory/process", json={"user_id": OTHER, "conversation_id": conv_id},
                             headers=bearer(OTHER))
        results.append(check("other user cannot process this conversation (404)",
                             rp_iso.status_code == 404, str(rp_iso.status_code)))

        print("\n4) GET /api/memory + /api/memory/facts")
        rm = client.get("/api/memory", params={"user_id": USER}, headers=bearer(USER))
        mj = rm.json() if rm.status_code == 200 else {}
        results.append(check("memory snapshot has facts + counts", rm.status_code == 200
                             and mj.get("counts", {}).get("facts", 0) > 0,
                             f"counts={mj.get('counts')}"))
        results.append(check("style profile learned", bool(mj.get("style_profile")),
                             str(mj.get("style_profile"))[:60]))
        rf = client.get("/api/memory/facts", params={"user_id": USER}, headers=bearer(USER))
        results.append(check("facts endpoint returns list", rf.status_code == 200
                             and rf.json().get("count", 0) > 0, f"count={rf.json().get('count')}"))
        # Isolation: intruder sees nothing.
        rmi = client.get("/api/memory", params={"user_id": OTHER}, headers=bearer(OTHER))
        results.append(check("other user's memory is empty (isolation)",
                             rmi.json().get("counts", {}).get("facts", 0) == 0,
                             f"counts={rmi.json().get('counts')}"))

        print("\n5) GET /api/savings")
        rs = client.get("/api/savings", params={"user_id": USER}, headers=bearer(USER))
        sj = rs.json() if rs.status_code == 200 else {}
        results.append(check("savings summary reflects >=1 request", rs.status_code == 200
                             and sj.get("total_requests", 0) >= 1, f"requests={sj.get('total_requests')}, "
                             f"tokens={sj.get('total_tokens_saved')}"))

        print("\n6) DELETE /api/memory")
        rd = client.request("DELETE", "/api/memory", params={"user_id": USER}, headers=bearer(USER))
        dj = rd.json() if rd.status_code == 200 else {}
        results.append(check("delete reports removal", rd.status_code == 200 and dj.get("deleted") is True,
                             f"facts_deleted={dj.get('facts_deleted')}"))
        after = client.get("/api/memory", params={"user_id": USER}, headers=bearer(USER)).json()
        results.append(check("memory empty after delete",
                             after.get("counts", {}).get("facts", 0) == 0, f"counts={after.get('counts')}"))

        # Final cleanup (intruder left nothing, but be thorough).
        client.request("DELETE", "/api/memory", params={"user_id": OTHER}, headers=bearer(OTHER))

    passed = all(results)
    print(f"\nPHASE C VERIFY: {'PASS' if passed else 'FAIL'}  ({sum(results)}/{len(results)} checks)")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
