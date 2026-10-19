# Scaling Noor to ~1000 concurrent users

Everything here is measured, not assumed. Numbers come from
`scripts/load_test.py` against this repo on a Windows 11 laptop, single process,
`NOOR_MODEL_PROVIDER=fake` (so the figure is **Noor's own overhead**, not the
upstream model's latency).

## Measured baseline

| Change | 50-way concurrency | 200-way concurrency |
| --- | --- | --- |
| Before hardening | 63 req/s, p50 413 ms, p95 2.2 s | **32 req/s, p95 12.4 s, 2 hard failures** |
| After batching writes (current) | **76 req/s**, p50 96 ms, p95 3.0 s | **70 req/s**, p95 6.6 s, 0 failures |

What produced the win:

1. **One write transaction per chat turn.** A turn used to open 4–6 SQLite
   connections (conversation, two messages, analytics row), each with its own
   PRAGMAs and commit. `database.transaction()` + `conversation_store.save_exchange()`
   batch that into a single commit.
2. **WAL applied once, not per connection.** `PRAGMA journal_mode = WAL` takes a
   brief exclusive lock; running it on every connection serialised the process.
   It is now set in `initialize_database()` (`_ensure_wal()`), with
   `wal_autocheckpoint = 4000` so checkpoints are batched instead of firing every
   few dozen requests.
3. **Bounded queues everywhere.** Per-user semaphore (3), process-wide semaphore
   (256), token buckets for chat/auth/BYOK, bounded body size, and a bounded
   background pool for memory extraction. Overload now returns a fast 429/503 with
   `Retry-After` instead of a slow collapse.
4. **Pooled outbound HTTP.** A `requests.Session` with keep-alive replaces a fresh
   TLS handshake per turn to the gateway.

## What capacity these numbers mean

70 req/s sustained on one process ≈ 252k requests/hour. A chat turn with a real
model takes 2–5 s, so the binding constraint in production is in-flight
concurrency, not raw request rate:

```
1000 concurrent users × 1 message / 15 s  ≈ 67 req/s   ← matches the measured box
1000 concurrent users × 1 message /  5 s  ≈ 200 req/s  ← needs 3 instances or Postgres
```

At 200 req/s you also need ≈ 200 simultaneous upstream generations; that is what
`NOOR_MAX_CONCURRENT_GLOBAL` (default 256) guards, and why exceeding it is a
clean 503 rather than a socket exhaustion event.

## Do **not** just add `--workers`

Measured: `uvicorn --workers 4` at 200-way concurrency **regressed** (p95 > 30 s,
requests timing out at 60 s). SQLite has a single writer and multiple processes
contend for it through `busy_timeout` instead of with a cheap in-process lock.

Rule of thumb: **one process per SQLite database.** To run multiple instances,
move the database to Postgres first (see below).

## Scaling path

| Level | Setup | Notes |
| --- | --- | --- |
| 1 instance | This repo, defaults | Up to ~70 req/s; fine for a launch spike |
| N instances | Postgres + shared Qdrant + sticky-free sessions | Each instance still bounded by its own semaphores; total ≈ N × 70 |
| Cached-heavy | Gateway semantic cache warm | Repeat questions cost nobody a token and take ~50 ms |

Steps for horizontal scale:

1. Point the app at Postgres (schema in `initialize_database()` is portable: plain
   `TEXT`/`TIMESTAMP`, no SQLite-only features). Replace the `sqlite3` calls in
   `backend/app/database.py` with a pooled driver (`psycopg`).
2. Share one Qdrant instance across app instances (already configurable), so
   memory is not per-process.
3. Keep sessions stateless — they are signed cookies (`NOOR_SESSION_SECRET`), so
   any instance can serve any user; no sticky routing needed.
4. If you enable distributed rate limiting, back the buckets with Redis so the
   limit is global instead of per process.
5. Put the gateway behind the same load balancer and keep `NOOR_MAX_CONCURRENT_GLOBAL`
   × instances below its own concurrency limit.

## Tuning knobs

| Env | Default | Effect |
| --- | --- | --- |
| `NOOR_MAX_CONCURRENT_GLOBAL` | 256 | In-flight generations per process |
| `NOOR_MAX_CONCURRENT_PER_USER` | 3 | Fairness between users |
| `NOOR_CONCURRENCY_TIMEOUT_SECONDS` | 10 | How long to wait for a slot before 429/503 |
| `NOOR_RATE_LIMIT_CHAT_PER_MIN` / `_BURST` | 60 / 10 | Per-identity token bucket |
| `NOOR_BG_WORKERS` / `NOOR_BG_QUEUE_SIZE` | 4 / 512 | Background extraction |
| `NOOR_MAX_BODY_BYTES` | 262144 | Pre-parse request cap |
| `NOOR_MAX_MESSAGE_CHARS` | 8000 | Per-message cap |

## Re-running the measurement

```powershell
# terminal 1 — a server with no upstream latency, to measure Noor itself
$env:NOOR_MODEL_PROVIDER="fake"; $env:NOOR_RATE_LIMIT_CHAT_PER_MIN="0"
.venv\Scripts\python.exe -m uvicorn backend.app.main:app --port 8000

# terminal 2
.venv\Scripts\python.exe scripts\load_test.py --concurrency 50  --requests 400
.venv\Scripts\python.exe scripts\load_test.py --concurrency 200 --requests 1200
.venv\Scripts\python.exe scripts\load_test.py --same-user --concurrency 20 --requests 100   # limiter
```

A healthy run reports only `200` (served), `429` (rate limited) or `503`
(at capacity). Anything else — including `0` connection errors — is a defect.
