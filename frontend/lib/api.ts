// Typed client for the Noor AI FastAPI backend.
// Every shape here mirrors backend/app/schemas.py exactly.

const API_BASE = (process.env.NEXT_PUBLIC_NOOR_API_BASE ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export type ApiGem = {
  name: string;
  description: string;
  category: string;
};

export type GemsResponse = {
  gems: Record<string, ApiGem>;
};

export type ChatResponse = {
  conversation_id: string;
  gem_id: string;
  gem_name: string;
  message: string;
  response: string;
  provider: string;
  model: string;
};

export type ConversationSummary = {
  conversation_id: string;
  user_id: string;
  title: string;
  gem_id: string;
  last_message_at: string;
};

export type ApiMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type NoorUser = {
  user_id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  provider: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      // Send/receive the HttpOnly session cookie so identity is server-bound.
      credentials: "include",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new Error("Cannot reach the Noor backend. Is it running on " + API_BASE + "?");
  }

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      if (body?.detail?.error) detail = body.detail.error;
      else if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      /* non-JSON error body — keep the generic message */
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export function fetchGems() {
  return request<GemsResponse>("/gems");
}

export function sendChat(params: {
  message: string;
  gemId: string;
  userId: string;
  conversationId?: string;
}) {
  return request<ChatResponse>("/chat", {
    method: "POST",
    body: JSON.stringify({
      message: params.message,
      gem_id: params.gemId,
      user_id: params.userId,
      conversation_id: params.conversationId ?? null,
    }),
  });
}

export async function listConversations(userId: string) {
  const data = await request<{ conversations: ConversationSummary[] }>(
    `/conversations?user_id=${encodeURIComponent(userId)}`,
  );
  return data.conversations;
}

export async function fetchMessages(conversationId: string, userId: string) {
  const data = await request<{ conversation_id: string; messages: ApiMessage[] }>(
    `/conversations/${encodeURIComponent(conversationId)}/messages?user_id=${encodeURIComponent(userId)}`,
  );
  return data.messages;
}

export function renameConversation(conversationId: string, title: string, userId: string) {
  return request<{ conversation_id: string; title: string }>(
    `/conversations/${encodeURIComponent(conversationId)}`,
    { method: "PATCH", body: JSON.stringify({ title, user_id: userId }) },
  );
}

export function deleteConversationApi(conversationId: string, userId: string) {
  return request<{ conversation_id: string; deleted: boolean }>(
    `/conversations/${encodeURIComponent(conversationId)}?user_id=${encodeURIComponent(userId)}`,
    { method: "DELETE" },
  );
}

export function googleLogin(credential: string) {
  return request<NoorUser>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
}

// ---------------------------------------------------------------------------
// Session: identity is bound to a server-signed HttpOnly cookie (see backend
// auth.py). Google sign-in sets it automatically; guests get a signed guest id.
// ---------------------------------------------------------------------------
export type SessionInfo = {
  authenticated: boolean;
  enforce: boolean;
  user_id: string | null;
  provider: string | null;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  is_guest: boolean;
};

// Establish a signed guest session cookie if the caller has none. Idempotent —
// returns the existing session's identity when one is already present.
export function ensureGuestSession() {
  return request<NoorUser>("/auth/guest", { method: "POST" });
}

export function getSession() {
  return request<SessionInfo>("/auth/me");
}

export function logout() {
  return request<{ ok: boolean }>("/auth/logout", { method: "POST" });
}

export type UsageInfo = {
  date: string;
  used: number;
  limit: number;
  remaining: number | null;
  max_concurrent: number;
};

export function fetchUsage(userId: string) {
  return request<UsageInfo>(`/api/usage?user_id=${encodeURIComponent(userId)}`);
}

// ---------------------------------------------------------------------------
// Performance — Core Web Vitals reporting (SYSTEM 2). Fire-and-forget: uses
// keepalive so the POST survives a navigation/unload, and never throws into the
// app. Vitals are anonymous telemetry, so we don't send credentials.
// ---------------------------------------------------------------------------
export function reportWebVital(metric: {
  name: string;
  value: number;
  rating?: string;
  id?: string;
  delta?: number;
  navigationType?: string;
  path?: string;
}) {
  try {
    const body = JSON.stringify({
      name: metric.name,
      value: metric.value,
      rating: metric.rating ?? null,
      id: metric.id ?? null,
      delta: metric.delta ?? null,
      navigation_type: metric.navigationType ?? null,
      path:
        metric.path ??
        (typeof window !== "undefined" ? window.location.pathname : null),
    });
    void fetch(`${API_BASE}/api/vitals`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body,
    }).catch(() => {
      /* telemetry is best-effort — swallow network errors */
    });
  } catch {
    /* never let reporting surface as an app error */
  }
}

// ---------------------------------------------------------------------------
// Noor Intelligence Layer — memory-aware chat, memory, and savings
// ---------------------------------------------------------------------------
export type IntelligentChatResponse = {
  conversation_id: string;
  gem_id: string;
  gem_name: string;
  message: string;
  response: string;
  model: string;
  cache_result: string; // "HIT" | "MISS"
  memories_used: number;
  tokens_saved: number;
  cost_saved_usd: number;
  levels_applied: string[];
  intelligence_enabled: boolean;
};

export type MemoryFact = { id: string; content: string; conversation_id: string | null };
export type MemoryEntity = { name: string; description: string };
export type MemorySummary = { content: string; topics: string[]; conversation_id: string | null };
export type TopicItem = { topic: string; count: number };
export type StyleProfile = {
  prefers_concise: boolean;
  prefers_examples: boolean;
  technical_level: string;
  preferred_language: string;
  response_length_preference: string;
  updated_at?: string;
} | null;

export type MemorySnapshot = {
  user_id: string;
  facts: MemoryFact[];
  entities: MemoryEntity[];
  summaries: MemorySummary[];
  style_profile: StyleProfile;
  topics: TopicItem[];
  counts: { facts: number; entities: number; summaries: number };
};

export type DailySavings = { date: string; tokens_saved: number };
export type SavingsSummary = {
  user_id: string;
  total_tokens_saved: number;
  total_cost_saved_usd: number;
  total_cache_hits: number;
  total_requests: number;
  cache_hit_rate: number;
  daily: DailySavings[];
  top_topics: TopicItem[];
};

// Memory-aware chat. Returns the answer plus honest per-response savings.
export function sendIntelligentChat(params: {
  message: string;
  gemId: string;
  userId: string;
  conversationId?: string;
  /** "noor-auto" (default) or a BYOK id such as "anthropic:claude-sonnet-4-5". */
  model?: string;
}) {
  return request<IntelligentChatResponse>("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      message: params.message,
      gem_id: params.gemId,
      user_id: params.userId,
      conversation_id: params.conversationId ?? null,
      model: params.model ?? undefined,
    }),
  });
}

export function fetchMemory(userId: string) {
  return request<MemorySnapshot>(`/api/memory?user_id=${encodeURIComponent(userId)}`);
}

export function fetchMemoryFacts(userId: string) {
  return request<{ user_id: string; facts: MemoryFact[]; count: number }>(
    `/api/memory/facts?user_id=${encodeURIComponent(userId)}`,
  );
}

export function deleteMemory(userId: string) {
  return request<{
    user_id: string;
    deleted: boolean;
    facts_deleted: number;
    entities_deleted: number;
    summaries_deleted: number;
  }>(`/api/memory?user_id=${encodeURIComponent(userId)}`, { method: "DELETE" });
}

export function fetchSavings(userId: string, days = 30) {
  return request<SavingsSummary>(
    `/api/savings?user_id=${encodeURIComponent(userId)}&days=${days}`,
  );
}

export function processMemory(userId: string, conversationId: string) {
  return request<{
    processed: boolean;
    facts: number;
    entities: number;
    topics: string[];
    accumulators_applied: boolean | null;
    reason: string | null;
  }>("/api/memory/process", {
    method: "POST",
    body: JSON.stringify({ user_id: userId, conversation_id: conversationId }),
  });
}

// ---------------------------------------------------------------------------
// Ratings — thumbs feedback on an assistant turn (POST /api/chat/rate).
// Ownership is enforced server-side; message_id is optional (null records the
// rating at the conversation level). Mirrors RateMessage* in schemas.py.
// ---------------------------------------------------------------------------
export type RateMessageResult = {
  recorded: boolean;
  conversation_id: string;
  message_id: number | null;
  rating: number;
};

export function rateMessage(params: {
  conversationId: string;
  rating: 1 | -1;
  userId: string;
  messageId?: number | null;
  comment?: string | null;
}) {
  return request<RateMessageResult>("/api/chat/rate", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: params.conversationId,
      rating: params.rating,
      message_id: params.messageId ?? null,
      comment: params.comment ?? null,
      user_id: params.userId,
    }),
  });
}

// ---------------------------------------------------------------------------
// Admin Intelligence Dashboard — read-only analytics (GET /api/admin/*).
// Every call carries the signed session cookie (credentials:"include" in
// request()), so identity is server-verified; access is gated by the backend
// allowlist or loopback. Shapes mirror backend/app/admin_store.py exactly.
// ---------------------------------------------------------------------------
export type AdminWhoami = {
  admin: boolean;
  granted_via: string;
  user_id: string;
  email: string | null;
  name: string | null;
  provider: string;
  enforce: boolean;
  allowlist: { emails: number; user_ids: number; allow_loopback: boolean };
};

export type AdminOverview = {
  total_requests: number;
  active_users: number;
  registered_users: number;
  total_conversations: number;
  total_messages: number;
  total_tokens_saved: number;
  total_cost_saved_usd: number;
  cache_hits: number;
  cache_lookups: number;
  cache_hit_rate: number;
  avg_latency_ms: number | null;
  ratings_up: number;
  ratings_down: number;
};

export type AdminRequestRow = {
  id: string;
  user_id: string;
  conversation_id: string;
  gem_id: string | null;
  source: string;
  question: string | null;
  response: string | null;
  provider: string | null;
  model: string | null;
  task_type: string | null;
  cache_result: string | null;
  memories_used: number;
  tokens_saved: number;
  cost_saved_usd: number;
  latency_ms: number | null;
  created_at: string;
};

export type AdminUserRow = {
  user_id: string;
  requests: number;
  last_active: string;
  tokens_saved: number;
  cost_saved_usd: number;
  cache_hits: number;
  email: string | null;
  name: string | null;
  provider: string | null;
};

export type AdminTimeseriesPoint = {
  date: string;
  requests: number;
  tokens_saved: number;
  cost_saved_usd: number;
  cache_hits: number;
};

export type AdminEvent = {
  id: string;
  event_type: string;
  severity: string;
  user_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

export type AdminRatingRow = {
  user_id: string;
  conversation_id: string;
  message_id: number | null;
  rating: number;
  comment: string | null;
  updated_at: string;
};

export type AdminRatingsSummary = {
  up: number;
  down: number;
  total: number;
  recent: AdminRatingRow[];
};

// Mirrors the gateway's cacheHealthReport() (proxied server-side). The outer
// `health` is the full report; its nested `health` is the derived score block.
export type AdminCacheReport = {
  service?: string;
  tenantId?: string;
  backend?: { mode?: string; status?: string; error?: string | null; collection?: string | null };
  health?: { status?: string; score?: number | null; signals?: string[] };
  policy?: Record<string, unknown>;
  distribution?: Record<string, unknown>;
  stats?: Record<string, unknown>;
};

export type AdminCacheResponse =
  | { reachable: true; health: AdminCacheReport }
  | { reachable: false; error: string; base_url?: string };

export function fetchAdminWhoami() {
  return request<AdminWhoami>("/api/admin/whoami");
}

export function fetchAdminOverview() {
  return request<AdminOverview>("/api/admin/overview");
}

export function fetchAdminRequests(params: { limit?: number; offset?: number; userId?: string } = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.offset != null) q.set("offset", String(params.offset));
  if (params.userId) q.set("user_id", params.userId);
  const qs = q.toString();
  return request<{ requests: AdminRequestRow[]; count: number; limit: number; offset: number }>(
    `/api/admin/requests${qs ? `?${qs}` : ""}`,
  );
}

export function fetchAdminUsers(limit = 100) {
  return request<{ users: AdminUserRow[]; count: number }>(`/api/admin/users?limit=${limit}`);
}

export function fetchAdminTimeseries(days = 30) {
  return request<{ days: number; series: AdminTimeseriesPoint[] }>(`/api/admin/timeseries?days=${days}`);
}

export function fetchAdminEvents(params: { limit?: number; eventType?: string } = {}) {
  const q = new URLSearchParams();
  if (params.limit != null) q.set("limit", String(params.limit));
  if (params.eventType) q.set("event_type", params.eventType);
  const qs = q.toString();
  return request<{ events: AdminEvent[]; count: number }>(`/api/admin/events${qs ? `?${qs}` : ""}`);
}

export function fetchAdminRatings(limit = 20) {
  return request<AdminRatingsSummary>(`/api/admin/ratings?limit=${limit}`);
}

export function fetchAdminCache() {
  return request<AdminCacheResponse>("/api/admin/cache");
}

// ---------------------------------------------------------------------------
// BYOK — model catalog + user-supplied provider keys
// ---------------------------------------------------------------------------
export type ModelInfo = {
  id: string;
  label: string;
  provider: string;
  provider_label: string;
  requires_key: boolean;
  available: boolean;
  default: boolean;
};

export type ModelsResponse = {
  models: ModelInfo[];
  default_model: string;
  byok_enabled: boolean;
};

export type ByokKey = {
  provider: string;
  label: string;
  model: string | null;
  hint: string;
  created_at: string | null;
  updated_at: string | null;
  last_verified_at: string | null;
  last_used_at: string | null;
};

export type ByokProviderInfo = {
  id: string;
  label: string;
  docs_url: string;
  models: ModelInfo[];
};

export type ByokListResponse = {
  keys: ByokKey[];
  max_keys: number;
  providers: ByokProviderInfo[];
};

export type ByokKeyResponse = {
  provider: string;
  model: string | null;
  hint: string;
  verified: boolean;
  message: string | null;
};

export function fetchModels() {
  return request<ModelsResponse>("/api/models");
}

export function fetchByokKeys() {
  return request<ByokListResponse>("/api/byok");
}

export function saveByokKey(provider: string, apiKey: string, model?: string) {
  return request<ByokKeyResponse>(`/api/byok/${encodeURIComponent(provider)}`, {
    method: "PUT",
    body: JSON.stringify({ api_key: apiKey, model: model ?? null }),
  });
}

export function deleteByokKey(provider: string) {
  return request<{ provider: string; deleted: boolean }>(
    `/api/byok/${encodeURIComponent(provider)}`,
    { method: "DELETE" },
  );
}

export function testByokKey(provider: string) {
  return request<{ provider: string; ok: boolean; message: string }>(
    `/api/byok/${encodeURIComponent(provider)}/test`,
    { method: "POST" },
  );
}
