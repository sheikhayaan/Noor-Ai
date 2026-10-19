"use client";

import Lenis from "lenis";
import { usePathname } from "next/navigation";
import { ReactNode, useEffect } from "react";
import { useUiStore } from "@/store/useUiStore";

export function SmoothScrollProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const setScrollProgress = useUiStore((state) => state.setScrollProgress);

  useEffect(() => {
    if (pathname.startsWith("/chat")) {
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      setScrollProgress(0);
      return () => {
        document.documentElement.style.overflow = "";
        document.body.style.overflow = "";
      };
    }

    const lenis = new Lenis({
      duration: 1.08,
      easing: (time: number) => Math.min(1, 1.001 - 2 ** (-10 * time)),
      smoothWheel: true,
      wheelMultiplier: 0.92,
    });

    let raf = 0;

    function update(time: number) {
      lenis.raf(time);
      const limit = Math.max(lenis.limit, 1);
      setScrollProgress(lenis.scroll / limit);
      raf = requestAnimationFrame(update);
    }

    raf = requestAnimationFrame(update);

    return () => {
      cancelAnimationFrame(raf);
      lenis.destroy();
    };
  }, [pathname, setScrollProgress]);

  return <>{children}</>;
}
