"""TokenReducer — the four-level prompt-shrinking engine.

Pure optimization: it takes a messages array and returns a smaller one plus
honest accounting. It never generates the final answer and never writes to the
database — that orchestration belongs to IntelligentRequestHandler. Keeping the
reducer side-effect-free makes the savings numbers auditable.

Levels, cheapest first:
  1. cache hit      — gateway semantic cache probe (zero tokens on hit)
  2. context inject  — swap raw history for targeted retrieved memory
  3. history compress — summarize everything older than the last 4 turns
  4. smart truncation — last resort hard cap
"""
from __future__ import annotations

import logging
from typing import Optional

from backend.app.intelligence import gateway_chat
from backend.app.intelligence.memory import MemoryProcessor
from backend.app.intelligence.models import ReductionResult

logger = logging.getLogger("noor.intelligence.token_reducer")

DEFAULT_COMPRESS_THRESHOLD = 3000
DEFAULT_MAX_TOKENS = 4000
KEEP_RECENT = 4  # raw turns always preserved verbatim

_COMPRESSION_SYSTEM_PROMPT = (
    "Compress this conversation history into a dense factual summary under 150 "
    "words. Preserve: all conclusions reached, all code written, all decisions "
    "made, all preferences expressed. Discard: pleasantries, repeated attempts, "
    "abandoned approaches. Return only the summary text."
)


class TokenReducer:
    def __init__(self, memory_processor: Optional[MemoryProcessor] = None):
        self.memory = memory_processor or MemoryProcessor()

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def estimate_tokens(messages: list[dict]) -> int:
        """Rough estimate — ~1 token per 4 characters, plus per-message overhead."""
        total = 0
        for m in messages:
            total += len(str(m.get("content") or "")) // 4 + 4  # +4 ≈ role/format tokens
        return total

    def should_compress(self, messages: list[dict], threshold: int = DEFAULT_COMPRESS_THRESHOLD) -> bool:
        return self.estimate_tokens(messages) > threshold

    # ----------------------------------------------------------------- levels
    def level1_cache_hit(self, message: str) -> dict:
        result = gateway_chat.cache_lookup(message)
        return {"hit": result.hit, "similarity": result.similarity,
                "cached_response": result.cached_response}

    def level2_context_injection(self, user_id: str, message: str, full_history: list[dict]) -> list[dict]:
        """Replace raw history with a compact memory-context system message.

        Falls back to the original history untouched if nothing relevant is
        retrieved — never fabricate context.
        """
        ctx = self.memory.retrieve_relevant_memories(user_id, message)
        injection = self.memory.build_memory_injection(ctx)
        if not injection:
            return full_history
        return [{"role": "system", "content": injection},
                {"role": "user", "content": message}]

    def level3_history_compression(self, messages: list[dict]) -> list[dict]:
        """Compress messages older than the last KEEP_RECENT turns into one summary."""
        if len(messages) <= KEEP_RECENT:
            return messages
        older, recent = messages[:-KEEP_RECENT], messages[-KEEP_RECENT:]
        rendered = "\n".join(
            f"{m.get('role', 'user')}: {m.get('content', '')}" for m in older
        )
        try:
            reply = gateway_chat.chat(
                [{"role": "system", "content": _COMPRESSION_SYSTEM_PROMPT},
                 {"role": "user", "content": rendered}],
                temperature=0,
            )
            summary = reply.content.strip()
        except gateway_chat.GatewayError as error:
            logger.warning("History compression failed; keeping raw history: %s", error)
            return messages
        if not summary:
            return messages
        return [{"role": "system", "content": f"[Compressed Context]: {summary}"}, *recent]

    def level4_smart_truncation(self, messages: list[dict], max_tokens: int = DEFAULT_MAX_TOKENS) -> list[dict]:
        """Last resort: drop oldest messages until under the cap, leaving a note."""
        if self.estimate_tokens(messages) <= max_tokens:
            return messages
        kept = list(messages)
        removed: list[dict] = []
        # Never drop the final message (the live user turn).
        while len(kept) > 1 and self.estimate_tokens(kept) > max_tokens:
            removed.append(kept.pop(0))
        if not removed:
            return messages
        note = self._truncation_note(removed)
        return [{"role": "system", "content": note}, *kept]

    @staticmethod
    def _truncation_note(removed: list[dict]) -> str:
        topics = ", ".join(
            str(m.get("content") or "")[:40].replace("\n", " ") for m in removed[:3]
        )
        return f"Earlier conversation was truncated. Key context: {topics}"

    # --------------------------------------------------------------- pipeline
    def reduce(self, user_id: str, messages: list[dict]) -> ReductionResult:
        """Apply all four levels in sequence and report honest savings."""
        original_estimate = self.estimate_tokens(messages)
        levels_applied: list[str] = []

        last_user = next(
            (m.get("content", "") for m in reversed(messages) if m.get("role") == "user"),
            messages[-1].get("content", "") if messages else "",
        )

        # Level 1 — cache probe. A hit short-circuits everything downstream.
        cache = self.level1_cache_hit(last_user)
        if cache["hit"]:
            levels_applied.append("level1_cache_hit")
            return ReductionResult(
                optimized_messages=messages,
                original_token_estimate=original_estimate,
                optimized_token_estimate=0,          # nothing sent to the model
                tokens_saved=original_estimate,
                reduction_percentage=100.0,
                levels_applied=levels_applied,
                cache_hit=True,
                cached_response=cache["cached_response"],
            )

        optimized = messages

        # Level 2 — targeted memory instead of raw history.
        injected = self.level2_context_injection(user_id, last_user, optimized)
        if injected is not optimized:
            optimized = injected
            levels_applied.append("level2_context_injection")

        # Level 3 — compress old turns (only if still large).
        if self.should_compress(optimized):
            compressed = self.level3_history_compression(optimized)
            if compressed is not optimized:
                optimized = compressed
                levels_applied.append("level3_history_compression")

        # Level 4 — hard cap fallback.
        if self.estimate_tokens(optimized) > DEFAULT_MAX_TOKENS:
            truncated = self.level4_smart_truncation(optimized)
            if truncated is not optimized:
                optimized = truncated
                levels_applied.append("level4_smart_truncation")

        optimized_estimate = self.estimate_tokens(optimized)
        tokens_saved = max(0, original_estimate - optimized_estimate)
        reduction_pct = (tokens_saved / original_estimate * 100.0) if original_estimate else 0.0

        return ReductionResult(
            optimized_messages=optimized,
            original_token_estimate=original_estimate,
            optimized_token_estimate=optimized_estimate,
            tokens_saved=tokens_saved,
            reduction_percentage=round(reduction_pct, 2),
            levels_applied=levels_applied,
            cache_hit=False,
        )
