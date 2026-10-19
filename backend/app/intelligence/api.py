"""FastAPI routes for the Noor Intelligence Layer.

Mounted under ``/api`` by ``backend.app.main``. These endpoints are additive —
the legacy ``/chat`` path and all gem behavior are left untouched.

Endpoints
---------
    POST   /api/chat            memory-aware chat (synchronous) + x-noor-* headers
    GET    /api/memory          full memory snapshot for a user
    DELETE /api/memory          wipe all of a user's memory (Qdrant + SQLite)
    GET    /api/memory/facts    just the learned facts
    POST   /api/memory/process  extract memory from a stored conversation
    GET    /api/savings         savings summary + daily series + top topics

Design rules honored here:
  * Strict per-user isolation — a client-supplied ``conversation_id`` that
    belongs to another user is rejected (404); every memory read is filtered
    by ``user_id`` inside ``vector_store``.
  * The memory layer never breaks chat — retrieval/processing failures degrade
    to "no memory", and the route still answers.
  * Honest savings — numbers come straight from ``HandlerResult``; nothing is
    inflated. When intelligence is disabled we report zero savings, not fake ones.
"""
from __future__ import annotations

import logging
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response

from backend.app.conversation_store import (
    create_conversation_if_missing,
    get_conversation_owner,
    get_messages,
    save_exchange,
    save_message,
)
from backend.app import admin_store, byok, providers, task_queue
from backend.app.gems import GEMS
from backend.app.intelligence import profile_store, vector_store
from backend.app.textfix import repair_mojibake
from backend.app.intelligence.request_handler import IntelligentRequestHandler
from backend.app.model_provider import generate_response, get_model_metadata
from backend.app.schemas import (
    DailySavingsItem,
    DeleteMemoryResponse,
    IntelligentChatRequest,
    IntelligentChatResponse,
    MemoryCounts,
    MemoryEntityItem,
    MemoryFactItem,
    MemoryFactsResponse,
    MemorySnapshotResponse,
    MemorySummaryItem,
    ProcessMemoryRequest,
    ProcessMemoryResponse,
    RateMessageRequest,
    RateMessageResponse,
    SavingsResponse,
    TopicItem,
)
from backend.app.settings import NOOR_INTELLIGENCE_ENABLED
from backend.app.auth import SessionIdentity, get_current_user, resolve_user_id
from backend.app.database import transaction
from backend.app.concurrency import (
    check_and_increment_daily_usage,
    concurrency_slot,
    global_slot,
    usage_snapshot,
)
from backend.app.rate_limit import chat_limiter
from backend.app.settings import NOOR_MAX_MESSAGE_CHARS

logger = logging.getLogger("noor.intelligence.api")

router = APIRouter(prefix="/api", tags=["intelligence"])

# The handler owns a MemoryProcessor + TokenReducer. It is created lazily and
# reused across requests (the underlying Qdrant client is a per-process
# singleton, so a single handler avoids re-opening the store).
_handler: IntelligentRequestHandler | None = None


def _get_handler() -> IntelligentRequestHandler:
    global _handler
    if _handler is None:
        _handler = IntelligentRequestHandler()
    return _handler


def _resolve_gem(gem_id: str) -> dict:
    gem = GEMS.get(gem_id)
    if gem is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "Unknown gem_id", "available_gems": list(GEMS.keys())},
        )
    return gem


def _title_from_message(message: str) -> str:
    title = message.strip()
    return f"{title[:57]}..." if len(title) > 60 else title


def _process_conversation_bg(user_id: str, conversation_id: str) -> None:
    """Extract memory from a conversation off the request path (best-effort).

    Reloads the authoritative message history from SQLite (so it includes the
    turn just saved) and folds it into memory. Idempotent: deterministic point
    IDs + the processed_conversations ledger make re-runs safe and cheap, so it
    can run after every exchange without duplicating facts or double-counting
    style/topic accumulators. Any failure is swallowed — memory work must never
    surface as a chat error.
    """
    try:
        messages = [
            {"role": m["role"], "content": m["content"]}
            for m in get_messages(conversation_id)
        ]
        if messages:
            _get_handler().memory.process_conversation(user_id, conversation_id, messages)
    except Exception as error:  # noqa: BLE001
        logger.warning("Background memory processing failed for %s: %s", conversation_id, error)


# ---------------------------------------------------------------------------
# POST /api/chat  — the memory-aware entry point
# ---------------------------------------------------------------------------
@router.post(
    "/chat",
    response_model=IntelligentChatResponse,
    dependencies=[Depends(chat_limiter())],
)
def intelligent_chat(
    request: IntelligentChatRequest,
    response: Response,
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, request.user_id)
    gem = _resolve_gem(request.gem_id)

    # Isolation: an existing conversation must belong to this user. A brand-new
    # (not-yet-created) conversation_id is allowed and will be created below.
    if request.conversation_id:
        owner = get_conversation_owner(request.conversation_id)
        if owner is not None and owner != user_id:
            raise HTTPException(status_code=404, detail={"error": "Unknown conversation_id"})
    if len(request.message) > NOOR_MAX_MESSAGE_CHARS:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "message_too_long",
                "message": f"Messages are limited to {NOOR_MAX_MESSAGE_CHARS} characters.",
            },
        )

    # Resolve the model route up-front: an unavailable BYOK key is a clean 409,
    # never a partially-executed turn.
    try:
        route = byok.resolve_route(user_id, request.model)
    except byok.ByokError as error:
        raise HTTPException(
            status_code=error.status,
            detail={"error": error.code, "message": str(error)},
        ) from error

    conversation_id = request.conversation_id or str(uuid4())

    # Reconstruct the running history, then append the new user turn. The
    # handler measures savings against this full naive prompt.
    history = [
        {"role": m["role"], "content": m["content"]} for m in get_messages(conversation_id)
    ]
    messages = history + [{"role": "user", "content": request.message}]

    check_and_increment_daily_usage(user_id)
    _t0 = time.perf_counter()
    if NOOR_INTELLIGENCE_ENABLED:
        try:
            # use_route() gives *all* nested LLM calls (memory extraction,
            # compression, the answer) the user's own credential, so BYOK
            # content never has to transit Noor's gateway.
            with providers.use_route(route):
                with concurrency_slot(user_id), global_slot():
                    result = _get_handler().handle_message(
                        user_id=user_id,
                        conversation_id=conversation_id,
                        messages=messages,
                        gem_id=request.gem_id,
                    )
        except providers.GenerationError as error:
            raise HTTPException(
                status_code=error.status,
                detail={"error": "Generation failed", "message": str(error)},
            ) from error
        except RuntimeError as error:
            # Generation itself failed (gateway down) — this IS fatal.
            raise HTTPException(
                status_code=502,
                detail={"error": "Generation failed", "message": str(error)},
            ) from error
        answer = result.content
        model_used = result.model_used
        cache_result = result.cache_result
        memories_used = result.memories_used
        tokens_saved = result.tokens_saved
        cost_saved = result.cost_saved_usd
        levels_applied = result.levels_applied
        response.headers.update(result.savings_headers())
        response.headers["x-noor-model-used"] = result.model_used
    else:
        # Intelligence disabled (e.g. hermetic tests): answer via the plain
        # provider and report zero savings — honest, never fabricated.
        try:
            with providers.use_route(route):
                with concurrency_slot(user_id), global_slot():
                    if route is not None:
                        answer = providers.chat_completion(
                            [
                                {"role": "system", "content": gem["system_prompt"]},
                                {"role": "user", "content": request.message},
                            ],
                            route,
                        ).content
                        byok.touch_used(user_id, route.provider)
                    else:
                        answer = generate_response(request.message, gem)
        except providers.ProviderError as error:
            raise HTTPException(
                status_code=error.status,
                detail={"error": "Generation failed", "message": str(error)},
            ) from error
        except ValueError as error:
            raise HTTPException(
                status_code=502,
                detail={"error": "Generation failed", "message": str(error)},
            ) from error
        model_used = route.model if route is not None else get_model_metadata()["model"]
        cache_result, memories_used, tokens_saved, cost_saved, levels_applied = (
            "MISS", 0, 0, 0.0, [],
        )
        response.headers.update(
            {
                "x-noor-memory-used": "0",
                "x-noor-tokens-saved": "0",
                "x-noor-cost-saved": "0.00000000",
                "x-noor-cache-result": "MISS",
                "x-noor-model-used": model_used,
            }
        )

    latency_ms = int((time.perf_counter() - _t0) * 1000)

    # Encoding backstop: the gateway can hand back text whose UTF-8 bytes were
    # decoded as a single-byte codec ("overâ€‘theâ€‘counter").
    # Repair once, at the boundary where the answer becomes user-visible and is
    # persisted, so both the response and the stored history stay clean.
    answer = repair_mojibake(answer)

    # One write transaction for the turn (conversation + both messages +
    # analytics). SQLite has one writer, so a single commit per request is what
    # keeps latency flat when many chats land at once.
    with transaction() as connection:
        # create-if-missing keeps the original owner.
        save_exchange(
            conversation_id=conversation_id,
            user_id=user_id,
            title=_title_from_message(request.message),
            gem_id=request.gem_id,
            user_content=request.message,
            assistant_content=answer,
            connection=connection,
        )
        # Best-effort; never breaks the response. Richer than the plain /chat
        # path — carries cache result, memories and honest savings.
        admin_store.log_request(
            user_id=user_id,
            conversation_id=conversation_id,
            gem_id=request.gem_id,
            source="intelligent",
            question=request.message,
            response=answer,
            provider=get_model_metadata().get("provider"),
            model=model_used,
            cache_result=cache_result,
            memories_used=memories_used,
            tokens_saved=tokens_saved,
            cost_saved_usd=cost_saved,
            latency_ms=latency_ms,
            connection=connection,
        )

    # Feature 1: learn from this conversation automatically, off the request
    # path so it never adds latency to the reply. The bounded pool drops work
    # under saturation instead of starving chat threads (see task_queue).
    if NOOR_INTELLIGENCE_ENABLED:
        task_queue.submit(_process_conversation_bg, user_id, conversation_id)

    return IntelligentChatResponse(
        conversation_id=conversation_id,
        gem_id=request.gem_id,
        gem_name=gem["name"],
        message=request.message,
        response=answer,
        model=model_used,
        cache_result=cache_result,
        memories_used=memories_used,
        tokens_saved=tokens_saved,
        cost_saved_usd=cost_saved,
        levels_applied=levels_applied,
        intelligence_enabled=NOOR_INTELLIGENCE_ENABLED,
        byok_provider=route.provider if route is not None else None,
    )


# ---------------------------------------------------------------------------
# POST /api/chat/rate  — thumbs feedback on an assistant turn
# ---------------------------------------------------------------------------
@router.post("/chat/rate", response_model=RateMessageResponse)
def rate_message(
    request: RateMessageRequest,
    session: SessionIdentity | None = Depends(get_current_user),
):
    """Record thumbs feedback on an assistant turn.

    Ownership-checked: you may only rate a conversation you own. ``rating`` must
    be non-zero and is stored as its sign (+1/-1); the latest rating per message
    wins. The ratings ledger is an explicit user action, so a DB failure
    surfaces here (unlike best-effort capture) — but it never touches chat.
    """
    user_id = resolve_user_id(session, request.user_id)
    if request.rating == 0:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_rating", "message": "rating must be +1 or -1."},
        )
    owner = get_conversation_owner(request.conversation_id)
    if owner is None or owner != user_id:
        raise HTTPException(status_code=404, detail={"error": "Unknown conversation_id"})

    result = admin_store.record_rating(
        user_id=user_id,
        conversation_id=request.conversation_id,
        rating=request.rating,
        message_id=request.message_id,
        comment=request.comment,
    )
    return RateMessageResponse(recorded=True, **result)


# ---------------------------------------------------------------------------
# GET /api/memory  — everything Noor remembers about a user
# ---------------------------------------------------------------------------
@router.get("/memory", response_model=MemorySnapshotResponse)
def get_memory(
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    facts_raw, _ = vector_store.scroll_by_user("user_memories", user_id, limit=500)
    entities_raw, _ = vector_store.scroll_by_user("user_entities", user_id, limit=500)
    summaries_raw, _ = vector_store.scroll_by_user("user_summaries", user_id, limit=500)

    facts = [
        MemoryFactItem(
            id=item["id"],
            content=(item["payload"] or {}).get("content", ""),
            conversation_id=(item["payload"] or {}).get("conversation_id"),
        )
        for item in facts_raw
        if (item["payload"] or {}).get("content")
    ]
    entities = [
        MemoryEntityItem(
            name=(item["payload"] or {}).get("name", ""),
            description=(item["payload"] or {}).get("description", ""),
        )
        for item in entities_raw
        if (item["payload"] or {}).get("name")
    ]
    summaries = [
        MemorySummaryItem(
            content=(item["payload"] or {}).get("content", ""),
            topics=(item["payload"] or {}).get("topics", []) or [],
            conversation_id=(item["payload"] or {}).get("conversation_id"),
        )
        for item in summaries_raw
        if (item["payload"] or {}).get("content")
    ]
    topics = [TopicItem(**t) for t in profile_store.get_top_topics(user_id)]

    return MemorySnapshotResponse(
        user_id=user_id,
        facts=facts,
        entities=entities,
        summaries=summaries,
        style_profile=profile_store.get_style_profile(user_id),
        topics=topics,
        counts=MemoryCounts(
            facts=len(facts), entities=len(entities), summaries=len(summaries)
        ),
    )


# ---------------------------------------------------------------------------
# GET /api/memory/facts  — just the learned facts
# ---------------------------------------------------------------------------
@router.get("/memory/facts", response_model=MemoryFactsResponse)
def get_memory_facts(
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    facts_raw, _ = vector_store.scroll_by_user("user_memories", user_id, limit=500)
    facts = [
        MemoryFactItem(
            id=item["id"],
            content=(item["payload"] or {}).get("content", ""),
            conversation_id=(item["payload"] or {}).get("conversation_id"),
        )
        for item in facts_raw
        if (item["payload"] or {}).get("content")
    ]
    return MemoryFactsResponse(user_id=user_id, facts=facts, count=len(facts))


# ---------------------------------------------------------------------------
# DELETE /api/memory  — forget everything about a user
# ---------------------------------------------------------------------------
@router.delete("/memory", response_model=DeleteMemoryResponse)
def delete_memory(
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    # Count first so we can report an honest number of removed items.
    facts_n = vector_store.count_by_user("user_memories", user_id)
    entities_n = vector_store.count_by_user("user_entities", user_id)
    summaries_n = vector_store.count_by_user("user_summaries", user_id)

    ok = all(
        [
            vector_store.delete_by_user("user_memories", user_id),
            vector_store.delete_by_user("user_entities", user_id),
            vector_store.delete_by_user("user_summaries", user_id),
        ]
    )
    try:
        profile_store.reset_user(user_id)
    except Exception as error:  # noqa: BLE001
        logger.warning("Resetting SQLite memory state failed for %s: %s", user_id, error)
        ok = False

    return DeleteMemoryResponse(
        user_id=user_id,
        deleted=ok,
        facts_deleted=facts_n,
        entities_deleted=entities_n,
        summaries_deleted=summaries_n,
    )


# ---------------------------------------------------------------------------
# POST /api/memory/process  — turn a stored conversation into memory
# ---------------------------------------------------------------------------
@router.post("/memory/process", response_model=ProcessMemoryResponse)
def process_memory(
    request: ProcessMemoryRequest,
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, request.user_id)
    # Isolation: only the owner may process their conversation into memory.
    owner = get_conversation_owner(request.conversation_id)
    if owner is None:
        raise HTTPException(status_code=404, detail={"error": "Unknown conversation_id"})
    if owner != user_id:
        raise HTTPException(status_code=404, detail={"error": "Unknown conversation_id"})

    if not NOOR_INTELLIGENCE_ENABLED:
        return ProcessMemoryResponse(processed=False, reason="intelligence disabled")

    messages = [
        {"role": m["role"], "content": m["content"]}
        for m in get_messages(request.conversation_id)
    ]
    if not messages:
        return ProcessMemoryResponse(processed=False, reason="no messages")

    result = _get_handler().memory.process_conversation(
        user_id, request.conversation_id, messages
    )
    return ProcessMemoryResponse(
        processed=bool(result.get("processed")),
        facts=int(result.get("facts", 0)),
        entities=int(result.get("entities", 0)),
        topics=result.get("topics", []) or [],
        accumulators_applied=result.get("accumulators_applied"),
        reason=result.get("reason"),
    )


# ---------------------------------------------------------------------------
# GET /api/savings  — everything the dashboard needs in one call
# ---------------------------------------------------------------------------
@router.get("/savings", response_model=SavingsResponse)
def get_savings(
    user_id: str = "local_user",
    days: int = 30,
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    summary = profile_store.get_savings_summary(user_id)
    daily = [DailySavingsItem(**d) for d in profile_store.get_daily_savings(user_id, days)]
    topics = [TopicItem(**t) for t in profile_store.get_top_topics(user_id)]
    return SavingsResponse(
        user_id=user_id,
        total_tokens_saved=summary["total_tokens_saved"],
        total_cost_saved_usd=summary["total_cost_saved_usd"],
        total_cache_hits=summary["total_cache_hits"],
        total_requests=summary["total_requests"],
        cache_hit_rate=summary["cache_hit_rate"],
        daily=daily,
        top_topics=topics,
    )


# ---------------------------------------------------------------------------
# GET /api/usage  — this user's concurrency + daily-quota status
# ---------------------------------------------------------------------------
@router.get("/usage")
def get_usage(
    user_id: str = "local_user",
    session: SessionIdentity | None = Depends(get_current_user),
):
    user_id = resolve_user_id(session, user_id)
    return usage_snapshot(user_id)
