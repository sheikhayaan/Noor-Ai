"use server";

export type PlaygroundResult = {
  summary: string;
  confidence: number;
  modules: string[];
};

export async function simulateNoorPrompt(prompt: string): Promise<PlaygroundResult> {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  const topic = cleaned.length > 0 ? cleaned : "multi-modal intelligence";

  return {
    summary: `Noor synthesized a live workspace for "${topic}" with research, code, image, and memory routes prepared.`,
    confidence: 0.97,
    modules: ["Deep Research", "Code Generation", "Image Creation", "Agent Planning"],
  };
}
