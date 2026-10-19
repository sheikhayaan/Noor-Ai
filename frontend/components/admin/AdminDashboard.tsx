"use client";

import { motion } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Clock,
  Coins,
  Cpu,
  Database,
  Gauge,
  Loader2,
  MessageSquare,
  RefreshCw,
  Server,
  ShieldAlert,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchAdminCache,
  fetchAdminEvents,
  fetchAdminOverview,
  fetchAdminRatings,
  fetchAdminRequests,
  fetchAdminTimeseries,
  fetchAdminUsers,
  fetchAdminWhoami,
  type AdminCacheResponse,
  type AdminEvent,
  type AdminOverview,
  type AdminRatingsSummary,
  type AdminRequestRow,
  type AdminTimeseriesPoint,
  type AdminUserRow,
  type AdminWhoami,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// --------------------------------------------------------------------------
// Formatters
// --------------------------------------------------------------------------
const nf = (n: number) => Math.round(n).toLocaleString("en-US");

function formatUSD(n: number): string {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  if (n > 0) return `$${n.toFixed(6)}`;
  return "$0.00";
}

function formatLatency(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

// SQLite CURRENT_TIMESTAMP is UTC ("2026-08-19 12:34:56"); parse as UTC.
function parseUTC(value: string): number {
  const t = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(t) ? Date.now() : t;
}

function timeAgo(value: string, now: number): string {
  const diff = Math.max(0, now - parseUTC(value));
  const s = Math.floor(diff / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function shortId(id: string | null | undefined, head = 12): string {
  if (!id) return "—";
  return id.length <= head + 2 ? id : `${id.slice(0, head)}…`;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function displayName(row: { name?: string | null; email?: string | null; user_id: string }): string {
  if (row.name && row.name !== row.user_id) return row.name;
  if (row.email) return row.email;
  if (row.user_id.startsWith("guest")) return "Guest";
  return shortId(row.user_id, 16);
}

// --------------------------------------------------------------------------
// Inline SVG area chart — indigo fill, cyan stroke (Noor dashboard idiom).
// --------------------------------------------------------------------------
function AreaChart({
  points,
  gradientId,
  height = 180,
}: {
  points: { label: string; value: number }[];
  gradientId: string;
  height?: number;
}) {
  if (points.length === 0 || points.every((p) => p.value === 0)) {
    return (
      <div
        className="flex items-center justify-center text-center text-sm text-white/30"
        style={{ height }}
      >
        No activity in this window yet.
      </div>
    );
  }

  const W = 720;
  const H = 200;
  const PAD_TOP = 18;
  const PAD_BOTTOM = 10;
  const maxValue = Math.max(...points.map((p) => p.value), 1);
  const n = points.length;

  const xFor = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
  const yFor = (v: number) => H - PAD_BOTTOM - (v / maxValue) * (H - PAD_TOP - PAD_BOTTOM);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(p.value).toFixed(2)}`)
    .join(" ");

  const areaPath =
    n === 1
      ? `M 0 ${yFor(points[0].value).toFixed(2)} L ${W} ${yFor(points[0].value).toFixed(2)} L ${W} ${H} L 0 ${H} Z`
      : `${linePath} L ${xFor(n - 1).toFixed(2)} ${H} L ${xFor(0).toFixed(2)} ${H} Z`;

  const gridLines = [0.25, 0.5, 0.75];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
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
        fill={`url(#${gradientId})`}
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
  );
}

// --------------------------------------------------------------------------
// Building blocks
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

type ChipTone = "default" | "cyan" | "emerald" | "amber" | "red" | "indigo";

const CHIP_TONES: Record<ChipTone, string> = {
  default: "border-white/10 bg-white/[0.04] text-white/60",
  cyan: "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-100/90",
  emerald: "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-100/90",
  amber: "border-amber-300/25 bg-amber-300/[0.08] text-amber-100/90",
  red: "border-red-400/25 bg-red-500/[0.10] text-red-200/90",
  indigo: "border-indigo-400/25 bg-indigo-400/[0.10] text-indigo-200/90",
};

function Chip({ children, tone = "default" }: { children: React.ReactNode; tone?: ChipTone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
        CHIP_TONES[tone],
      )}
    >
      {children}
    </span>
  );
}

function Panel({
  title,
  icon,
  children,
  right,
  delay = 0,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  right?: React.ReactNode;
  delay?: number;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay }}
      className="rounded-3xl border border-white/10 bg-white/[0.02] p-5"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80">
          <span className="text-cyan-200">{icon}</span>
          {title}
        </h2>
        {right}
      </div>
      {children}
    </motion.section>
  );
}

function sourceChip(source: string) {
  if (source === "intelligent") return <Chip tone="cyan">memory-aware</Chip>;
  return <Chip>direct</Chip>;
}

function cacheChip(result: string | null) {
  if (result === "HIT") return <Chip tone="emerald">cache HIT</Chip>;
  if (result === "MISS") return <Chip>cache MISS</Chip>;
  return null;
}

function severityTone(severity: string): ChipTone {
  if (severity === "error" || severity === "critical") return "red";
  if (severity === "warning") return "amber";
  return "default";
}

function summarizeDetail(detail: Record<string, unknown>): string {
  const keys = Object.keys(detail);
  if (!keys.length) return "";
  return keys
    .slice(0, 4)
    .map((k) => `${k}: ${String(detail[k])}`)
    .join(" · ");
}

// --------------------------------------------------------------------------
// Dashboard
// --------------------------------------------------------------------------
export function AdminDashboard() {
  const [whoami, setWhoami] = useState<AdminWhoami | null>(null);
  const [denied, setDenied] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [requests, setRequests] = useState<AdminRequestRow[]>([]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [series, setSeries] = useState<AdminTimeseriesPoint[]>([]);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [ratings, setRatings] = useState<AdminRatingsSummary | null>(null);
  const [cache, setCache] = useState<AdminCacheResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Guard against setting state after unmount during polling.
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadAll = useCallback(async (initial: boolean) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    try {
      const [ov, rq, us, ts, ev, ra, ca] = await Promise.all([
        fetchAdminOverview(),
        fetchAdminRequests({ limit: 40 }),
        fetchAdminUsers(100),
        fetchAdminTimeseries(30),
        fetchAdminEvents({ limit: 40 }),
        fetchAdminRatings(20),
        fetchAdminCache(),
      ]);
      if (!aliveRef.current) return;
      setOverview(ov);
      setRequests(rq.requests);
      setUsers(us.users);
      setSeries(ts.series);
      setEvents(ev.events);
      setRatings(ra);
      setCache(ca);
      setError(null);
      setLastUpdated(Date.now());
    } catch (e) {
      if (!aliveRef.current) return;
      if (e instanceof Error && e.message === "admin_required") setDenied(true);
      else setError(e instanceof Error ? e.message : "Failed to load admin data.");
    } finally {
      if (aliveRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Mount: verify admin access (single 403 gate), then load everything.
  useEffect(() => {
    (async () => {
      try {
        const who = await fetchAdminWhoami();
        if (!aliveRef.current) return;
        setWhoami(who);
        await loadAll(true);
      } catch (e) {
        if (!aliveRef.current) return;
        if (e instanceof Error && e.message === "admin_required") setDenied(true);
        else setError(e instanceof Error ? e.message : "Failed to reach the admin API.");
        setLoading(false);
      }
    })();
  }, [loadAll]);

  // Live polling — only while the tab is visible; pauses in the background.
  useEffect(() => {
    if (denied) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadAll(false);
    }, 8000);
    return () => window.clearInterval(id);
  }, [denied, loadAll]);

  // Tick "updated Ns ago" / relative times without refetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, []);

  const hitRatePct = useMemo(() => {
    if (!overview) return 0;
    const r = overview.cache_hit_rate;
    return r <= 1 ? r * 100 : r;
  }, [overview]);

  const requestSeries = useMemo(
    () => series.map((p) => ({ label: p.date, value: p.requests })),
    [series],
  );
  const tokenSeries = useMemo(
    () => series.map((p) => ({ label: p.date, value: p.tokens_saved })),
    [series],
  );
  const rangeLabel = series.length
    ? `${series[0].date} → ${series[series.length - 1].date}`
    : "no data yet";

  const updatedAgo = lastUpdated ? timeAgo(new Date(lastUpdated).toISOString(), now) : "—";

  const report = cache && cache.reachable ? cache.health : null;
  const cacheStats = report?.stats ?? {};

  // ---- Denied ----
  if (denied) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/[0.08]">
          <ShieldAlert className="h-7 w-7 text-amber-200/90" />
        </div>
        <h1 className="mt-5 text-xl font-semibold text-white">Admin access restricted</h1>
        <p className="mt-2 text-sm leading-6 text-white/45">
          This dashboard is limited to allowlisted accounts. Sign in with an admin account, or open
          it from the server&apos;s own machine (loopback). Your attempt was logged.
        </p>
        <Link
          href="/chat"
          className="mt-6 inline-flex items-center gap-1.5 text-sm text-cyan-200 transition hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to chat
        </Link>
      </div>
    );
  }

  // ---- Loading (first paint) ----
  if (loading && !overview) {
    return (
      <div className="flex h-dvh items-center justify-center text-white/40">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading admin intelligence…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8">
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
            <ShieldCheck className="h-6 w-6 text-cyan-200" />
            Admin Intelligence
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm text-white/45">
            Every question, response, rating, saving, and security event across Noor — measured, not
            estimated, and refreshed live.
          </p>
          {whoami && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Chip tone="cyan">
                <ShieldCheck className="h-3 w-3" />
                {whoami.name || whoami.email || shortId(whoami.user_id, 16)}
              </Chip>
              <Chip>granted via {whoami.granted_via}</Chip>
              <Chip tone={whoami.enforce ? "emerald" : "amber"}>
                auth {whoami.enforce ? "enforced" : "observe"}
              </Chip>
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 bg-emerald-300/[0.06] px-2.5 py-1 text-xs text-emerald-100/80">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-300" />
            </span>
            {refreshing ? "updating…" : `live · updated ${updatedAgo}`}
          </span>
          <Button
            variant="glass"
            size="md"
            onClick={() => void loadAll(false)}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-2xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Stat tiles */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatTile
            icon={<Activity className="h-4 w-4" />}
            label="Requests"
            value={nf(overview?.total_requests ?? 0)}
            sub="all-time turns logged"
            delay={0.02}
          />
          <StatTile
            icon={<Users className="h-4 w-4" />}
            label="Active users"
            value={nf(overview?.active_users ?? 0)}
            sub={`${nf(overview?.registered_users ?? 0)} registered`}
            delay={0.05}
          />
          <StatTile
            icon={<Zap className="h-4 w-4" />}
            label="Tokens saved"
            value={nf(overview?.total_tokens_saved ?? 0)}
            sub="memory + semantic cache"
            delay={0.08}
          />
          <StatTile
            icon={<Coins className="h-4 w-4" />}
            label="Cost saved"
            value={formatUSD(overview?.total_cost_saved_usd ?? 0)}
            sub="real Gateway spend avoided"
            delay={0.11}
          />
          <StatTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Cache hit rate"
            value={`${hitRatePct.toFixed(0)}%`}
            sub={`${nf(overview?.cache_hits ?? 0)} of ${nf(overview?.cache_lookups ?? 0)} lookups`}
            delay={0.14}
          />
          <StatTile
            icon={<Gauge className="h-4 w-4" />}
            label="Avg latency"
            value={formatLatency(overview?.avg_latency_ms)}
            sub="model round-trip"
            delay={0.17}
          />
          <StatTile
            icon={<ThumbsUp className="h-4 w-4" />}
            label="Ratings"
            value={`${nf(overview?.ratings_up ?? 0)} ↑ / ${nf(overview?.ratings_down ?? 0)} ↓`}
            sub="thumbs feedback"
            delay={0.2}
          />
          <StatTile
            icon={<MessageSquare className="h-4 w-4" />}
            label="Conversations"
            value={nf(overview?.total_conversations ?? 0)}
            sub={`${nf(overview?.total_messages ?? 0)} messages stored`}
            delay={0.23}
          />
        </div>

        {/* Timeseries */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title="Requests per day"
            icon={<Activity className="h-4 w-4" />}
            right={<span className="text-[11px] text-white/30">{rangeLabel}</span>}
            delay={0.16}
          >
            <AreaChart points={requestSeries} gradientId="noor-admin-requests" />
          </Panel>
          <Panel
            title="Tokens saved per day"
            icon={<TrendingUp className="h-4 w-4" />}
            right={<span className="text-[11px] text-white/30">last {series.length || 0} active days</span>}
            delay={0.18}
          >
            <AreaChart points={tokenSeries} gradientId="noor-admin-tokens" />
          </Panel>
        </div>

        {/* Live activity feed */}
        <Panel
          title="Live activity"
          icon={<MessageSquare className="h-4 w-4" />}
          right={<span className="text-[11px] text-white/30">{requests.length} most recent</span>}
          delay={0.2}
        >
          {requests.length === 0 ? (
            <p className="text-sm text-white/35">No requests captured yet.</p>
          ) : (
            <div className="max-h-[32rem] space-y-2 overflow-y-auto pr-1">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl border border-white/8 bg-white/[0.02] p-3.5"
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/40">
                    {sourceChip(r.source)}
                    {cacheChip(r.cache_result)}
                    {r.model && (
                      <Chip tone="indigo">
                        <Cpu className="h-3 w-3" />
                        {r.model}
                      </Chip>
                    )}
                    {r.tokens_saved > 0 && (
                      <span className="inline-flex items-center gap-1 text-cyan-100/70">
                        <Zap className="h-3 w-3" />
                        {nf(r.tokens_saved)} saved
                      </span>
                    )}
                    {r.memories_used > 0 && <span>{r.memories_used} memories</span>}
                    <span className="ml-auto inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatLatency(r.latency_ms)} · {timeAgo(r.created_at, now)}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-2 text-sm text-white/80" title={r.question ?? ""}>
                    <span className="mr-1.5 text-white/30">Q</span>
                    {r.question || "—"}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm text-white/45" title={r.response ?? ""}>
                    <span className="mr-1.5 text-white/25">A</span>
                    {r.response || "—"}
                  </p>
                  <div className="mt-1.5 text-[11px] text-white/25">{shortId(r.user_id, 18)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* Users */}
        <Panel
          title="Users"
          icon={<Users className="h-4 w-4" />}
          right={<span className="text-[11px] text-white/30">{users.length} active</span>}
          delay={0.22}
        >
          {users.length === 0 ? (
            <p className="text-sm text-white/35">No user activity yet.</p>
          ) : (
            <div className="max-h-[26rem] overflow-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-white/35">
                  <tr className="border-b border-white/8">
                    <th className="py-2 pr-3 font-medium">User</th>
                    <th className="py-2 pr-3 text-right font-medium">Requests</th>
                    <th className="py-2 pr-3 text-right font-medium">Cache hits</th>
                    <th className="py-2 pr-3 text-right font-medium">Tokens saved</th>
                    <th className="py-2 pr-3 text-right font-medium">Cost saved</th>
                    <th className="py-2 pr-3 text-right font-medium">Last active</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.user_id} className="border-b border-white/5">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-white/85">{displayName(u)}</div>
                        <div className="text-[11px] text-white/30">
                          {u.provider ? `${u.provider} · ` : ""}
                          {shortId(u.user_id, 20)}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 text-right text-white/70">{nf(u.requests)}</td>
                      <td className="py-2.5 pr-3 text-right text-white/70">{nf(u.cache_hits)}</td>
                      <td className="py-2.5 pr-3 text-right text-cyan-100/80">{nf(u.tokens_saved)}</td>
                      <td className="py-2.5 pr-3 text-right text-white/70">{formatUSD(u.cost_saved_usd)}</td>
                      <td className="py-2.5 pr-3 text-right text-white/40">
                        {timeAgo(u.last_active, now)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* Ratings + Events */}
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title="Feedback"
            icon={<ThumbsUp className="h-4 w-4" />}
            right={
              <span className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1 text-emerald-200/80">
                  <ThumbsUp className="h-3.5 w-3.5" />
                  {nf(ratings?.up ?? 0)}
                </span>
                <span className="inline-flex items-center gap-1 text-red-200/80">
                  <ThumbsDown className="h-3.5 w-3.5" />
                  {nf(ratings?.down ?? 0)}
                </span>
              </span>
            }
            delay={0.24}
          >
            {(ratings?.recent.length ?? 0) === 0 ? (
              <p className="text-sm text-white/35">No ratings yet — thumbs on a reply will show here.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {ratings!.recent.map((r, i) => (
                  <div
                    key={`${r.conversation_id}-${r.message_id ?? "conv"}-${i}`}
                    className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.02] p-3"
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
                        r.rating > 0
                          ? "bg-emerald-300/10 text-emerald-200"
                          : "bg-red-500/10 text-red-300",
                      )}
                    >
                      {r.rating > 0 ? (
                        <ThumbsUp className="h-3.5 w-3.5" />
                      ) : (
                        <ThumbsDown className="h-3.5 w-3.5" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white/75">{r.comment || (r.rating > 0 ? "Liked this reply" : "Flagged this reply")}</p>
                      <div className="mt-1 text-[11px] text-white/30">
                        {shortId(r.user_id, 16)} · {timeAgo(r.updated_at, now)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel
            title="Security & events"
            icon={<ShieldAlert className="h-4 w-4" />}
            right={<span className="text-[11px] text-white/30">{events.length} recent</span>}
            delay={0.26}
          >
            {events.length === 0 ? (
              <p className="text-sm text-white/35">No events recorded. A clean feed is a good sign.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {events.map((e) => (
                  <div key={e.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={severityTone(e.severity)}>
                        <AlertTriangle className="h-3 w-3" />
                        {e.event_type}
                      </Chip>
                      <span className="ml-auto text-[11px] text-white/30">
                        {timeAgo(e.created_at, now)}
                      </span>
                    </div>
                    {summarizeDetail(e.detail) && (
                      <p className="mt-1.5 break-words text-xs text-white/45">
                        {summarizeDetail(e.detail)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Gateway cache health */}
        <Panel
          title="Gateway semantic cache"
          icon={<Database className="h-4 w-4" />}
          right={
            cache ? (
              cache.reachable ? (
                <Chip tone={report?.health?.status === "healthy" ? "emerald" : "amber"}>
                  <Server className="h-3 w-3" />
                  {report?.health?.status ?? "unknown"}
                </Chip>
              ) : (
                <Chip tone="red">
                  <AlertTriangle className="h-3 w-3" />
                  offline
                </Chip>
              )
            ) : null
          }
          delay={0.28}
        >
          {cache && cache.reachable ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-white/35">Score</div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {report?.health?.score == null ? "—" : report.health.score}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-white/35">Hit rate</div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {num(cacheStats.hitRate) == null ? "—" : `${num(cacheStats.hitRate)}%`}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-white/35">Lookups</div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {nf(num(cacheStats.lookups) ?? 0)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <div className="text-[11px] uppercase tracking-wide text-white/35">Entries</div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {nf(num(cacheStats.entries) ?? num((report?.distribution ?? {}).entries) ?? 0)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Chip tone="indigo">
                  <Server className="h-3 w-3" />
                  backend: {report?.backend?.mode ?? "?"} ({report?.backend?.status ?? "?"})
                </Chip>
                {report?.service && <Chip>{report.service}</Chip>}
              </div>

              {(report?.health?.signals?.length ?? 0) > 0 && (
                <ul className="space-y-1.5">
                  {report!.health!.signals!.map((s, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-white/55">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/60" />
                      {s}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="text-sm text-white/45">
              <p>The Noor Gateway is not reachable, so live cache health is unavailable.</p>
              {cache && !cache.reachable && (
                <p className="mt-1 text-[11px] text-white/30">
                  {cache.base_url ? `${cache.base_url} · ` : ""}
                  {cache.error}
                </p>
              )}
            </div>
          )}
        </Panel>

        <p className="pt-2 text-center text-[11px] text-white/25">
          Reads are honest aggregations over captured activity. Access is gated on your verified
          session or loopback; denied attempts are recorded in the events feed above.
        </p>
      </div>
    </div>
  );
}
