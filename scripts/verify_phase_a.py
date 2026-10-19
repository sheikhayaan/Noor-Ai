"""Phase A verification for the Noor Intelligence Layer foundation.

Proves the plumbing end-to-end WITHOUT the FastAPI server:
  1. Backend can embed text via Noor Gateway's /v1/debug/embed.
  2. Qdrant collections create on demand (on-disk, no Docker).
  3. Upsert + cosine search round-trips.
  4. user_id filtering isolates one user's memories from another's.

Run (from anywhere, with the gateway on :8080):
    .venv\\Scripts\\python.exe scripts\\verify_phase_a.py

Exits 0 on PASS, 1 on FAIL, 2 when the gateway is not running.
Uses throwaway user ids and deletes all of its own rows on the way out.

NOTE: uses the embedded on-disk Qdrant, which locks its storage dir to ONE
process. Don't run this while a backend server that also opened Qdrant is live.
"""
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))       # `backend.app`
sys.path.insert(0, str(Path(__file__).resolve().parent))           # `gateway_probe`

from backend.app.intelligence import embeddings, vector_store  # noqa: E402
from backend.app.intelligence.memory import FACT_SIMILARITY_THRESHOLD  # noqa: E402
from backend.app.settings import EMBEDDING_DIMENSIONS  # noqa: E402
from gateway_probe import require_gateway  # noqa: E402

ALICE = "verify_phase_a_alice"
BOB = "verify_phase_a_bob"

FACT_ALICE = "The user is building a product called Noor AI using FastAPI and Next.js."
FACT_BOB = "The user's favorite hobby is deep-sea scuba diving on weekends."
# Queries are deliberately paraphrases of each fact: MiniLM scores a literal
# question about "web frameworks" against FACT_ALICE at only ~0.16, i.e. under
# the production threshold below, so a question-style probe would test nothing.
QUERY_ALICE = "The Noor AI product is built with FastAPI and Next.js."
QUERY_BOB = "The user enjoys deep-sea scuba diving as a weekend hobby."


def cleanup() -> None:
    for collection in vector_store.COLLECTIONS:
        for user in (ALICE, BOB):
            vector_store.delete_by_user(collection, user)


def main() -> int:
    # 2 = "the gateway this script needs is not running" (see scripts/gateway_probe.py).
    require_gateway("verify_phase_a.py")

    print("1) ensure_collections() ...")
    vector_store.ensure_collections()
    print("   collections:", vector_store.COLLECTIONS)

    cleanup()  # start from a clean slate
    ok = False
    try:
        print("2) embed via gateway ...")
        vec_a = embeddings.embed_text_sync(FACT_ALICE)
        vec_b = embeddings.embed_text_sync(FACT_BOB)
        print(f"   embedded 2 facts, dim={len(vec_a)} (configured {EMBEDDING_DIMENSIONS})")

        print("3) upsert facts for two different users ...")
        vector_store.upsert("user_memories", str(uuid.uuid4()), vec_a,
                            {"user_id": ALICE, "type": "fact", "content": FACT_ALICE})
        vector_store.upsert("user_memories", str(uuid.uuid4()), vec_b,
                            {"user_id": BOB, "type": "fact", "content": FACT_BOB})

        # Retrieval uses the SAME threshold the product uses for facts (0.65).
        print(f"4) search as alice (score_threshold={FACT_SIMILARITY_THRESHOLD}) ...")
        hits = vector_store.search("user_memories", embeddings.embed_text_sync(QUERY_ALICE),
                                   user_id=ALICE, limit=5, score_threshold=FACT_SIMILARITY_THRESHOLD)
        for hit in hits:
            payload = hit["payload"]
            print(f"   score={hit['score']:.3f}  user={payload.get('user_id')}  "
                  f"{str(payload.get('content'))[:60]}")

        print("5) ISOLATION CHECK - alice must NOT see bob's memory ...")
        leaked = [hit for hit in hits if hit["payload"].get("user_id") != ALICE]
        print("   leaked cross-user rows:", len(leaked), "(must be 0)")
        cross = vector_store.search("user_memories", embeddings.embed_text_sync(QUERY_BOB),
                                    user_id=ALICE, limit=5, score_threshold=FACT_SIMILARITY_THRESHOLD)
        print("   alice querying bob's topic returns:", len(cross), "rows (must be 0)")

        print("6) counts ...")
        counts = {user: vector_store.count_by_user("user_memories", user) for user in (ALICE, BOB)}
        print(f"   alice: {counts[ALICE]}  bob: {counts[BOB]}")

        ok = (
            len(hits) >= 1
            and len(leaked) == 0
            and len(cross) == 0
            and len(vec_a) == EMBEDDING_DIMENSIONS
            and counts[ALICE] >= 1
            and counts[BOB] >= 1
        )
    finally:
        cleanup()        # never leave verification rows in the real store
        vector_store.close()  # avoids qdrant-client's noisy __del__ at shutdown

    print("\nPHASE A VERIFY:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
