import os

# The test suite exercises Noor AI's own request/routing/persistence logic with
# the deterministic fake adapter — not the live Noor Gateway. The running product
# defaults to NOOR_MODEL_PROVIDER=gateway in .env; pin it to "fake" here so the
# suite stays hermetic. This must run before backend.app.settings is imported,
# which is why it lives at conftest module top (pytest imports conftest first).
# load_dotenv(override=False) will not clobber an already-set environment value.
os.environ["NOOR_MODEL_PROVIDER"] = "fake"

# The intelligence layer opens an on-disk Qdrant store on startup; keep it off in
# tests so the suite stays hermetic and never contends for the Qdrant storage
# lock with a running dev server.
os.environ["NOOR_INTELLIGENCE_ENABLED"] = "false"

# The suite exercises the API's own behavior, and the IDOR tests deliberately
# use the legacy client-supplied user_id (observe mode). The dev .env sets
# NOOR_AUTH_ENFORCE=true for the running product, so pin it off here; enforced
# auth is covered by scripts/verify_auth.py against a live server.
os.environ["NOOR_AUTH_ENFORCE"] = "false"

# Rate limiting is a deployment policy, not API behavior: disable the budgets so
# a fast test run never trips a 429 and turns into a flaky suite.
os.environ["NOOR_RATE_LIMIT_CHAT_PER_MIN"] = "0"
os.environ["NOOR_RATE_LIMIT_AUTH_PER_MIN"] = "0"
os.environ["NOOR_RATE_LIMIT_BYOK_PER_MIN"] = "0"
