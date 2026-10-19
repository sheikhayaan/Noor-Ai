"use client";

import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

export type SmoothMouse = {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
};

export type SmoothMouseRef = MutableRefObject<SmoothMouse>;

const initialMouse: SmoothMouse = {
  x: 0,
  y: 0,
  targetX: 0,
  targetY: 0,
};

export function useMouse(damping = 0.12) {
  const mouseRef = useRef<SmoothMouse>({ ...initialMouse });
  const [mouse, setMouse] = useState<SmoothMouse>(initialMouse);

  useEffect(() => {
    let raf = 0;
    let lastCommit = 0;

    function onPointerMove(event: PointerEvent) {
      const width = Math.max(window.innerWidth, 1);
      const height = Math.max(window.innerHeight, 1);
      mouseRef.current.targetX = event.clientX / width - 0.5;
      mouseRef.current.targetY = event.clientY / height - 0.5;
    }

    function tick(now: number) {
      const current = mouseRef.current;
      current.x += (current.targetX - current.x) * damping;
      current.y += (current.targetY - current.y) * damping;

      // React state is committed at a lower rate; R3F reads the ref every frame.
      if (now - lastCommit > 80) {
        lastCommit = now;
        setMouse({ ...current });
      }

      raf = requestAnimationFrame(tick);
    }

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      cancelAnimationFrame(raf);
    };
  }, [damping]);

  return { mouse, mouseRef };
}
