"""Phase B verification for the Noor Intelligence Layer brain.

Exercises the logic WITHOUT the FastAPI server:
  Pure (no gateway):   token estimation, compression threshold, 70/30 style merge
  Gateway-backed:      embed + chat reachability
  Full pipeline:       process_conversation (twice → idempotent) → retrieve →
                       build_memory_injection → handle_message → savings in DB

Run (from anywhere, with the gateway on :8080, and NO backend server holding
the on-disk Qdrant):
    .venv\\Scripts\\python.exe scripts\\verify_phase_b.py

It uses a throwaway user id and deletes all of its own data (SQLite + Qdrant)
on the way out, so it never pollutes real user memory.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # `backend.app`

# Model output can contain characters the Windows console code page cannot encode
# (a U+2011 hyphen from a provider reply crashed this script under cp1252), so
# never let a print() take the verification down.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

from backend.app.database import initialize_database
from backend.app.intelligence import gateway_chat, profile_store, vector_store
from backend.app.intelligence.memory import MemoryProcessor
from backend.app.intelligence.request_handler import IntelligentRequestHandler
from backend.app.intelligence.token_reducer import TokenReducer

USER = "verify_phase_b_user"
CONV = "verify_phase_b_conv"

CONVERSATION = [
    {"role": "user", "content": "Hi, I'm building a product called Noor AI using FastAPI and "
                                "Next.js. I prefer short answers with code examples. I'm an "
                                "advanced Python developer."},
    {"role": "assistant", "content": "Got it — Noor AI on FastAPI + Next.js. Here's a concise "
                                     "FastAPI route example: @app.get('/x')..."},
    {"role": "user", "content": "I also use Qdrant for vector search and I'm very interested in "
                                "building RAG systems."},
    {"role": "assistant", "content": "Qdrant is a solid choice for RAG. Store embeddings and "
                                     "query by cosine similarity."},
]


def check(label: str, ok: bool, detail: str = "") -> bool:
    print(f"   [{'PASS' if ok else 'FAIL'}] {label}" + (f" - {detail}" if detail else ""))
    return ok


def gateway_up() -> bool:
    try:
        gateway_chat.chat([{"role": "user", "content": "ping"}])
        return True
    except gateway_chat.GatewayError:
        return False


def cleanup() -> None:
    profile_store.reset_user(USER)
    for c in vector_store.COLLECTIONS:
        vector_store.delete_by_user(c, USER)


def finish() -> None:
    """Clean up and release the embedded Qdrant client before the process exits."""
    cleanup()
    vector_store.close()  # avoids qdrant-client's noisy __del__ at shutdown


def main() -> int:
    initialize_database()
    vector_store.ensure_collections()
    cleanup()  # start from a clean slate

    results: list[bool] = []
    reducer = TokenReducer()

    print("\n1) PURE LOGIC (no gateway)")
    small = [{"role": "user", "content": "hi"}]
    big = [{"role": "user", "content": "x" * 20000}]
    results.append(check("estimate_tokens grows with content",
                         reducer.estimate_tokens(big) > reducer.estimate_tokens(small)))
    results.append(check("should_compress False for tiny, True for huge",
                         not reducer.should_compress(small) and reducer.should_compress(big)))
    # 70/30: a single 'advanced' obs must NOT flip a stored 'beginner' past 'intermediate'.
    seeded = profile_store.merge_style(None, {"technical_level": "beginner", "prefers_concise": True})
    nudged = profile_store.merge_style(seeded, {"technical_level": "advanced", "prefers_concise": False})
    results.append(check("style merge seeds from first observation",
                         seeded["technical_level"] == "beginner", seeded["technical_level"]))
    results.append(check("one 'advanced' obs can't override 'beginner' (70/30)",
                         nudged["technical_level"] in ("beginner", "intermediate"),
                         nudged["technical_level"]))
    results.append(check("one 'concise=False' obs can't flip established concise=True",
                         nudged["prefers_concise"] is True, str(nudged["prefers_concise"])))

    if not gateway_up():
        print("\n[!] Gateway not reachable on :8080 - skipping gateway-backed + pipeline checks.")
        print("    Start it with: powershell -ExecutionPolicy Bypass -File scripts\\start_gateway.ps1")
        print("    Then re-run for full verification.")
        cleanup()
        passed = all(results)
        print(f"\nPHASE B (pure only): {'PASS' if passed else 'FAIL'}")
        finish()
        return 0 if passed else 1

    print("\n2) GATEWAY-BACKED")
    reply = gateway_chat.chat([{"role": "user", "content": "Reply with the single word: pong"}])
    results.append(check("gateway chat returns content", bool(reply.content), reply.content[:40]))

    print("\n3) FULL PIPELINE")
    mem = MemoryProcessor()
    first = mem.process_conversation(USER, CONV, CONVERSATION)
    results.append(check("process_conversation extracted facts", first.get("facts", 0) > 0,
                         f"{first.get('facts')} facts, topics={first.get('topics')}"))
    facts_after_first = vector_store.count_by_user("user_memories", USER)

    # Idempotency: same messages again must not grow stored facts or re-apply accumulators.
    second = mem.process_conversation(USER, CONV, CONVERSATION)
    facts_after_second = vector_store.count_by_user("user_memories", USER)
    results.append(check("re-processing is idempotent (fact count stable)",
                         facts_after_first == facts_after_second,
                         f"{facts_after_first} -> {facts_after_second}"))
    results.append(check("re-processing does NOT re-apply accumulators",
                         second.get("accumulators_applied") is False))

    ctx = mem.retrieve_relevant_memories(USER, "Which web framework do I use for the backend?")
    results.append(check("retrieval returns memory", ctx.memory_count > 0,
                         f"{ctx.memory_count} items, facts={ctx.relevant_facts[:1]}"))
    injection = mem.build_memory_injection(ctx)
    results.append(check("injection mentions FastAPI", "FastAPI".lower() in injection.lower(),
                         injection[:80].replace(chr(10), ' ')))

    handler = IntelligentRequestHandler(mem)
    convo = CONVERSATION + [{"role": "user", "content": "Remind me what stack I'm using?"}]
    hr = handler.handle_message(USER, CONV, convo)
    results.append(check("handle_message returns an answer", bool(hr.content), hr.content[:50]))
    results.append(check("savings recorded (tokens_saved >= 0)", hr.tokens_saved >= 0,
                         f"saved={hr.tokens_saved}, mem_used={hr.memories_used}, cache={hr.cache_result}"))

    summary = profile_store.get_savings_summary(USER)
    results.append(check("savings summary persisted", summary["total_requests"] >= 1, str(summary)))

    cleanup()
    passed = all(results)
    print(f"\nPHASE B VERIFY: {'PASS' if passed else 'FAIL'}  ({sum(results)}/{len(results)} checks)")
    finish()
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
