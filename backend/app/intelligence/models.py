"""Internal value objects for the intelligence layer.

These are plain dataclasses used *inside* the backend (between MemoryProcessor,
TokenReducer, and IntelligentRequestHandler). API request/response models
(Pydantic) live in ``backend.app.schemas`` and are added in the routes phase —
keeping wire schemas in one place, per the existing project convention.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class MemoryContext:
    """Everything retrieved about a user before assembling their prompt."""

    relevant_facts: list[str] = field(default_factory=list)
    relevant_summaries: list[str] = field(default_factory=list)
    relevant_entities: list[dict[str, Any]] = field(default_factory=list)
    style_profile: dict[str, Any] | None = None

    @property
    def memory_count(self) -> int:
        return (
            len(self.relevant_facts)
            + len(self.relevant_summaries)
            + len(self.relevant_entities)
        )

    @property
    def is_empty(self) -> bool:
        return self.memory_count == 0 and not self.style_profile


@dataclass
class ReductionResult:
    """Outcome of TokenReducer.reduce — the optimized prompt plus honest accounting."""

    optimized_messages: list[dict]
    original_token_estimate: int
    optimized_token_estimate: int
    tokens_saved: int
    reduction_percentage: float
    levels_applied: list[str]
    cache_hit: bool
    cached_response: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "optimized_messages": self.optimized_messages,
            "original_token_estimate": self.original_token_estimate,
            "optimized_token_estimate": self.optimized_token_estimate,
            "tokens_saved": self.tokens_saved,
            "reduction_percentage": self.reduction_percentage,
            "levels_applied": self.levels_applied,
            "cache_hit": self.cache_hit,
        }


@dataclass
class HandlerResult:
    """Final result of IntelligentRequestHandler.handle_message."""

    content: str
    cache_result: str          # "HIT" | "MISS" | "OFF" (BYOK bypasses Noor's cache)
    memories_used: int
    tokens_saved: int
    cost_saved_usd: float
    model_used: str
    levels_applied: list[str] = field(default_factory=list)
    byok_provider: str | None = None   # set when the user's own key served this

    def savings_headers(self) -> dict[str, str]:
        """The x-noor-* headers the route layer attaches to the HTTP response."""
        return {
            "x-noor-memory-used": str(self.memories_used),
            "x-noor-tokens-saved": str(self.tokens_saved),
            "x-noor-cost-saved": f"{self.cost_saved_usd:.8f}",
            "x-noor-cache-result": self.cache_result,
            "x-noor-byok": self.byok_provider or "off",
        }
