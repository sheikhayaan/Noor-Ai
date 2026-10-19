"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useMouse } from "@/hooks/useMouse";
import { useUiStore } from "@/store/useUiStore";

export function CustomCursor() {
  const { mouse } = useMouse(0.18);
  const hoveredObject = useUiStore((state) => state.hoveredObject);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const active = hoveredObject !== null;

  useEffect(() => {
    function syncViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    }

    syncViewport();
    window.addEventListener("resize", syncViewport);
    return () => window.removeEventListener("resize", syncViewport);
  }, []);

  return (
    <motion.div
      aria-hidden="true"
      className="pointer-events-none fixed left-1/2 top-1/2 z-[80] hidden h-8 w-8 rounded-full border border-cyan-200/50 mix-blend-screen shadow-[0_0_28px_rgba(103,255,235,0.55)] md:block"
      animate={{
        x: mouse.x * viewport.width,
        y: mouse.y * viewport.height,
        scale: active ? 1.75 : 1,
        opacity: active ? 0.95 : 0.62,
      }}
      transition={{ type: "spring", stiffness: 180, damping: 26, mass: 0.35 }}
    />
  );
}
