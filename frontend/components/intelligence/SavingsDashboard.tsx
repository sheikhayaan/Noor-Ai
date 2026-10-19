"use client";

import { motion } from "framer-motion";
import {
  ArrowLeft,
  Brain,
  Coins,
  Database,
  Layers,
  Loader2,
  MessagesSquare,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  TrendingUp,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  deleteMemory,
  fetchMemory,
  fetchSavings,
  type DailySavings,
  type MemorySnapshot,
  type SavingsSummary,
} from "@/lib/api";
import { Button } from "@/components/ui/button";

const nf = (n: number) => Math.round(n).toLocaleString("en-US");

function formatUSD(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}

// --------------------------------------------------------------------------
// Cumulative savings — inline SVG area chart (indigo fill, cyan stroke).
// No chart dependency; honest cumulative sum of the daily token series.
// --------------------------------------------------------------------------
function CumulativeSavingsChart({ daily }: { daily: DailySavings[] }) {
  const points = useMemo(() => {
    const ordered = [...daily].sort((a, b) => a.date.localeCompare(b.date));
    let running = 0;
    return ordered.map((d) => {
      running += Math.max(0, d.tokens_saved);
      return { date: d.date, value: running };
    });
  }, [daily]);

  const total = points.length ? points[points.length - 1].value : 0;
  if (points.length === 0 || total === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-center text-sm text-white/30">
        No savings recorded yet — start chatting and watch this curve climb.
      </div>
    );
  }

  const W = 720;
  const H = 200;
  const PAD_TOP = 18;
  const PAD_BOTTOM = 10;
  const maxValue = Math.max(total, 1);
  const n = points.length;

  const xFor = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const yFor = (v: number) => H - PAD_BOTTOM - (v / maxValue) * (H - PAD_TOP - PAD_BOTTOM);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`)
    .join(" ");

  // For a single day, draw a flat baseline so the area still renders.
  const areaPath =
    n === 1
      ? `M 0 ${yFor(points[0].value).toFixed(2)} L ${W} ${yFor(points[0].value).toFixed(2)} L ${W} ${H} L 0 ${H} Z`
      : `${linePath} L ${xFor(n - 1).toFixed(2)} ${H} L ${xFor(0).toFixed(2)} ${H} Z`;

  const gridLines = [0.25, 0.5, 0.75];

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-48 w-full">
        <defs>
          <linearGradient id="noor-savings-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.5" />
            <stop offset="55%" stopColor="#6366f1" stopOpacity="0.16" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridLines.map((g) => (
          <line
            key={g}
            x1={0}
            x2={W}
            y1={PAD_TOP + g * (H - PAD_TOP - PAD_BOTTOM)}
            y2={PAD_TOP + g * (H - PAD_TOP - PAD_BOTTOM)}
            stroke="#ffffff"
            strokeOpacity={0.05}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <motion.path
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          d={areaPath}
          fill="url(#noor-savings-fill)"
        />
        <motion.path
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.9, ease: "easeInOut" }}
          d={linePath}
          fill="none"
          stroke="#67ffeb"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

// --------------------------------------------------------------------------
// Small building blocks
// --------------------------------------------------------------------------
function StatTile({
  icon,
  label,
  value,
  sub,
  delay = 0,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="flex items-center gap-2 text-white/40">
        {icon}
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/35">{sub}</div>}
    </motion.div>
  );
}

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "cyan" }) {
  return (
    <span
      className={
        tone === "cyan"
          ? "inline-flex items-center gap-1 rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-2.5 py-1 text-xs text-cyan-100/90"
          : "inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/60"
      }
    >
      {children}
    </span>
  );
}

function Panel({
  title,
  icon,
  children,
  delay = 0,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay }}
      className="rounded-3xl border border-white/10 bg-white/[0.02] p-5"
    >
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white/80">
        <span className="text-cyan-200">{icon}</span>
        {title}
      </h2>
      {children}
    </motion.section>
  );
}

// --------------------------------------------------------------------------
// Dashboard
// --------------------------------------------------------------------------
export function SavingsDashboard({ userId }: { userId: string }) {
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [savings, setSavings] = useState<SavingsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [wiping, setWiping] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, s] = await Promise.all([fetchMemory(userId), fetchSavings(userId)]);
      setMemory(m);
      setSavings(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load your intelligence data.");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleWipe = useCallback(async () => {
    setWiping(true);
    try {
      await deleteMemory(userId);
      setConfirmingWipe(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear memory.");
    } finally {
      setWiping(false);
    }
  }, [userId, load]);

  const cacheRate = useMemo(() => {
    if (!savings) return 0;
    const r = savings.cache_hit_rate;
    return r <= 1 ? r * 100 : r; // tolerate fraction or already-percentage
  }, [savings]);

  const style = memory?.style_profile ?? null;
  const styleChips: string[] = [];
  if (style) {
    if (style.technical_level) styleChips.push(`${style.technical_level} level`);
    styleChips.push(style.prefers_concise ? "prefers concise" : "prefers thorough");
    if (style.prefers_examples) styleChips.push("likes examples");
    if (style.response_length_preference) styleChips.push(`${style.response_length_preference} answers`);
    if (style.preferred_language && style.preferred_language.toLowerCase() !== "english") {
      styleChips.push(style.preferred_language);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/chat"
            className="mb-3 inline-flex items-center gap-1.5 text-xs text-white/45 transition hover:text-cyan-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to chat
          </Link>
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-white sm:text-3xl">
            <Sparkles className="h-6 w-6 text-cyan-200" />
            Intelligence &amp; Savings
          </h1>
          <p className="mt-1.5 max-w-xl text-sm text-white/45">
            What Noor remembers about you, and the tokens it saves by reusing memory and Gateway&apos;s
            semantic cache. Every number here is measured, not estimated.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="glass"
            size="md"
            onClick={() => void load()}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {confirmingWipe ? (
            <div className="flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-1">
              <span className="pl-1 text-xs text-red-200">Forget everything?</span>
              <button
                onClick={() => void handleWipe()}
                disabled={wiping}
                className="inline-flex items-center gap-1 rounded-full bg-red-500/80 px-3 py-1 text-xs font-medium text-white transition hover:bg-red-500 disabled:opacity-60"
              >
                {wiping ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Confirm
              </button>
              <button
                onClick={() => setConfirmingWipe(false)}
                disabled={wiping}
                className="rounded-full px-2 py-1 text-xs text-white/50 transition hover:text-white"
              >
                Cancel
              </button>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="md"
              onClick={() => setConfirmingWipe(true)}
              className="gap-2 text-red-200/70 hover:text-red-200"
            >
              <Trash2 className="h-4 w-4" />
              Forget everything
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading && !memory && !savings ? (
        <div className="flex h-64 items-center justify-center text-white/40">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading your intelligence data…
        </div>
      ) : (
        <div className="space-y-6">
          {/* Stat tiles */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              icon={<Zap className="h-4 w-4" />}
              label="Tokens saved"
              value={nf(savings?.total_tokens_saved ?? 0)}
              sub="across all conversations"
              delay={0.02}
            />
            <StatTile
              icon={<Coins className="h-4 w-4" />}
              label="Cost saved"
              value={formatUSD(savings?.total_cost_saved_usd ?? 0)}
              sub="real Gateway spend avoided"
              delay={0.06}
            />
            <StatTile
              icon={<TrendingUp className="h-4 w-4" />}
              label="Cache hit rate"
              value={`${cacheRate.toFixed(0)}%`}
              sub={`${nf(savings?.total_cache_hits ?? 0)} of ${nf(savings?.total_requests ?? 0)} requests`}
              delay={0.1}
            />
            <StatTile
              icon={<MessagesSquare className="h-4 w-4" />}
              label="Requests optimized"
              value={nf(savings?.total_requests ?? 0)}
              sub="memory-aware turns"
              delay={0.14}
            />
          </div>

          {/* Cumulative savings chart */}
          <Panel title="Cumulative tokens saved" icon={<TrendingUp className="h-4 w-4" />} delay={0.16}>
            <CumulativeSavingsChart daily={savings?.daily ?? []} />
          </Panel>

          {/* Memory + timeline */}
          <div className="grid gap-6 lg:grid-cols-5">
            {/* What Noor knows */}
            <div className="lg:col-span-2">
              <Panel title="What Noor knows about you" icon={<Brain className="h-4 w-4" />} delay={0.18}>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: "Facts", value: memory?.counts.facts ?? 0, icon: <Sparkles className="h-3.5 w-3.5" /> },
                    { label: "Entities", value: memory?.counts.entities ?? 0, icon: <Layers className="h-3.5 w-3.5" /> },
                    { label: "Summaries", value: memory?.counts.summaries ?? 0, icon: <MessagesSquare className="h-3.5 w-3.5" /> },
                  ].map((c) => (
                    <div key={c.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-center">
                      <div className="flex justify-center text-cyan-200/70">{c.icon}</div>
                      <div className="mt-1 text-xl font-semibold text-white">{nf(c.value)}</div>
                      <div className="text-[11px] text-white/40">{c.label}</div>
                    </div>
                  ))}
                </div>

                {styleChips.length > 0 && (
                  <div className="mt-5">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                      Communication style
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {styleChips.map((c) => (
                        <Chip key={c} tone="cyan">
                          {c}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {(memory?.topics.length ?? 0) > 0 && (
                  <div className="mt-5">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                      Top topics
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {memory!.topics.slice(0, 12).map((t) => (
                        <Chip key={t.topic}>
                          <Tag className="h-3 w-3 text-white/30" />
                          {t.topic}
                          <span className="text-white/30">· {t.count}</span>
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {memory?.entities && memory.entities.length > 0 && (
                  <div className="mt-5">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-white/35">
                      Entities
                    </div>
                    <div className="space-y-2">
                      {memory.entities.slice(0, 6).map((e) => (
                        <div key={e.name} className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2">
                          <div className="text-sm font-medium text-white/85">{e.name}</div>
                          {e.description && <div className="text-xs text-white/45">{e.description}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!loading &&
                  (memory?.counts.facts ?? 0) === 0 &&
                  (memory?.counts.entities ?? 0) === 0 &&
                  styleChips.length === 0 && (
                    <p className="mt-4 text-sm text-white/35">
                      Noor hasn&apos;t learned anything yet. Chat for a bit and your profile will appear here.
                    </p>
                  )}
              </Panel>
            </div>

            {/* Memory timeline */}
            <div className="lg:col-span-3">
              <Panel title="Memory timeline" icon={<Database className="h-4 w-4" />} delay={0.22}>
                {(memory?.facts.length ?? 0) === 0 && (memory?.summaries.length ?? 0) === 0 ? (
                  <p className="text-sm text-white/35">Nothing remembered yet.</p>
                ) : (
                  <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1">
                    {memory?.facts.map((f) => (
                      <div key={f.id} className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3">
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cyan-300/10 text-cyan-200">
                          <Sparkles className="h-3.5 w-3.5" />
                        </div>
                        <p className="text-sm leading-relaxed text-white/75">{f.content}</p>
                      </div>
                    ))}
                    {memory?.summaries.map((s, i) => (
                      <div
                        key={`sum-${i}`}
                        className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3"
                      >
                        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-400/10 text-indigo-300">
                          <MessagesSquare className="h-3.5 w-3.5" />
                        </div>
                        <div>
                          <p className="text-sm leading-relaxed text-white/70">{s.content}</p>
                          {s.topics.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {s.topics.slice(0, 6).map((t) => (
                                <span key={t} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/40">
                                  {t}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Panel>
            </div>
          </div>

          <p className="pt-2 text-center text-[11px] text-white/25">
            Caching is powered by Noor Gateway&apos;s semantic cache. Your memory is private to you and never shared
            across accounts.
          </p>
        </div>
      )}
    </div>
  );
}
