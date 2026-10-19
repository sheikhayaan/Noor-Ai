"""Confirm the persisted NOOR_AUTH_ENFORCE=true in .env actually takes effect on
a real boot — i.e. the file value flows through settings -> auth and the running
server enforces it. Unlike smoke_live.py (which toggles the flag at runtime),
this deliberately does NOT set NOOR_AUTH_ENFORCE in the environment, so the only
source is the .env file, exercising the real config path.

    .venv\\Scripts\\python.exe scripts\\confirm_enforce_env.py
"""
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

# Intelligence off (avoid Qdrant) + temp DB. NOTE: we intentionally do NOT set
# NOOR_AUTH_ENFORCE here — it must come from .env.
os.environ["NOOR_INTELLIGENCE_ENABLED"] = "false"

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import backend.app.database as database  # noqa: E402

database.DATABASE_PATH = Path(tempfile.mkdtemp(prefix="noor_enforce_")) / "e.db"

import backend.app.settings as settings  # noqa: E402
import backend.app.auth as auth  # noqa: E402
import backend.app.main as main_mod  # noqa: E402
import requests  # noqa: E402
import uvicorn  # noqa: E402

main_mod.generate_response = lambda message, gem: "X"
main_mod.get_model_metadata = lambda: {"provider": "test", "model": "test-model"}

HOST, PORT = "127.0.0.1", 8098
BASE = f"http://{HOST}:{PORT}"
_pass = _fail = 0


def check(name, cond):
    global _pass, _fail
    if cond:
        _pass += 1
        print(f"  PASS  {name}")
    else:
        _fail += 1
        print(f"  FAIL  {name}")


print("== .env flip is honored through the real config path ==")
check("settings.NOOR_AUTH_ENFORCE parsed True from .env", settings.NOOR_AUTH_ENFORCE is True)
check("auth.NOOR_AUTH_ENFORCE True at import", auth.NOOR_AUTH_ENFORCE is True)
check("auth.auth_enforced() True", auth.auth_enforced() is True)

config = uvicorn.Config(main_mod.app, host=HOST, port=PORT, log_level="warning")
server = uvicorn.Server(config)
thread = threading.Thread(target=server.run, daemon=True)
thread.start()
ready = False
for _ in range(100):
    try:
        if requests.get(f"{BASE}/health", timeout=1).status_code == 200:
            ready = True
            break
    except requests.RequestException:
        time.sleep(0.1)
check("server (booted from .env) answers /health", ready)

try:
    if ready:
        print("== enforcing behavior on the real boot ==")
        r = requests.post(f"{BASE}/chat", json={"message": "hi", "gem_id": "general", "user_id": "x"})
        check("no session -> 401 (enforce is live)", r.status_code == 401)
        s = requests.Session()
        g = s.post(f"{BASE}/auth/guest")
        check("guest session issued", g.status_code == 200 and g.json().get("user_id", "").startswith("guest:"))
        me = s.get(f"{BASE}/auth/me").json()
        check("whoami: authenticated guest, enforce True",
              me.get("authenticated") is True and me.get("is_guest") is True and me.get("enforce") is True)
        r2 = s.post(f"{BASE}/chat", json={"message": "hi", "gem_id": "general"})
        check("guest with cookie can chat (200)", r2.status_code == 200)
finally:
    server.should_exit = True
    thread.join(timeout=5)

print(f"\n{'ALL PASS' if _fail == 0 else 'FAILURES PRESENT'}: {_pass} passed, {_fail} failed")
sys.exit(0 if _fail == 0 else 1)
