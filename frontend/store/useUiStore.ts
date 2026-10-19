"use client";

import { create } from "zustand";

export type NoorSection = "Hero" | "Features" | "AI Core" | "Performance";
export type HoveredObject = "core" | "cta" | "terminal" | "bento-card" | null;

type UiState = {
  scrollProgress: number;
  currentSection: NoorSection;
  hoveredObject: HoveredObject;
  playgroundPulse: number;
  setScrollProgress: (value: number) => void;
  setCurrentSection: (section: NoorSection) => void;
  setHoveredObject: (object: HoveredObject) => void;
  triggerPlaygroundPulse: () => void;
};

function sectionFromProgress(progress: number): NoorSection {
  if (progress < 0.26) return "Hero";
  if (progress < 0.54) return "Features";
  if (progress < 0.78) return "AI Core";
  return "Performance";
}

export const useUiStore = create<UiState>((set) => ({
  scrollProgress: 0,
  currentSection: "Hero",
  hoveredObject: null,
  playgroundPulse: 0,
  setScrollProgress: (value) => {
    const progress = Math.min(1, Math.max(0, value));
    set({ scrollProgress: progress, currentSection: sectionFromProgress(progress) });
  },
  setCurrentSection: (section) => set({ currentSection: section }),
  setHoveredObject: (object) => set({ hoveredObject: object }),
  triggerPlaygroundPulse: () => set((state) => ({ playgroundPulse: state.playgroundPulse + 1 })),
}));
