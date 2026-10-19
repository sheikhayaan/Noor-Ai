"use client";

// Signed-in home base: everything the account has accumulated — history,
// savings, memory topics and attached model keys. Previously the only way to
// see any of this was to open Memory, which read like a settings page.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  BrainCircuit,
  Coins,
  KeyRound,
  Loader2,
  MessageSquare,
  PiggyBank,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";

import {
  ensureGuestSession,
  fetchAdminWhoami,
  fetchByokKeys,
  fetchSavings,
  getSession,
  listConversations,
  type AdminWhoami,
  type ByokKey,
  type ConversationSummary,
  type SavingsSummary,
} from "@/lib/api";

const USER_KEY = "noor.user.v2";
const GUEST_KEY = "noor.guest.v1";

type Identity = { userId: string; name: string | null; email: string | null; guest: boolean };

function readIdentity(): Identity {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { user_id?: string; name?: string; email?: string };
      if (parsed?.user_id) {
        return { userId: parsed.user_id, name: parsed.name ?? null, email: parsed.email ?? null, guest: false };
      }
    }
  } catch {
    /* fall through */
  }
  try {
    const guest = localStorage.getItem(GUEST_KEY);
    if (guest) return { userId: guest, name: "Guest", email: null, guest: true };
  } catch {
    /* fall through */
  }
  return { userId: "local_user", name: "Guest", email: null, guest: true };
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "neutral" | "good" | "cool";
}) {
  const tones = {
    neutral: "border-white/10 bg-white/[0.03]",
    good: "border-emerald-300/20 bg-emerald-300/[0.055]",
    cool: "border-cyan-300/20 bg-cyan-300/[0.055]",
  } as const;
  return (
    <div className={`rounded-2xl border p-4 ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-white/40">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
      {sub ? <p className="mt-1 text-[11px] text-white/38">{sub}</p> : null}
    </div>
  );
}

function SavingsChart({ daily }: { daily: { date: string; tokens_saved: number }[] }) {
  const max = Math.max(1, ...daily.map((day) => day.tokens_saved));
  if (!daily.length) {
    return (
      <p className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-xs text-white/35">
        No savings recorded yet. Ask the same kind of question twice — the second one comes from cache.
      </p>
    );
  }
  return (
    <div className="flex h-32 items-end gap-1.5">
      {daily.map((day) => {
        const height = Math.max(3, Math.round((day.tokens_saved / max) * 100));
        return (
          <div key={day.date} className="group relative flex flex-1 flex-col items-center justify-end gap-1.5">
            <span className="pointer-events-none absolute -top-7 hidden whitespace-nowrap rounded-md border border-white/10 bg-black/85 px-2 py-1 text-[10px] text-white/80 group-hover:block">
              {day.tokens_saved.toLocaleString()} tokens
            </span>
            <div
              className="w-full rounded-t-md bg-gradient-to-t from-cyan-300/25 to-cyan-200/70 transition group-hover:from-cyan-300/40"
              style={{ height: `${height}%` }}
            />
            <span className="text-[9px] text-white/25">{day.date.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [savings, setSavings] = useState<SavingsSummary | null>(null);
  const [keys, setKeys] = useState<ByokKey[]>([]);
  const [admin, setAdmin] = useState<AdminWhoami | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const local = readIdentity();
    setIdentity(local);

    void (async () => {
      // The signed session, not localStorage, is the source of truth. A cold
      // visit (or an expired cookie) would otherwise query with a stale local
      // id and come back 401 — an empty dashboard that looks like lost data.
      let userId = local.userId;
      try {
        const session = await getSession();
        if (session.authenticated && session.user_id) {
          userId = session.user_id;
          setIdentity({
            userId,
            name: session.name,
            email: session.email,
            guest: session.is_guest,
          });
        } else {
          const guest = await ensureGuestSession();
          userId = guest.user_id;
          setIdentity({ userId, name: null, email: null, guest: true });
        }
      } catch {
        // Backend unreachable: keep the local identity so the page still renders
        // and the error banner explains why the numbers are missing.
      }

      const results = await Promise.allSettled([
        listConversations(userId),
        fetchSavings(userId, 30),
        fetchByokKeys(),
        fetchAdminWhoami(),
      ]);

      if (results[0].status === "fulfilled") setConversations(results[0].value ?? []);
      if (results[1].status === "fulfilled") setSavings(results[1].value);
      else setError("Savings could not be loaded. Is the backend running on :8000?");

      if (results[2].status === "fulfilled") setKeys(results[2].value.keys ?? []);
      if (results[3].status === "fulfilled") setAdmin(results[3].value);
      setLoading(false);
    })();
  }, []);

  const totals = useMemo(() => {
    const tokens = savings?.total_tokens_saved ?? 0;
    return {
      tokens,
      usd: savings?.total_cost_saved_usd ?? 0,
      requests: savings?.total_requests ?? 0,
      hits: savings?.total_cache_hits ?? 0,
      hitRate: Math.round((savings?.cache_hit_rate ?? 0) * 100),
      topics: savings?.top_topics ?? [],
      daily: savings?.daily ?? [],
    };
  }, [savings]);

  // 30-day chart: pad the tail so a quiet week still renders as a timeline.
  const daily = useMemo(() => {
    const byDate = new Map(totals.daily.map((day) => [day.date, day.tokens_saved]));
    return Array.from({ length: 14 }, (_, index) => {
      const day = new Date();
      day.setDate(day.getDate() - (13 - index));
      const key = day.toISOString().slice(0, 10);
      return { date: key, tokens_saved: byDate.get(key) ?? 0 };
    });
  }, [totals.daily]);

  if (loading) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#08090b] text-white/45">
        <span className="flex items-center gap-2 text-sm">
          <Loader2 size={16} className="animate-spin" /> Loading your account…
        </span>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-[#08090b] text-white">
      <div className="pointer-events-none fixed -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-cyan-300/8 blur-[130px]" />

      <div className="relative mx-auto max-w-5xl px-5 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-200 text-slate-950">
              <Sparkles size={16} />
            </span>
            Noor AI
          </Link>
          <nav className="flex items-center gap-2 text-xs">
            <Link href="/chat" className="rounded-xl border border-white/10 px-3 py-2 text-white/70 hover:bg-white/[0.06]">
              Chat
            </Link>
            <Link href="/memory" className="rounded-xl border border-white/10 px-3 py-2 text-white/70 hover:bg-white/[0.06]">
              Memory
            </Link>
            <Link href="/why" className="rounded-xl border border-white/10 px-3 py-2 text-white/70 hover:bg-white/[0.06]">
              Why Noor
            </Link>
            {admin?.admin ? (
              <Link href="/admin" className="rounded-xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-emerald-100">
                Admin
              </Link>
            ) : null}
          </nav>
        </header>

        {/* Identity */}
        <section className="mt-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/35">Your account</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.02em]">
              {identity?.name ? `Welcome back, ${identity.name.split(" ")[0]}` : "Welcome back"}
            </h1>
            <p className="mt-1 text-sm text-white/45">
              {identity?.email ?? "Guest session · sign in to keep this history forever"}
            </p>
          </div>
          {identity?.guest ? (
            <Link
              href="/signin"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90"
            >
              Sign in to save <ArrowRight size={15} />
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1.5 text-[11px] text-emerald-100">
              <ShieldCheck size={12} /> Session encrypted · 30-day cookie
            </span>
          )}
        </section>

        {error && (
          <p className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
            {error}
          </p>
        )}

        {/* Money + tokens */}
        <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<PiggyBank size={13} />}
            label="Tokens saved"
            value={totals.tokens.toLocaleString()}
            sub="reused from cache & memory"
            tone="good"
          />
          <StatCard
            icon={<Coins size={13} />}
            label="Money saved"
            value={`$${totals.usd.toFixed(4)}`}
            sub="never billed to you"
            tone="good"
          />
          <StatCard
            icon={<Zap size={13} />}
            label="Cache hits"
            value={totals.hits.toLocaleString()}
            sub={`${totals.hitRate}% of ${totals.requests.toLocaleString()} requests`}
            tone="cool"
          />
          <StatCard
            icon={<MessageSquare size={13} />}
            label="Conversations"
            value={conversations.length.toLocaleString()}
            sub="all stored server-side"
          />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          {/* Chart */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-sm font-medium text-white/85">
                <BarChart3 size={15} className="text-cyan-200" /> Tokens saved · last 14 days
              </h2>
              <span className="text-[11px] text-white/30">hover a bar</span>
            </div>
            <SavingsChart daily={daily} />
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-white/30">
              <TrendingUp size={11} /> Savings grow as the cache learns your questions.
            </p>
          </section>

          {/* Keys + topics */}
          <div className="grid gap-4">
            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-white/85">
                <KeyRound size={15} className="text-violet-200" /> Your API keys
              </h2>
              {keys.length ? (
                <ul className="space-y-2">
                  {keys.map((key) => (
                    <li key={key.provider} className="flex items-center justify-between rounded-xl border border-white/8 bg-black/25 px-3 py-2">
                      <span className="text-xs text-white/75">{key.label}</span>
                      <span className="font-mono text-[11px] text-white/35">{key.hint}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs leading-5 text-white/40">
                  No keys attached — Noor Auto is paying for your calls.{" "}
                  <Link href="/chat" className="text-cyan-200 underline decoration-cyan-200/30 underline-offset-2">
                    Add one in the composer
                  </Link>
                  .
                </p>
              )}
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-white/85">
                <BrainCircuit size={15} className="text-cyan-200" /> What Noor learned
              </h2>
              {totals.topics.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {totals.topics.slice(0, 8).map((topic) => (
                    <span key={topic.topic} className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-white/65">
                      {topic.topic}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-white/40">Nothing yet — memory builds up after a few conversations.</p>
              )}
              <Link href="/memory" className="mt-3 inline-flex items-center gap-1 text-[11px] text-cyan-200/80 hover:text-cyan-100">
                Inspect or delete memory <ArrowRight size={11} />
              </Link>
            </section>
          </div>
        </div>

        {/* History */}
        <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium text-white/85">
              <MessageSquare size={15} className="text-cyan-200" /> Chat history
            </h2>
            <Link href="/chat" className="text-[11px] text-white/40 hover:text-white/70">
              Open chat →
            </Link>
          </div>

          {conversations.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-white/35">
              No conversations yet.{" "}
              <Link href="/chat" className="text-cyan-200">
                Start one
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-white/6">
              {conversations.slice(0, 20).map((conversation) => (
                <li key={conversation.conversation_id}>
                  <Link
                    href="/chat"
                    className="flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 transition hover:bg-white/[0.05]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-white/80">{conversation.title || "Untitled chat"}</span>
                      <span className="text-[11px] text-white/32">
                        {conversation.gem_id} · {new Date(conversation.last_message_at).toLocaleString()}
                      </span>
                    </span>
                    <ArrowRight size={14} className="shrink-0 text-white/25" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-2 border-t border-white/8 py-4 text-[11px] text-white/28">
          <span>Noor AI · beyond intelligence</span>
          <span className="flex gap-4">
            <Link href="/signin" className="hover:text-white/60">Account</Link>
            <Link href="/why" className="hover:text-white/60">How savings work</Link>
          </span>
        </footer>
      </div>
    </main>
  );
}
