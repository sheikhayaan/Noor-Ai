"""On-disk (embedded) Qdrant vector store for the Noor Intelligence Layer.

Uses ``QdrantClient(path=...)`` so there is NO separate Qdrant server or Docker
to run — vectors persist to a local directory. Three collections hold per-user
semantic memory:

    user_memories   — individual facts learned about the user
    user_entities   — named projects/companies/technologies/people
    user_summaries  — one-paragraph summaries of past conversations

Design rules enforced here:
  * Every read/delete/count is filtered by ``user_id`` — strict data isolation,
    never retrieve another user's memories.
  * Every operation is defensive (try/except). A vector-store failure must never
    break a chat request; callers get a safe empty result instead.
  * The client is a lazily-created singleton — Qdrant local mode allows only one
    client per storage path per process.
"""
from __future__ import annotations

import logging
import threading
from typing import Any, Optional

from backend.app.settings import EMBEDDING_DIMENSIONS, QDRANT_PATH

logger = logging.getLogger("noor.intelligence.vector_store")

COLLECTIONS = ("user_memories", "user_entities", "user_summaries")

_client = None
_lock = threading.Lock()


def _get_client():
    global _client
    if _client is None:
        with _lock:
            if _client is None:
                from qdrant_client import QdrantClient

                _client = QdrantClient(path=QDRANT_PATH)
    return _client


def ensure_collections() -> None:
    """Create the three collections if absent. Idempotent — never wipes data.

    (The spec's ``recreate_collection`` would drop existing vectors on every
    startup; we deliberately use ``create_collection`` guarded by existence.)
    """
    from qdrant_client.models import Distance, VectorParams

    client = _get_client()
    existing = {c.name for c in client.get_collections().collections}
    for name in COLLECTIONS:
        if name not in existing:
            client.create_collection(
                collection_name=name,
                vectors_config=VectorParams(size=EMBEDDING_DIMENSIONS, distance=Distance.COSINE),
            )
            logger.info("Created Qdrant collection %s (dim=%d)", name, EMBEDDING_DIMENSIONS)


def _user_filter(user_id: str, extra: Optional[list] = None):
    from qdrant_client.models import FieldCondition, Filter, MatchValue

    must = [FieldCondition(key="user_id", match=MatchValue(value=user_id))]
    if extra:
        must.extend(extra)
    return Filter(must=must)


def upsert(collection: str, point_id: str, vector: list[float], payload: dict[str, Any]) -> bool:
    try:
        from qdrant_client.models import PointStruct

        _get_client().upsert(
            collection_name=collection,
            points=[PointStruct(id=point_id, vector=vector, payload=payload)],
        )
        return True
    except Exception as error:  # noqa: BLE001 - memory failures must never break chat
        logger.warning("Qdrant upsert failed (%s): %s", collection, error)
        return False


def search(
    collection: str,
    vector: list[float],
    user_id: str,
    limit: int = 5,
    score_threshold: float | None = None,
) -> list[dict[str, Any]]:
    """Cosine-similarity search within one user's points, above an optional threshold.

    Uses ``query_points`` (qdrant-client >= 1.10; the older ``search`` method was
    removed). Returns ScoredPoints as plain dicts; empty list on any failure.
    """
    try:
        response = _get_client().query_points(
            collection_name=collection,
            query=vector,
            query_filter=_user_filter(user_id),
            limit=limit,
            score_threshold=score_threshold,
            with_payload=True,
        )
        return [
            {"id": str(h.id), "score": float(h.score), "payload": h.payload or {}}
            for h in response.points
        ]
    except Exception as error:  # noqa: BLE001
        logger.warning("Qdrant search failed (%s): %s", collection, error)
        return []


def retrieve(collection: str, point_id: str) -> Optional[dict[str, Any]]:
    """Fetch a single point by id (used to merge an entity's description).

    Returns ``None`` if absent or on any failure — callers treat that as "new".
    """
    try:
        points = _get_client().retrieve(
            collection_name=collection, ids=[point_id], with_payload=True
        )
        if not points:
            return None
        p = points[0]
        return {"id": str(p.id), "payload": p.payload or {}}
    except Exception as error:  # noqa: BLE001
        logger.warning("Qdrant retrieve failed (%s): %s", collection, error)
        return None


def scroll_by_user(
    collection: str,
    user_id: str,
    limit: int = 100,
    offset: Any = None,
) -> tuple[list[dict[str, Any]], Any]:
    try:
        points, next_offset = _get_client().scroll(
            collection_name=collection,
            scroll_filter=_user_filter(user_id),
            limit=limit,
            offset=offset,
            with_payload=True,
        )
        return [{"id": str(p.id), "payload": p.payload or {}} for p in points], next_offset
    except Exception as error:  # noqa: BLE001
        logger.warning("Qdrant scroll failed (%s): %s", collection, error)
        return [], None


def count_by_user(collection: str, user_id: str) -> int:
    try:
        result = _get_client().count(
            collection_name=collection, count_filter=_user_filter(user_id), exact=True
        )
        return int(result.count)
    except Exception as error:  # noqa: BLE001
        logger.warning("Qdrant count failed (%s): %s", collection, error)
        return 0


def delete_by_user(collection: str, user_id: str) -> bool:
    try:
        from qdrant_client.models import FilterSelector

        _get_client().delete(
            collection_name=collection,
            points_selector=FilterSelector(filter=_user_filter(user_id)),
        )
        return True
    except Exception as error:  # noqa: BLE001
        logger.warning("Qdrant delete failed (%s): %s", collection, error)
        return False


def close() -> None:
    """Close the embedded Qdrant client (call on FastAPI shutdown).

    Prevents the ``ImportError: sys.meta_path is None`` that qdrant-client's
    ``__del__`` raises when the client is only collected during interpreter
    teardown. Idempotent — safe to call when no client was opened.
    """
    global _client
    with _lock:
        if _client is not None:
            try:
                _client.close()
            except Exception as error:  # noqa: BLE001
                logger.warning("Qdrant close failed: %s", error)
            _client = None
