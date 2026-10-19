"use client";

// "Why Noor" — the whole product explained as diagrams, because a feature list
// does not answer "how does this help me". Everything here is CSS/SVG: no images,
// no chart library, so it stays instant and works offline.

import Link from "next/link";
import { ArrowRight, BrainCircuit, Coins, Database, Gauge, KeyRound, Layers, PiggyBank, ShieldCheck, Sparkles, Timer, Waypoints, Zap } from "lucide-react";

/* ------------------------------------------------------------------ flow --- */

const FLOW = [
  { icon: <Sparkles size={15} />, title: "You ask", body: "Prompt + selected gem", tone: "neutral" },
  { icon: <Database size={15} />, title: "Semantic cache", body: "Is this already answered?", tone: "cache" },
  { icon: <Zap size={15} />, title: "Cache hit", body: "Answer in ~50 ms · $0", tone: "good" },
  { icon: <Waypoints size={15} />, title: "Route", body: "Cheapest capable model", tone: "neutral" },
  { icon: <KeyRound size={15} />, title: "Your key?", body: "BYOK goes direct", tone: "byok" },
  { icon: <BrainCircuit size={15} />, title: "Answer", body: "Streamed, cited", tone: "neutral" },
  { icon: <Layers size={15} />, title: "Learn", body: "Memory + savings ledger", tone: "good" },
];

const TONES: Record<string, string> = {
  neutral: "border-white/10 bg-white/[0.035]",
  cache: "border-cyan-300/25 bg-cyan-300/[0.07]",
  good: "border-emerald-300/25 bg-emerald-300/[0.07]",
  byok: "border-violet-300/25 bg-violet-300/[0.07]",
};

/* ------------------------------------------------------------------ tree --- */

const TREE = [
  {
    icon: <Coins size={16} />,
    title: "Cost",
    why: "Two independent savings, stacked",
    leaves: ["Cache hit = no model call at all", "Routing picks the cheapest capable model", "BYOK moves the token bill to your own account"],
  },
  {
    icon: <Timer size={16} />,
    title: "Speed",
    why: "Most repeat questions never reach a model",
    leaves: ["~50 ms cached replies", "Background memory never blocks your reply", "Bounded queues instead of silent stalls"],
  },
  {
    icon: <ShieldCheck size={16} />,
    title: "Privacy",
    why: "Your key and your memory stay yours",
    leaves: ["Keys encrypted (AES-256-GCM) at rest", "BYOK traffic never transits our gateway", "Per-user scoping — no shared key pool"],
  },
  {
    icon: <BrainCircuit size={16} />,
    title: "Memory",
    why: "It gets more useful the longer you use it",
    leaves: ["Facts, entities and style remembered", "Relevant context injected per turn", "You can inspect and delete everything"],
  },
  {
    icon: <Gauge size={16} />,
    title: "Scale",
    why: "Built for a launch spike, not a demo",
    leaves: ["Measured 70 req/s per instance", "Global + per-user concurrency caps", "Overload = fast 429/503, never a hang"],
  },
];

const COMPARISON = [
  ["Repeat questions", "Full price every time", "Cached — free and instant"],
  ["Model choice", "One model for everything", "Cheapest capable model per task"],
  ["Cost visibility", "A bill at month end", "Per-answer savings, live"],
  ["Your own API key", "Not supported", "Supported, encrypted, per-user"],
  ["Cross-chat memory", "Start from zero", "Remembers facts and preferences"],
  ["Load spike", "Timeouts and errors", "Bounded queues, clean backpressure"],
];

export default function WhyPage() {
  return (
    <main className="min-h-dvh bg-[#07080a] text-white">
      <div className="pointer-events-none fixed -left-40 top-0 h-[30rem] w-[30rem] rounded-full bg-cyan-300/10 blur-[130px]" />
      <div className="pointer-events-none fixed -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-violet-400/10 blur-[130px]" />

      <div className="relative mx-auto max-w-6xl px-5 py-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-200 text-slate-950">
              <Sparkles size={16} />
            </span>
            Noor AI
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/chat" className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 hover:bg-white/[0.06]">
              Open chat
            </Link>
            <Link href="/signin" className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-black hover:bg-white/90">
              Sign in
            </Link>
          </div>
        </header>

        {/* Hero */}
        <section className="py-12 text-center">
          <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/55">
            <PiggyBank size={12} /> The cheapest way to get a good answer
          </p>
          <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-5xl">
            Most AI bills are <span className="bg-gradient-to-r from-cyan-200 to-violet-200 bg-clip-text text-transparent">repeated questions</span>.
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-white/55">
            Noor answers a near-duplicate from cache, routes what is left to the cheapest model that can
            handle it, and lets you attach your own key when you want a frontier model. Three independent
            savings on the same request.
          </p>
        </section>

        {/* Flow chart */}
        <section className="rounded-3xl border border-white/10 bg-[#0c0d11]/80 p-5 md:p-7">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/45">How one request flows</h2>
          <div className="mt-6 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            {FLOW.map((step, index) => (
              <div key={step.title} className="relative">
                <div className={`h-full rounded-2xl border p-3.5 ${TONES[step.tone]}`}>
                  <div className="mb-2 flex items-center justify-between text-white/45">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-black/30">{step.icon}</span>
                    <span className="text-[10px] font-mono text-white/25">{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <p className="text-[13px] font-medium text-white/90">{step.title}</p>
                  <p className="mt-0.5 text-[11px] leading-4 text-white/45">{step.body}</p>
                </div>
                {index < FLOW.length - 1 && (
                  <ArrowRight
                    size={14}
                    className="absolute -right-[9px] top-1/2 hidden -translate-y-1/2 text-white/20 xl:block"
                  />
                )}
              </div>
            ))}
          </div>
          <p className="mt-4 text-[11px] text-white/35">
            The dashed path is the cheap one: a cache hit short-circuits everything after step 2, so no model
            is called and nothing is billed.
          </p>
        </section>

        {/* Value tree */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/45">Why it helps — the value tree</h2>

          <div className="mt-6 flex flex-col items-center">
            <div className="rounded-2xl border border-cyan-200/30 bg-cyan-200/[0.08] px-6 py-3 text-center">
              <p className="text-sm font-semibold text-cyan-50">Noor</p>
              <p className="text-[11px] text-cyan-100/60">cheaper · faster · private</p>
            </div>
            <div className="my-2 h-6 w-px bg-white/15" />

            {/* connector bar */}
            <div className="relative hidden h-px w-[86%] bg-white/15 md:block" />
            <div className="grid w-full gap-4 pt-6 md:grid-cols-5">
              {TREE.map((branch) => (
                <div key={branch.title} className="relative flex flex-col">
                  <div className="mx-auto hidden h-6 w-px bg-white/15 md:block" />
                  <div className="flex-1 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-2 flex items-center gap-2 text-cyan-100">
                      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-200/10">{branch.icon}</span>
                      <span className="text-sm font-semibold">{branch.title}</span>
                    </div>
                    <p className="mb-2 text-[11px] leading-4 text-white/45">{branch.why}</p>
                    <ul className="space-y-1.5">
                      {branch.leaves.map((leaf) => (
                        <li key={leaf} className="flex gap-2 text-[11.5px] leading-4 text-white/65">
                          <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-cyan-200/60" />
                          {leaf}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Comparison */}
        <section className="mt-12">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-white/45">What changes in practice</h2>
          <div className="mt-4 overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full border-collapse text-left text-[13px]">
              <thead className="bg-white/[0.05] text-white/55">
                <tr>
                  <th className="px-4 py-3 font-medium"> </th>
                  <th className="px-4 py-3 font-medium">A plain model API</th>
                  <th className="px-4 py-3 font-medium text-cyan-100">Noor</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map(([topic, plain, noor]) => (
                  <tr key={topic} className="border-t border-white/8">
                    <td className="px-4 py-3 text-white/80">{topic}</td>
                    <td className="px-4 py-3 text-white/40">{plain}</td>
                    <td className="px-4 py-3 text-cyan-50/85">{noor}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* CTA */}
        <section className="mt-12 flex flex-col items-center gap-4 rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.05] to-transparent p-8 text-center">
          <h2 className="text-balance text-2xl font-semibold tracking-[-0.02em]">See your own savings in about a minute.</h2>
          <p className="max-w-lg text-sm text-white/50">
            Ask a few questions, then open Memory — every cached answer shows the tokens and dollars it saved.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/chat" className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-medium text-black hover:bg-white/90">
              Start chatting <ArrowRight size={15} />
            </Link>
            <Link href="/signin" className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-4 py-2.5 text-sm text-white/80 hover:bg-white/[0.06]">
              Sign in to save history
            </Link>
          </div>
        </section>

        <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/8 py-5 text-[11px] text-white/30">
          <span>Noor AI · beyond intelligence</span>
          <span className="flex gap-4">
            <Link href="/" className="hover:text-white/60">Home</Link>
            <Link href="/chat" className="hover:text-white/60">Chat</Link>
            <Link href="/memory" className="hover:text-white/60">Memory</Link>
          </span>
        </footer>
      </div>
    </main>
  );
}
