"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { motion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, BrainCircuit, Check, Cpu, Gauge, LockKeyhole, Network, Send, Shield, Sparkles, Zap } from "lucide-react";
import { FormEvent, useState, useTransition } from "react";
import { simulateNoorPrompt, type PlaygroundResult } from "@/app/actions";
import { useMouse } from "@/hooks/useMouse";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/store/useUiStore";
import { Button } from "@/components/ui/button";

const Scene = dynamic(() => import("@/components/canvas/Scene").then((mod) => mod.Scene), {
  ssr: false,
  loading: () => <div className="fixed inset-0 bg-noor-bg" />,
});

const benchmarkCards = [
  { label: "Deep work", value: "Research", detail: "Turn questions into structured plans and crisp decisions.", icon: Gauge },
  { label: "Creative flow", value: "Create", detail: "Draft, prompt, storyboard, and polish launch assets.", icon: BrainCircuit },
  { label: "Builder mode", value: "Code", detail: "Move from idea to implementation with verification steps.", icon: Zap },
  { label: "Agent mesh", value: "Agents", detail: "Coordinate specialized work without cluttering the interface.", icon: Network },
];

const credibilityCards = [
  { title: "Research", body: "Turn scattered sources into structured briefs, citation maps, and decision-ready summaries." },
  { title: "Creation", body: "Move from prompt to image, video plan, brand copy, and launch assets in one flow." },
  { title: "Code", body: "Analyze architecture, generate implementation plans, and keep fixes tied to verification." },
  { title: "Agents", body: "Route tasks through dedicated research, writing, coding, image, and business operators." },
];

const useCases = ["Founders", "Students", "Developers", "Researchers", "Creators", "Teams"];

const launchStats = [
  ["1", "workspace for serious AI work"],
  ["5", "dedicated Noor Gems"],
  ["24/7", "research, creation, code, and agents"],
];

const navLinks = [
  { label: "Platform", href: "#platform" },
  { label: "Core", href: "#core" },
  { label: "Playground", href: "#playground" },
  { label: "Performance", href: "#performance" },
];

export function NoorLandingExperience() {
  const { mouseRef } = useMouse(0.11);
  const { scrollYProgress } = useScroll();
  const setHoveredObject = useUiStore((state) => state.setHoveredObject);
  const currentSection = useUiStore((state) => state.currentSection);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.18], [1, 0.22]);
  const heroY = useTransform(scrollYProgress, [0, 0.22], [0, -80]);

  return (
    <main className="noor-home relative min-h-[420vh] overflow-clip bg-noor-bg text-white">
      <Scene mouseRef={mouseRef} />
      <div className="noise-overlay pointer-events-none fixed inset-0 z-10" />

      <nav className="fixed left-0 right-0 top-0 z-40 px-4 py-4 md:px-6">
        <div className="noor-nav-shell glass-panel mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 rounded-[1.35rem] px-3 md:px-4">
          <Link
            className="flex min-w-0 items-center gap-3 rounded-full px-2 py-1.5"
            onPointerEnter={() => setHoveredObject("cta")}
            onPointerLeave={() => setHoveredObject(null)}
            href="/"
          >
            <span className="noor-logo-mark flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cyan-100 text-sm font-black text-slate-950 shadow-[0_0_34px_rgba(103,255,235,0.35)]">
              N
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-black tracking-[-0.02em] text-white">Noor AI</span>
              <span className="hidden text-[11px] font-medium text-white/42 sm:block">Multimodal intelligence OS</span>
            </span>
          </Link>

          <div className="hidden items-center gap-1 rounded-full border border-white/8 bg-black/18 p-1 text-sm text-white/58 lg:flex">
            {navLinks.map((item) => (
              <a className="rounded-full px-3.5 py-2 transition hover:bg-white/[0.07] hover:text-white" href={item.href} key={item.label}>
                {item.label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-2 rounded-full border border-cyan-200/14 bg-cyan-200/[0.055] px-3 py-2 text-xs font-semibold text-cyan-100 md:flex">
            <span className="h-2 w-2 rounded-full bg-cyan-200 shadow-[0_0_14px_rgba(103,255,235,0.9)]" />
            {currentSection}
          </div>

          <div className="flex items-center gap-2">
            <Button asChild className="hidden md:inline-flex" size="md" variant="ghost">
              <Link href="/chat">Sign in</Link>
            </Button>
            <Button
              asChild
              size="md"
              onPointerEnter={() => setHoveredObject("cta")}
              onPointerLeave={() => setHoveredObject(null)}
            >
              <Link href="/chat">Try Noor <ArrowRight size={16} /></Link>
            </Button>
          </div>
        </div>
      </nav>

      <section id="core" className="noor-hero-section sticky top-0 z-20 flex min-h-screen items-center px-5 py-28 md:px-8 lg:py-24">
        <motion.div style={{ opacity: heroOpacity, y: heroY }} className="mx-auto grid w-full max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(320px,0.62fr)] xl:gap-12">
          <div className="min-w-0">
            <motion.p
              className="mb-5 text-xs font-black uppercase tracking-[0.38em] text-cyan-200/80"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7 }}
            >
              One AI workspace / research, creation, code, agents
            </motion.p>
            <motion.h1
              className="text-holo noor-kinetic-title max-w-5xl text-balance text-[clamp(3.35rem,10vw,7.7rem)] font-black leading-[0.98] tracking-[-0.045em] xl:text-[clamp(6rem,8.2vw,8.1rem)]"
              initial={{ opacity: 0, y: 34 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            >
              Noor AI: Beyond Intelligence
            </motion.h1>
            <motion.div
              className="mt-5 flex flex-wrap gap-2"
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.16, duration: 0.7 }}
            >
              {["Research", "Creation", "Code", "Agents"].map((item) => (
                <span className="rounded-full border border-cyan-200/16 bg-cyan-200/[0.055] px-3 py-1.5 text-xs font-semibold text-cyan-100 shadow-[0_0_22px_rgba(103,255,235,0.08)]" key={item}>
                  {item}
                </span>
              ))}
            </motion.div>
            <motion.p
              className="mt-7 max-w-2xl text-pretty text-lg leading-8 text-white/64 md:text-xl"
              initial={{ opacity: 0, y: 26 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.8 }}
            >
              A premium AI operating space for founders, builders, creators, and teams who want every mode of intelligence in one calm product.
            </motion.p>
            <motion.div
              className="mt-9 flex flex-col gap-3 sm:flex-row"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32, duration: 0.75 }}
            >
              <Button asChild size="lg" onPointerEnter={() => setHoveredObject("cta")} onPointerLeave={() => setHoveredObject(null)}>
                <Link href="/chat">Try Noor <Sparkles size={18} /></Link>
              </Button>
              <Button size="lg" variant="glass">
                Watch Core
              </Button>
            </motion.div>
          </div>

          <ProductConstellation />
        </motion.div>
      </section>

      <section id="platform" className="relative z-30 mx-auto grid min-h-screen max-w-7xl content-center gap-6 px-5 py-32 md:px-8">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.34em] text-cyan-200/70">Platform</p>
          <h2 className="text-balance text-4xl font-black tracking-[-0.03em] md:text-6xl">Everything important in one intelligent workspace.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {benchmarkCards.map((card, index) => {
            const Icon = card.icon;
            return (
              <motion.article
                className="glass-panel group min-h-64 rounded-[1.75rem] p-5"
                key={card.label}
                initial={{ opacity: 0, y: 36 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ delay: index * 0.08, duration: 0.7 }}
                onPointerEnter={() => setHoveredObject("bento-card")}
                onPointerLeave={() => setHoveredObject(null)}
              >
                <Icon className="mb-10 text-cyan-200 transition group-hover:scale-110" size={30} />
                <strong className="text-5xl font-black tracking-[-0.05em]">{card.value}</strong>
                <h3 className="mt-5 font-bold">{card.label}</h3>
                <p className="mt-2 text-sm leading-6 text-white/54">{card.detail}</p>
              </motion.article>
            );
          })}
        </div>
      </section>

      <section className="relative z-30 mx-auto grid min-h-screen max-w-7xl content-center gap-8 px-5 py-28 md:px-8">
        <div className="max-w-3xl">
          <p className="mb-4 text-xs font-black uppercase tracking-[0.34em] text-cyan-200/70">Why Noor</p>
          <h2 className="text-balance text-4xl font-black tracking-[-0.03em] md:text-6xl">One AI workspace for research, creation, code, and agents.</h2>
          <p className="mt-5 text-lg leading-8 text-white/58">
            Noor is positioned as a calm operating system for serious work, not another chat box with scattered tools.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-4">
          {credibilityCards.map((card) => (
            <article className="glass-panel rounded-[1.5rem] p-5" key={card.title}>
              <Check className="mb-8 text-cyan-200" size={24} />
              <h3 className="text-xl font-bold">{card.title}</h3>
              <p className="mt-3 text-sm leading-6 text-white/54">{card.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="relative z-30 mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-28 md:grid-cols-[0.82fr_1fr] md:px-8">
        <div className="glass-panel rounded-[2rem] p-8 md:p-10">
          <Shield className="mb-8 text-cyan-200" size={34} />
          <h2 className="text-balance text-4xl font-black tracking-[-0.03em] md:text-5xl">Built for trust before scale.</h2>
          <p className="mt-5 text-lg leading-8 text-white/58">
            Noor centers privacy, memory control, usage visibility, and clear routing so teams can trust the workspace from day one.
          </p>
          <div className="mt-7 grid gap-3">
            {["User-controlled memory", "Visible usage limits", "Private workspaces", "Clear mode routing"].map((item) => (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm text-white/72" key={item}>
                <LockKeyhole className="text-cyan-200" size={16} /> {item}
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-4 text-xs font-black uppercase tracking-[0.34em] text-cyan-200/70">Use cases</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {useCases.map((item) => (
              <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-5 text-lg font-semibold text-white/82" key={item}>{item}</div>
            ))}
          </div>
        </div>
      </section>

      <section id="playground" className="relative z-30 mx-auto grid min-h-screen max-w-7xl items-center gap-8 px-5 py-28 md:grid-cols-[0.82fr_1fr] md:px-8">
        <div>
          <p className="mb-4 text-xs font-black uppercase tracking-[0.34em] text-cyan-200/70">Interactive playground</p>
          <h2 className="text-balance text-4xl font-black tracking-[-0.03em] md:text-6xl">Type once. Watch the intelligence structure respond.</h2>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/58">
            Try the product flow: ask, attach context, choose a mode, and watch Noor shape the workspace around the task.
          </p>
        </div>
        <PlaygroundTerminal />
      </section>

      <section id="performance" className="relative z-30 mx-auto flex min-h-screen max-w-7xl items-center px-5 py-28 md:px-8">
        <div className="glass-panel max-w-4xl rounded-[2rem] p-8 md:p-12">
          <Cpu className="mb-8 text-cyan-200" size={38} />
          <h2 className="text-balance text-4xl font-black tracking-[-0.03em] md:text-6xl">Built for speed, memory, and cinematic clarity.</h2>
          <p className="mt-6 text-lg leading-8 text-white/60">
            Noor keeps the interface fast, readable, and calm while the intelligence layer handles complex research, creation, code, and agent workflows behind the scenes.
          </p>
        </div>
      </section>

      <section className="relative z-30 mx-auto grid min-h-screen max-w-7xl content-center gap-8 px-5 py-28 md:px-8">
        <div className="grid gap-4 md:grid-cols-3">
          {launchStats.map(([value, label]) => (
            <div className="glass-panel rounded-[1.7rem] p-6" key={label}>
              <strong className="text-5xl font-black tracking-[-0.05em] text-holo">{value}</strong>
              <p className="mt-4 text-sm uppercase tracking-[0.18em] text-white/46">{label}</p>
            </div>
          ))}
        </div>
        <div className="glass-panel grid gap-8 rounded-[2rem] p-6 md:grid-cols-[1fr_0.8fr] md:p-10">
          <div>
            <p className="mb-4 text-xs font-black uppercase tracking-[0.34em] text-cyan-200/70">Early access</p>
            <h2 className="text-balance text-4xl font-black tracking-[-0.03em] md:text-6xl">Join the Noor launch list.</h2>
            <p className="mt-5 text-lg leading-8 text-white/58">
              Get updates, private beta access, and founder notes as Noor becomes a complete AI workspace.
            </p>
          </div>
          <WaitlistForm />
        </div>
      </section>
    </main>
  );
}

function ProductConstellation() {
  const cards = [
    { title: "Research", body: "Source graph", position: "left-[4%] top-[18%] rotate-[-10deg]" },
    { title: "Code", body: "Live build plan", position: "right-[2%] top-[30%] rotate-[9deg]" },
    { title: "Create", body: "Image and video", position: "left-[12%] bottom-[16%] rotate-[7deg]" },
    { title: "Agents", body: "Task mesh", position: "right-[10%] bottom-[10%] rotate-[-8deg]" },
  ];

  return (
    <motion.div
      className="noor-product-orbit hidden min-h-[520px] overflow-visible lg:block"
      initial={{ opacity: 0, x: 40, rotateY: -12 }}
      animate={{ opacity: 1, x: 0, rotateY: 0 }}
      transition={{ delay: 0.24, duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="noor-orbit-ring noor-orbit-ring-a" />
      <div className="noor-orbit-ring noor-orbit-ring-b" />
      <div className="noor-core-preview">
        <span />
        <strong>Noor OS</strong>
        <small>Unified intelligence workspace</small>
      </div>
      {cards.map((card, index) => (
        <motion.div
          className={cn("noor-floating-card absolute w-44 rounded-3xl p-4", card.position)}
          key={card.title}
          animate={{ y: [0, index % 2 ? -16 : 16, 0], rotateX: [0, index % 2 ? 8 : -8, 0] }}
          transition={{ duration: 5.5 + index * 0.4, repeat: Infinity, ease: "easeInOut" }}
        >
          <span className="mb-8 block h-2 w-12 rounded-full bg-cyan-200 shadow-[0_0_20px_rgba(103,255,235,0.8)]" />
          <strong className="block text-lg">{card.title}</strong>
          <small className="mt-1 block text-white/48">{card.body}</small>
        </motion.div>
      ))}
    </motion.div>
  );
}

function PlaygroundTerminal() {
  const [prompt, setPrompt] = useState("Design a launch plan for Noor AI with research, code, image, and video agents.");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const setHoveredObject = useUiStore((state) => state.setHoveredObject);
  const triggerPlaygroundPulse = useUiStore((state) => state.triggerPlaygroundPulse);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const response = await simulateNoorPrompt(prompt);
      setResult(response);
      triggerPlaygroundPulse();
    });
  }

  return (
    <form
      className="glass-panel rounded-[2rem] p-4 md:p-6"
      onSubmit={onSubmit}
      onPointerEnter={() => setHoveredObject("terminal")}
      onPointerLeave={() => setHoveredObject(null)}
    >
      <div className="mb-4 flex items-center gap-2 text-xs uppercase tracking-[0.26em] text-white/46">
        <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-yellow-200" />
        <span className="h-2.5 w-2.5 rounded-full bg-cyan-200" />
        <span className="ml-auto">Noor terminal</span>
      </div>
      <textarea
        className="min-h-40 w-full resize-none rounded-3xl border border-white/10 bg-black/30 p-5 text-base leading-7 text-white outline-none transition placeholder:text-white/30 focus:border-cyan-200/50"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-white/44">Press run to pulse the 3D core.</p>
        <Button disabled={isPending} type="submit">
          {isPending ? "Synthesizing" : "Run"} <Send size={16} />
        </Button>
      </div>
      <div className="mt-5 rounded-3xl border border-cyan-200/12 bg-cyan-200/[0.04] p-5">
        <p className="text-sm leading-6 text-white/64">
          {result?.summary ?? "Awaiting prompt. Noor will assemble a live multi-modal plan here."}
        </p>
        {result && (
          <div className="mt-4 flex flex-wrap gap-2">
            {result.modules.map((module) => (
              <span className="rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-xs text-cyan-100" key={module}>
                {module}
              </span>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!email.trim()) return;
    localStorage.setItem("noor.waitlist.email", email.trim());
    setJoined(true);
  }

  return (
    <form className="rounded-3xl border border-white/10 bg-black/24 p-4" onSubmit={submit}>
      <label className="text-sm font-semibold text-white/72" htmlFor="waitlist-email">Email</label>
      <input
        id="waitlist-email"
        className="mt-2 h-13 w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 text-white outline-none focus:border-cyan-200/50"
        placeholder="you@company.com"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
      />
      <Button className="mt-4 w-full" type="submit">{joined ? "You are on the list" : "Request early access"}</Button>
      <p className="mt-4 text-center text-xs leading-5 text-white/38">No spam. Just launch updates and beta access.</p>
    </form>
  );
}
