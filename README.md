# Noor AI

**Bringing Light to Knowledge, Creativity, and Intelligence.**

Noor AI is planned as a personal and professional AI companion for learning, content creation, coding, research, and productivity. The long-term vision is to evolve Noor AI into a Personal Intelligence Operating System that can understand, teach, create, code, reason, remember, and collaborate across many kinds of human work.

## What We Are Building

Noor AI will be built in phases. The first version should be a working AI application with strong user experience and practical intelligence. Over time, it can grow into a deeper ML system with custom models, fine-tuning, retrieval, memory, agents, and multimodal abilities.

Core modules:

- AI chat companion
- Advanced AI tutor
- Universal coding assistant
- Content creation engine
- Research and analysis engine
- Personal memory system
- Agent workflow system
- Multimodal support for text, images, audio, and files

## Important Reality Check

Training a large language model fully from scratch requires massive datasets, expensive GPU clusters, model training infrastructure, evaluation systems, and safety work. So the smart path is:

1. Build the Noor AI platform from scratch.
2. Use strong existing open-source or API models as the first intelligence layer.
3. Add RAG, memory, tools, and agents.
4. Fine-tune smaller models for Noor-specific tasks.
5. Train custom ML/deep learning models where they are practical.
6. Later, explore larger custom language model training when compute and data are ready.

This keeps the project real, useful, and scalable.

## First Milestone

The first milestone is a local Noor AI prototype:

- Web interface
- Chat system
- Tutor mode
- Coding mode
- Content creator mode
- Research mode
- Basic memory
- Model provider layer
- Simple project structure

## Running Locally

Noor AI runs as three processes, and **the gateway must be up first**: every
chat and embedding call is routed through it (`NOOR_MODEL_PROVIDER=gateway`), so
chat answers `Cannot reach Noor Gateway at http://127.0.0.1:8080` until it runs.

| Service | Port | Lives in |
| --- | --- | --- |
| Noor Gateway | 8080 | the sibling `noor gateway` checkout |
| Backend (FastAPI) | 8000 | this repo |
| Frontend (Next.js) | 3000 | `frontend/` |

### One command

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

Starts each service in its own window, waits until both APIs answer `/health`,
then prints the URLs. Add `-GatewayPath "D:\code\noor gateway"` if the gateway
lives elsewhere (or set `NOOR_GATEWAY_DIR` once), `-NoFrontend` for API work only.

### Or three terminals

```powershell
# 1. gateway (:8080) - launched from this repo, runs the sibling checkout
powershell -ExecutionPolicy Bypass -File scripts\start_gateway.ps1

# 2. backend (:8000)
powershell -ExecutionPolicy Bypass -File scripts\start_backend.ps1

# 3. frontend (:3000)
cd frontend; npm.cmd run dev
```

### Configure

```powershell
Copy-Item .env.example .env      # every key has a working code default
```

- `NOOR_MODEL_PROVIDER=gateway` (default) routes through the gateway; use
  `fake` for a deterministic offline provider or `openai` to bypass the gateway.
- `NOOR_GATEWAY_API_KEY` must equal `NOOR_DEV_API_KEY` in the gateway repo's
  `.env` (dev default: `ngw_sk_dev`), and `NOOR_GATEWAY_BASE_URL` must match its
  `GATEWAY_PORT`.
- The admin dashboard (`/admin`) shows live gateway cache health, proxied
  server-side so the gateway key never reaches the browser. Access is
  allowlisted server-side: `NOOR_ADMIN_EMAILS` (comma separated) plus
  `NOOR_ADMIN_ALLOW_LOOPBACK=true` for local development. Set it to your own
  address, e.g. `NOOR_ADMIN_EMAILS=you@example.com`.

## Pages

| Route | What it is |
|---|---|
| `/` | Landing page |
| `/chat` | Chat workspace: gems, attachments, model picker, per-answer savings |
| `/signin` | Sign-in (Google) with a guest fallback |
| `/dashboard` | Signed-in home: history, tokens/USD saved, memory topics, attached keys |
| `/memory` | Memory inspector and savings analytics; delete anything here |
| `/why` | How Noor works, as a request flow chart plus a value tree |
| `/admin` | Admin console (allowlisted emails, or loopback in dev) |

### Verify the wiring

```powershell
.venv\Scripts\python.exe scripts\check_gateway.py --chat
```

Checks provider config, the gateway repo's port/key agreement, `/health`, API-key
auth, `/v1/models`, `/v1/cache/health`, embedding dimensions, and (with `--chat`)
a real completion including the routed model and cache result. Exit code 2 means
the gateway is not running.

Full suite - the offline suites pass with the gateway down; the live wiring suite
reports `SKIP` instead of failing:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\verify_all.ps1
```

Serving the browser-facing servers over TLS (optional): see
[HTTPS-SETUP.md](./HTTPS-SETUP.md).

## Bring your own model key (BYOK)

`Noor Auto` stays the default: routed through the gateway, served from the
semantic cache when a near-duplicate question was answered before, free for the
user. Power users can point a conversation at **Claude, GPT, Gemini, DeepSeek or
Kimi on their own account**, which removes Noor's token cost for that turn.

How it works, end to end:

1. The picker in the composer lists the gateway default (always available) and
   the BYOK models (available once a key is stored). `GET /api/models` is the
   single source of truth, and it reports availability per user.
2. `PUT /api/byok/{provider}` accepts the key, verifies it against the provider
   (`NOOR_BYOK_VERIFY_ON_SAVE`), encrypts it with **AES-256-GCM** and stores only
   the ciphertext plus a masked hint. The plaintext key exists only in memory for
   the duration of the request.
3. The ciphertext is bound to `user_id + provider` as AEAD associated data, so a
   row copied to another account cannot be decrypted. Reads are always scoped
   `user_id AND provider` — there is no shared key pool.
4. `POST /chat` / `POST /api/chat` accept `model`. A BYOK model is used for that
   request only, with the Noor gateway as fallback when no key is stored.
5. Any response, log line or error message containing key material is scrubbed
   by `backend/app/crypto.py:redact()`; the API never returns the plaintext and
   the browser only ever sees `sk-…abcd`.

Set `NOOR_ENCRYPTION_KEY` in production (32 bytes, base64/hex). Without it, dev
generates `.noor_secret` locally (git-ignored); in production the app refuses to
start rather than invent a throwaway key.

## Running for 1000 concurrent users

Noor is built to be *shaped*, not to hope: every stage has a bounded queue and a
loud failure mode, so overload produces fast 429/503s instead of a slow collapse.

| Knob | Default | What it protects |
| --- | --- | --- |
| `NOOR_MAX_CONCURRENT_GLOBAL` | 256 | Process-wide in-flight generations (sockets, gateway) |
| `NOOR_MAX_CONCURRENT_PER_USER` | 3 | One user cannot monopolise the instance |
| `NOOR_RATE_LIMIT_CHAT_PER_MIN` / `_BURST` | 60 / 10 | Fairness per identity |
| `NOOR_BG_WORKERS` / `NOOR_BG_QUEUE_SIZE` | 4 / 512 | Memory extraction runs off the request path and is dropped (and counted) when saturated |
| `NOOR_MAX_BODY_BYTES` / `NOOR_MAX_MESSAGE_CHARS` | 256 KiB / 8000 | Rejects abuse before parsing or tokenising |
| `NOOR_BYOK_MAX_KEYS_PER_USER` | 8 | Bounds per-user secret storage |

Storage and caching are the real scaling levers: SQLite runs in WAL mode with
`busy_timeout` so concurrent readers do not block, chat threads are not blocked by
HTTP (pooled keep-alive session to the gateway), and repeated questions are
answered from the gateway's semantic cache. Beyond one instance, run several app
processes behind a load balancer and point them at a shared Qdrant (and Redis, if
you enable the distributed limiter) — see [SCALING.md](./SCALING.md) for capacity
math, tuning and the load test.

## Suggested Tech Stack

Early prototype:

- Backend: Python with FastAPI
- Frontend: React or Next.js
- Database: SQLite first, PostgreSQL later
- Vector database: Chroma, FAISS, or Qdrant
- ML stack: PyTorch, Transformers, Sentence Transformers
- Agents/tools: custom Python tool layer first

## Project Roadmap

See [ROADMAP.md](./ROADMAP.md).

## Current Learning Step

We are on Lesson 01: building Noor AI's first backend API.

Read:

- [lessons/01_backend_api.md](./lessons/01_backend_api.md)

Current backend files:

- [backend/app/main.py](./backend/app/main.py)
- [backend/requirements.txt](./backend/requirements.txt)

