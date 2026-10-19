"use client";

// Per-answer cost detail, collapsed by default.
//
// The numbers are real and worth showing, but they are diagnostics — they were
// previously printed under every single answer, which made the transcript read
// like a debug log. Collapsed by default, one click to open, nothing faked.

import { motion } from "framer-motion";
import { Brain, ChevronDown, Coins, Cpu, Sparkles, Zap } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

// The subset of the intelligent-chat response the UI treats as "savings".
export type ResponseSavings = {
  tokensSaved: number;
  costSaved: number;
  memoriesUsed: number;
  cacheResult: string; // "HIT" | "MISS"
  model: string;
  levelsApplied: string[];
};

export function SavingsPill({ savings }: { savings: ResponseSavings }) {
  const cacheHit = savings.cacheResult?.toUpperCase() === "HIT";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.05] px-3 py-2 text-[11px] text-cyan-100/80">
      <span className="inline-flex items-center gap-1.5 font-medium text-cyan-200">
        <Sparkles className="h-3.5 w-3.5" />
        {Math.round(savings.tokensSaved).toLocaleString()} tokens reused
      </span>
      {cacheHit && (
        <span className="inline-flex items-center gap-1 text-emerald-300/80">
          <Zap className="h-3 w-3" /> semantic cache hit
        </span>
      )}
      {savings.memoriesUsed > 0 && (
        <span className="inline-flex items-center gap-1 text-white/50">
          <Brain className="h-3 w-3" /> {savings.memoriesUsed} memory
        </span>
      )}
      {savings.costSaved > 0 && (
        <span className="inline-flex items-center gap-1 text-white/45">
          <Coins className="h-3 w-3" /> ${savings.costSaved.toFixed(6)} saved
        </span>
      )}
      {savings.model && (
        <span className="inline-flex items-center gap-1 text-white/40">
          <Cpu className="h-3 w-3" /> {savings.model}
        </span>
      )}
    </div>
  );
}

/** Compact one-line summary that expands into the full breakdown. */
export function ResponseDetails({ savings }: { savings: ResponseSavings }) {
  const [open, setOpen] = useState(false);
  const cacheHit = savings.cacheResult?.toUpperCase() === "HIT";

  const summary = cacheHit
    ? `Cache hit · saved ${Math.round(savings.tokensSaved).toLocaleString()} tokens`
    : savings.tokensSaved > 0
      ? `Saved ${Math.round(savings.tokensSaved).toLocaleString()} tokens`
      : "Details";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition",
          cacheHit
            ? "border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200/80 hover:bg-emerald-300/[0.1]"
            : "border-white/10 bg-white/[0.03] text-white/40 hover:bg-white/[0.07] hover:text-white/70",
        )}
      >
        {cacheHit ? <Zap size={11} /> : <Sparkles size={11} />}
        {summary}
        <ChevronDown size={11} className={cn("transition", open && "rotate-180")} />
      </button>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="mt-2"
        >
          <SavingsPill savings={savings} />
          <p className="mt-1.5 text-[10.5px] leading-4 text-white/28">
            Reused tokens never reach the model, so you are not billed for them. Nothing about this
            answer leaves your account.
          </p>
        </motion.div>
      )}
    </div>
  );
}
