"use client";

// Standalone sign-in. Deliberately its own route (not a modal): the modal
// covered the composer, so a user could not see what signing in would unlock.
// Here the value is on-screen next to the buttons.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, BrainCircuit, Check, Loader2, LogIn, PiggyBank, ShieldCheck, Sparkles, UserRound } from "lucide-react";

import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { ensureGuestSession, type NoorUser } from "@/lib/api";

const USER_KEY = "noor.user.v2";

const BENEFITS = [
  { icon: <BrainCircuit size={16} />, title: "Your chat history", body: "Every conversation is saved to your account and available on any device." },
  { icon: <PiggyBank size={16} />, title: "Your savings, itemised", body: "See tokens reused from the semantic cache and what that saved you, per day." },
  { icon: <ShieldCheck size={16} />, title: "Your own model keys", body: "Attach a Claude / GPT / Gemini key. It is encrypted and never shared with anyone." },
  { icon: <Sparkles size={16} />, title: "Memory that follows you", body: "Noor remembers your preferences and learns from your conversations." },
];

export default function SignInPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [guestBusy, setGuestBusy] = useState(false);

  function signedIn(user: NoorUser) {
    try {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch {
      /* private mode — the HttpOnly cookie still carries the session */
    }
    router.push("/chat");
  }

  async function continueAsGuest() {
    setGuestBusy(true);
    setError(null);
    try {
      await ensureGuestSession();
      router.push("/chat");
    } catch {
      setError("Could not reach the Noor backend. Is it running on :8000?");
    } finally {
      setGuestBusy(false);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#07080a] text-white">
      {/* Ambient glow — pure CSS, no image payload. */}
      <div className="pointer-events-none absolute -left-40 top-[-10rem] h-[34rem] w-[34rem] rounded-full bg-cyan-300/12 blur-[120px]" />
      <div className="pointer-events-none absolute -right-32 bottom-[-12rem] h-[30rem] w-[30rem] rounded-full bg-violet-400/12 blur-[120px]" />

      <div className="relative mx-auto flex min-h-dvh max-w-6xl flex-col px-5 py-6">
        <header className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-200 text-slate-950">
              <Sparkles size={16} />
            </span>
            Noor AI
          </Link>
          <Link href="/why" className="text-xs text-white/55 transition hover:text-white">
            How it works →
          </Link>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr]">
          {/* Left: the promise */}
          <section>
            <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/55">
              <ShieldCheck size={12} /> Encrypted · private by default
            </p>
            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] md:text-5xl">
              Sign in and keep <span className="bg-gradient-to-r from-cyan-200 to-violet-200 bg-clip-text text-transparent">everything</span> you built.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/55">
              Guests get a working chat, but history, savings and memory live with an account.
              Signing in takes one tap — no password, no card.
            </p>

            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {BENEFITS.map((benefit) => (
                <li key={benefit.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-xl bg-cyan-200/12 text-cyan-100">
                    {benefit.icon}
                  </span>
                  <p className="text-sm font-medium text-white/90">{benefit.title}</p>
                  <p className="mt-1 text-xs leading-5 text-white/45">{benefit.body}</p>
                </li>
              ))}
            </ul>
          </section>

          {/* Right: the card */}
          <section className="rounded-3xl border border-white/10 bg-[#0e0f13]/90 p-6 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur">
            <h2 className="text-lg font-semibold">Welcome back</h2>
            <p className="mt-1 text-xs text-white/45">Continue with Google, or start as a guest.</p>

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
              <GoogleSignInButton onSignedIn={signedIn} onError={setError} />
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-white/35">
                <Check size={12} className="text-emerald-300" /> We store your email and name only.
              </p>
            </div>

            <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-[0.18em] text-white/25">
              <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
            </div>

            <button
              type="button"
              onClick={continueAsGuest}
              disabled={guestBusy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.04] px-4 py-3 text-sm text-white/80 transition hover:bg-white/[0.08] disabled:opacity-50"
            >
              {guestBusy ? <Loader2 size={16} className="animate-spin" /> : <UserRound size={16} />}
              Continue as guest
              <ArrowRight size={15} className="opacity-60" />
            </button>

            {error && (
              <p className="mt-4 rounded-xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
                {error}
              </p>
            )}

            <div className="mt-6 space-y-2 border-t border-white/8 pt-4 text-[11px] text-white/35">
              <p className="flex items-center gap-2"><LogIn size={12} /> Sessions last 30 days and are revocable.</p>
              <p className="flex items-center gap-2"><ShieldCheck size={12} /> API keys are AES-256-GCM encrypted at rest.</p>
            </div>
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/8 pt-4 text-[11px] text-white/30">
          <span>Noor AI · beyond intelligence</span>
          <span className="flex gap-4">
            <Link href="/chat" className="hover:text-white/60">Chat</Link>
            <Link href="/memory" className="hover:text-white/60">Memory</Link>
            <Link href="/why" className="hover:text-white/60">Why Noor</Link>
          </span>
        </footer>
      </div>
    </main>
  );
}
