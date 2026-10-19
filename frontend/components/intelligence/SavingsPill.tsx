"use client";

import { motion } from "framer-motion";
import { Brain, Coins, Sparkles, Zap } from "lucide-react";
import { useEffect, useRef, useState } from "react";

// The subset of the intelligent-chat response the UI treats as "savings".
export type ResponseSavings = {
  tokensSaved: number;
  costSaved: number;
  memoriesUsed: number;
  cacheResult: string; // "HIT" | "MISS"
  model: string;
  levelsApplied: string[];
};

// Count from 0 → target with an easeOutCubic curve, driven by rAF so it stays
// smooth without depending on any particular framer-motion animate API.
function useCountUp(target: number, durationMs = 850): number {
  const [value, setValue] = useState(0);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    let start: number | null = null;
    const tick = (now: number) => {
      if (start === null) start = now;
      const progress = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(target * eased);
      if (progress < 1) frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs]);

  return value;
}

export function SavingsPill({ savings }: { savings: ResponseSavings }) {
  const tokens = Math.round(useCountUp(savings.tokensSaved));
  const cacheHit = savings.cacheResult?.toUpperCase() === "HIT";

  // Only surface the pill when there's something honest to show.
  const meaningful = savings.tokensSaved > 0 || savings.memoriesUsed > 0 || cacheHit;
  if (!meaningful) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="mt-2 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-1.5 text-[11px] font-medium text-cyan-100/80 backdrop-blur-sm"
      title="Noor saved you tokens by reusing memory and Gateway's semantic cache."
    >
      <span className="inline-flex items-center gap-1.5 text-cyan-200">
        <Sparkles className="h-3.5 w-3.5" />
        Saved {tokens.toLocaleString()} tokens
      </span>
      {cacheHit && (
        <span className="inline-flex items-center gap-1 text-emerald-300/80">
          <Zap className="h-3 w-3" /> cache hit
        </span>
      )}
      {savings.memoriesUsed > 0 && (
        <span className="inline-flex items-center gap-1 text-white/50">
          <Brain className="h-3 w-3" />
          {savings.memoriesUsed} {savings.memoriesUsed === 1 ? "memory" : "memories"}
        </span>
      )}
      {savings.costSaved > 0 && (
        <span className="inline-flex items-center gap-1 text-white/40">
          <Coins className="h-3 w-3" /> ${savings.costSaved.toFixed(6)}
        </span>
      )}
    </motion.div>
  );
}
