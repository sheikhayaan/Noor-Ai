"""MemoryProcessor — the persistent per-user knowledge graph.

Turns finished conversations into structured semantic memory (facts, entities,
summaries in Qdrant; style + topic affinity in SQLite) and retrieves the most
relevant slice of it before each new message so the model always has personal
context without the user repeating themselves.

Hard rules honored here (from the spec's quality requirements):
  * Memory work must NEVER break a chat request — every external call is
    wrapped; failures degrade to "no memory" and are logged.
  * Strict per-user isolation — every Qdrant read is filtered by user_id
    (enforced in ``vector_store``).
  * Idempotent — reprocessing a conversation neither duplicates vectors
    (deterministic point IDs) nor double-applies the style/topic accumulators
    (guarded by the processed_conversations ledger).
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from backend.app.intelligence import gateway_chat, profile_store, vector_store
from backend.app.intelligence.embeddings import EmbeddingError, embed_text_sync
from backend.app.intelligence.models import MemoryContext

logger = logging.getLogger("noor.intelligence.memory")

# Stable namespace so uuid5 keys are reproducible across processes/runs.
_NS = uuid.UUID("6f0d8f1e-2a4b-4c6d-8e0f-1a2b3c4d5e6f")

FACT_SIMILARITY_THRESHOLD = 0.65
SUMMARY_LIMIT = 2
ENTITY_LIMIT = 3
ENTITY_SIMILARITY_THRESHOLD = 0.60

_EXTRACTION_SYSTEM_PROMPT = (
    "Extract structured memory from this conversation. Return ONLY a JSON object "
    "with these fields:\n"
    "- facts: array of factual things learned about the user (preferences, skills, "
    "projects, background, goals)\n"
    "- style: object describing communication preferences observed "
    "(prefers_concise: bool, prefers_examples: bool, technical_level: "
    "beginner/intermediate/advanced, preferred_language: string)\n"
    "- entities: array of named things mentioned (projects, companies, technologies, "
    "people) with a brief description each. Each item: {name, description}\n"
    "- topics: array of main topics discussed\n"
    "- summary: one paragraph summary of what was discussed and concluded\n"
    "Do not include any text outside the JSON object."
)


def _point_id(*parts: str) -> str:
    return str(uuid.uuid5(_NS, "::".join(parts)))


def _render_conversation(messages: list[dict]) -> str:
    lines = []
    for m in messages:
        role = m.get("role", "user")
        content = str(m.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    return "\n".join(lines)


def _parse_json_object(text: str) -> dict[str, Any]:
    """Extract the first JSON object from a model reply, tolerating code fences."""
    if not text:
        return {}
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else None
    if candidate is None:
        start, end = text.find("{"), text.rfind("}")
        candidate = text[start : end + 1] if start != -1 and end > start else text
    try:
        parsed = json.loads(candidate)
        return parsed if isinstance(parsed, dict) else {}
    except json.JSONDecodeError:
        logger.warning("Memory extraction returned non-JSON; skipping.")
        return {}


class MemoryProcessor:
    """Stateless orchestrator (safe to instantiate per request or reuse)."""

    # ------------------------------------------------------------------ WRITE
    def process_conversation(
        self, user_id: str, conversation_id: str, messages: list[dict]
    ) -> dict[str, Any]:
        """Extract + persist memory for a conversation. Idempotent, best-effort."""
        result = {"processed": False, "facts": 0, "entities": 0, "topics": [], "reason": None}
        if not user_id or not messages:
            result["reason"] = "no user_id or messages"
            return result

        # Extraction is the only step allowed to abort processing (no data → nothing to store).
        try:
            reply = gateway_chat.chat(
                [{"role": "system", "content": _EXTRACTION_SYSTEM_PROMPT},
                 {"role": "user", "content": _render_conversation(messages)}],
                temperature=0,
            )
        except gateway_chat.GatewayError as error:
            logger.warning("Memory extraction gateway call failed: %s", error)
            result["reason"] = f"extraction failed: {error}"
            return result

        extracted = _parse_json_object(reply.content)
        if not extracted:
            result["reason"] = "empty extraction"
            return result

        facts = [f for f in (extracted.get("facts") or []) if isinstance(f, str) and f.strip()]
        entities = [e for e in (extracted.get("entities") or []) if isinstance(e, dict) and e.get("name")]
        topics = [t for t in (extracted.get("topics") or []) if isinstance(t, str) and t.strip()]
        summary = (extracted.get("summary") or "").strip()
        style = extracted.get("style") if isinstance(extracted.get("style"), dict) else None

        # Idempotency guard for the *accumulators*: only fold style + topics once
        # per new message batch. Vector upserts below are safe to repeat because
        # they use deterministic IDs.
        already = profile_store.get_processed_count(conversation_id)
        apply_accumulators = len(messages) > already

        self._store_facts(user_id, conversation_id, facts)
        self._store_entities(user_id, entities)
        if summary:
            self._store_summary(user_id, conversation_id, summary, topics)

        if apply_accumulators:
            if style:
                try:
                    profile_store.save_style_profile(user_id, self._normalize_style(style))
                except Exception as error:  # noqa: BLE001
                    logger.warning("Style profile merge failed: %s", error)
            try:
                profile_store.increment_topics(user_id, topics)
            except Exception as error:  # noqa: BLE001
                logger.warning("Topic affinity update failed: %s", error)

        try:
            profile_store.mark_processed(
                conversation_id=conversation_id, user_id=user_id,
                message_count=len(messages), facts_extracted=len(facts), topics=topics,
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("Marking conversation processed failed: %s", error)

        result.update({"processed": True, "facts": len(facts), "entities": len(entities),
                        "topics": topics, "summary": summary,
                        "accumulators_applied": apply_accumulators})
        return result

    def _store_facts(self, user_id: str, conversation_id: str, facts: list[str]) -> None:
        for fact in facts:
            try:
                vector = embed_text_sync(fact)
            except EmbeddingError as error:
                logger.warning("Embedding a fact failed, skipping it: %s", error)
                continue
            vector_store.upsert(
                "user_memories",
                _point_id(user_id, conversation_id, fact),
                vector,
                {"user_id": user_id, "type": "fact", "content": fact,
                 "conversation_id": conversation_id},
            )

    def _store_entities(self, user_id: str, entities: list[dict]) -> None:
        for entity in entities:
            name = str(entity.get("name") or "").strip()
            description = str(entity.get("description") or "").strip()
            if not name:
                continue
            point_id = _point_id(user_id, "entity", name.lower())
            merged_description = self._merge_entity_description(point_id, description)
            try:
                vector = embed_text_sync(f"{name}: {merged_description}")
            except EmbeddingError as error:
                logger.warning("Embedding entity '%s' failed, skipping: %s", name, error)
                continue
            vector_store.upsert(
                "user_entities", point_id, vector,
                {"user_id": user_id, "name": name, "description": merged_description},
            )

    def _merge_entity_description(self, point_id: str, new_description: str) -> str:
        """If the entity already exists, keep the richer description."""
        try:
            existing = vector_store.retrieve("user_entities", point_id)
        except Exception:  # noqa: BLE001
            existing = None
        if not existing:
            return new_description
        old = str((existing.get("payload") or {}).get("description") or "")
        if not new_description:
            return old
        if new_description.lower() in old.lower():
            return old
        if old.lower() in new_description.lower():
            return new_description
        return f"{old} {new_description}".strip()

    def _store_summary(self, user_id: str, conversation_id: str, summary: str, topics: list[str]) -> None:
        try:
            vector = embed_text_sync(summary)
        except EmbeddingError as error:
            logger.warning("Embedding summary failed, skipping: %s", error)
            return
        vector_store.upsert(
            "user_summaries",
            _point_id(user_id, "summary", conversation_id),
            vector,
            {"user_id": user_id, "conversation_id": conversation_id,
             "content": summary, "topics": topics},
        )

    @staticmethod
    def _normalize_style(style: dict) -> dict:
        """Coerce the model's free-form style object into our stored vocabulary."""
        level = str(style.get("technical_level") or "").lower()
        if level not in ("beginner", "intermediate", "advanced"):
            level = "intermediate"
        return {
            "prefers_concise": bool(style.get("prefers_concise", False)),
            "prefers_examples": bool(style.get("prefers_examples", True)),
            "technical_level": level,
            "preferred_language": str(style.get("preferred_language") or "english").lower(),
        }

    # ------------------------------------------------------------------- READ
    def retrieve_relevant_memories(
        self, user_id: str, current_message: str, limit: int = 5
    ) -> MemoryContext:
        """Fetch the most relevant memory for ``current_message``. Best-effort, fast.

        The dominant cost is the single embed round-trip to the gateway; the
        three Qdrant reads + the SQLite style fetch then run concurrently in a
        thread pool (target < 150ms total).
        """
        if not user_id or not current_message:
            return MemoryContext()
        try:
            query_vector = embed_text_sync(current_message)
        except EmbeddingError as error:
            logger.warning("Query embedding failed; proceeding without memory: %s", error)
            return MemoryContext()

        def _facts():
            return vector_store.search("user_memories", query_vector, user_id,
                                       limit=limit, score_threshold=FACT_SIMILARITY_THRESHOLD)

        def _summaries():
            return vector_store.search("user_summaries", query_vector, user_id, limit=SUMMARY_LIMIT)

        def _entities():
            return vector_store.search("user_entities", query_vector, user_id,
                                       limit=ENTITY_LIMIT, score_threshold=ENTITY_SIMILARITY_THRESHOLD)

        def _style():
            return profile_store.get_style_profile(user_id)

        try:
            with ThreadPoolExecutor(max_workers=4) as pool:
                f_facts = pool.submit(_facts)
                f_summaries = pool.submit(_summaries)
                f_entities = pool.submit(_entities)
                f_style = pool.submit(_style)
                fact_hits, summary_hits, entity_hits, style = (
                    f_facts.result(), f_summaries.result(), f_entities.result(), f_style.result()
                )
        except Exception as error:  # noqa: BLE001
            logger.warning("Parallel memory retrieval failed: %s", error)
            return MemoryContext()

        return MemoryContext(
            relevant_facts=[h["payload"].get("content", "") for h in fact_hits if h["payload"].get("content")],
            relevant_summaries=[h["payload"].get("content", "") for h in summary_hits if h["payload"].get("content")],
            relevant_entities=[
                {"name": h["payload"].get("name", ""), "description": h["payload"].get("description", "")}
                for h in entity_hits if h["payload"].get("name")
            ],
            style_profile=style,
        )

    # ----------------------------------------------------------------- FORMAT
    def build_memory_injection(self, ctx: MemoryContext) -> str:
        """Render a MemoryContext into the system-prompt injection block."""
        if ctx.is_empty:
            return ""
        parts = ["[Noor Memory Context]"]

        if ctx.relevant_facts:
            parts.append("About this user:")
            parts.extend(f"- {fact}" for fact in ctx.relevant_facts)

        if ctx.style_profile:
            sp = ctx.style_profile
            descriptors = []
            descriptors.append("concise answers" if sp.get("prefers_concise") else "thorough answers")
            if sp.get("prefers_examples"):
                descriptors.append("with examples")
            style_line = (
                f"\nTheir communication style: They prefer {' '.join(descriptors)}. "
                f"Technical level: {sp.get('technical_level', 'intermediate')}. "
                f"Preferred language: {sp.get('preferred_language', 'english')}."
            )
            parts.append(style_line)

        if ctx.relevant_summaries:
            parts.append("\nRelevant context from past conversations:")
            parts.extend(ctx.relevant_summaries)

        if ctx.relevant_entities:
            parts.append("\nKnown projects/entities:")
            parts.extend(f"- {e['name']}: {e['description']}" for e in ctx.relevant_entities)

        parts.append(
            "\nUse this context to personalize your response. Do not explicitly "
            "mention that you remember these things unless asked. Just use the "
            "context naturally."
        )
        return "\n".join(parts)
