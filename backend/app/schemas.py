from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    gem_id: str = "general"
    conversation_id: str | None = None
    user_id: str = "local_user"
    # "noor-auto" (default, routed + cached) or a BYOK id like
    # "anthropic:claude-sonnet-4-5" — see GET /api/models.
    model: str | None = Field(default=None, max_length=80)


class ChatResponse(BaseModel):
    gem_id: str
    gem_name: str
    message: str
    response: str
    conversation_id: str
    provider: str
    model: str


class GemInfo(BaseModel):
    name: str
    description: str
    category: str


class GemsResponse(BaseModel):
    gems: dict[str, GemInfo]


class MessageInfo(BaseModel):
    id: int
    role: str
    content: str
    created_at: str


class ConversationMessagesResponse(BaseModel):
    conversation_id: str
    messages: list[MessageInfo]


class ConversationInfo(BaseModel):
    conversation_id: str
    user_id: str
    title: str
    gem_id: str
    last_message_at: str


class ConversationsResponse(BaseModel):
    conversations: list[ConversationInfo]


class RenameConversationRequest(BaseModel):
    title: str = Field(min_length=1, max_length=100)
    user_id: str = "local_user"


class RenameConversationResponse(BaseModel):
    conversation_id: str
    title: str


class DeleteConversationResponse(BaseModel):
    conversation_id: str
    deleted: bool


class MockGoogleLoginRequest(BaseModel):
    email: str = Field(min_length=3)
    name: str = Field(min_length=1)
    avatar_url: str | None = None


class UserResponse(BaseModel):
    user_id: str
    email: str
    name: str
    avatar_url: str | None
    provider: str

class GoogleLoginRequest(BaseModel):
    credential: str = Field(min_length=10)


class SessionResponse(BaseModel):
    """Whoami payload for GET /auth/me — lets the frontend detect session state."""

    authenticated: bool
    enforce: bool
    user_id: str | None = None
    provider: str | None = None
    email: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    is_guest: bool = False


# ---------------------------------------------------------------------------
# Noor Intelligence Layer — memory-aware chat, memory management, savings
# ---------------------------------------------------------------------------
class IntelligentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=32_000)
    gem_id: str = "general"
    conversation_id: str | None = None
    user_id: str = "local_user"
    model: str | None = Field(default=None, max_length=80)


class IntelligentChatResponse(BaseModel):
    conversation_id: str
    gem_id: str
    gem_name: str
    message: str
    response: str
    model: str
    # "OFF" when a user-supplied key bypassed Noor's semantic cache.
    cache_result: str            # "HIT" | "MISS" | "OFF"
    byok_provider: str | None = None
    memories_used: int
    tokens_saved: int
    cost_saved_usd: float
    levels_applied: list[str] = Field(default_factory=list)
    intelligence_enabled: bool


class MemoryFactItem(BaseModel):
    id: str
    content: str
    conversation_id: str | None = None


class MemoryEntityItem(BaseModel):
    name: str
    description: str = ""


class MemorySummaryItem(BaseModel):
    content: str
    topics: list[str] = Field(default_factory=list)
    conversation_id: str | None = None


class TopicItem(BaseModel):
    topic: str
    count: int


class MemoryCounts(BaseModel):
    facts: int
    entities: int
    summaries: int


class MemorySnapshotResponse(BaseModel):
    user_id: str
    facts: list[MemoryFactItem]
    entities: list[MemoryEntityItem]
    summaries: list[MemorySummaryItem]
    style_profile: dict | None = None
    topics: list[TopicItem]
    counts: MemoryCounts


class MemoryFactsResponse(BaseModel):
    user_id: str
    facts: list[MemoryFactItem]
    count: int


class DeleteMemoryResponse(BaseModel):
    user_id: str
    deleted: bool
    facts_deleted: int
    entities_deleted: int
    summaries_deleted: int


class ProcessMemoryRequest(BaseModel):
    user_id: str = "local_user"
    conversation_id: str = Field(min_length=1)


class ProcessMemoryResponse(BaseModel):
    processed: bool
    facts: int = 0
    entities: int = 0
    topics: list[str] = Field(default_factory=list)
    accumulators_applied: bool | None = None
    reason: str | None = None


class DailySavingsItem(BaseModel):
    date: str
    tokens_saved: int


class SavingsResponse(BaseModel):
    user_id: str
    total_tokens_saved: int
    total_cost_saved_usd: float
    total_cache_hits: int
    total_requests: int
    cache_hit_rate: float
    daily: list[DailySavingsItem]
    top_topics: list[TopicItem]


class RateMessageRequest(BaseModel):
    """Thumbs feedback on an assistant turn. ``rating`` is +1 (up) / -1 (down);
    it is normalized to its sign server-side and 0 is rejected."""

    conversation_id: str = Field(min_length=1)
    rating: int
    message_id: int | None = None
    comment: str | None = Field(default=None, max_length=2000)
    user_id: str = "local_user"


class RateMessageResponse(BaseModel):
    recorded: bool
    conversation_id: str
    message_id: int | None = None
    rating: int


# ---------------------------------------------------------------------------
# Performance — Core Web Vitals telemetry (SYSTEM 2; see backend/app/vitals.py)
# ---------------------------------------------------------------------------
class WebVitalReport(BaseModel):
    """A single Core Web Vital reported by the browser (useReportWebVitals)."""

    name: str = Field(min_length=1, max_length=32)   # LCP | INP | CLS | FCP | TTFB | FID
    value: float
    rating: str | None = None                        # good | needs-improvement | poor
    id: str | None = None
    delta: float | None = None
    navigation_type: str | None = None
    path: str | None = None                          # route the sample was measured on


class VitalMetricSummary(BaseModel):
    name: str
    count: int
    p75: float                                       # Core Web Vitals aggregate at the 75th pct
    rating: str | None = None


class VitalsSummaryResponse(BaseModel):
    metrics: list[VitalMetricSummary]

# ---------------------------------------------------------------------------
# BYOK — bring-your-own-key models (see backend/app/byok_api.py)
# ---------------------------------------------------------------------------
class ModelInfo(BaseModel):
    id: str                       # "noor-auto" | "anthropic:claude-sonnet-4-5"
    label: str
    provider: str
    provider_label: str
    requires_key: bool
    available: bool               # False => user must add a key first
    default: bool = False


class ModelsResponse(BaseModel):
    models: list[ModelInfo]
    default_model: str = "noor-auto"
    byok_enabled: bool = True


class ByokKeyRequest(BaseModel):
    """A provider credential. Constrained so garbage never reaches the vendor."""

    api_key: str = Field(min_length=20, max_length=200)
    model: str | None = Field(default=None, max_length=80)


class ByokKeyInfo(BaseModel):
    provider: str
    label: str
    model: str | None = None
    hint: str                     # masked, e.g. "sk-a…9f2c" — never the key
    created_at: str | None = None
    updated_at: str | None = None
    last_verified_at: str | None = None
    last_used_at: str | None = None


class ByokListResponse(BaseModel):
    keys: list[ByokKeyInfo]
    max_keys: int
    providers: list["ByokProviderInfo"]


class ByokProviderInfo(BaseModel):
    id: str
    label: str
    docs_url: str
    models: list[ModelInfo]


class ByokKeyResponse(BaseModel):
    provider: str
    model: str | None = None
    hint: str
    verified: bool
    message: str | None = None


class ByokTestResponse(BaseModel):
    provider: str
    ok: bool
    message: str


class DeleteByokKeyResponse(BaseModel):
    provider: str
    deleted: bool
