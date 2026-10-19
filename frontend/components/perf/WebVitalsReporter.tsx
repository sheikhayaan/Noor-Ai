"use client";

import { useReportWebVitals } from "next/web-vitals";
import { reportWebVital } from "@/lib/api";

/**
 * Streams Core Web Vitals (LCP, INP, CLS, FCP, TTFB) to the Noor backend for
 * real-user monitoring — no third-party analytics, no new dependency (the hook
 * ships with Next.js). Renders nothing; mount once in the root layout.
 */
export function WebVitalsReporter() {
  useReportWebVitals((metric) => {
    reportWebVital({
      name: metric.name,
      value: metric.value,
      rating: (metric as { rating?: string }).rating,
      id: metric.id,
      delta: metric.delta,
      navigationType: (metric as { navigationType?: string }).navigationType,
    });
  });

  return null;
}
