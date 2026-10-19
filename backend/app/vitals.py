"""Core Web Vitals telemetry (SYSTEM 2 — performance).

Collects the Core Web Vitals the browser reports (via the frontend's
``useReportWebVitals`` hook) so real-user performance is observable without any
third-party analytics or a new runtime dependency. Storage is a bounded,
process-local ring buffer per metric — honest, privacy-preserving (no PII, no
persistence), and self-limiting. A GET summary exposes count + p75 (the standard
Core Web Vitals aggregation) plus a good/needs-improvement/poor rating, which is
exactly what a performance dashboard needs.

Design notes
------------
  * Deliberately unauthenticated and exempt from ``NOOR_AUTH_ENFORCE``. Vitals
    fire on every page load — including before a session exists — and carry no
    user data, so requiring auth would only drop samples. We read the session
    id (if any) as a best-effort label and never call ``resolve_user_id`` here.
  * Never breaks a page. Reporting is fire-and-forget on the client; the server
    just validates, records, and returns ``{"ok": true}``.
"""
from __future__ import annotations

import logging
import threading
from collections import defaultdict, deque
from typing import Deque, Dict, List

from fastapi import APIRouter, Depends

from backend.app.auth import SessionIdentity, get_current_user
from backend.app.schemas import (
    VitalMetricSummary,
    VitalsSummaryResponse,
    WebVitalReport,
)

logger = logging.getLogger("noor.vitals")

router = APIRouter(prefix="/api", tags=["performance"])

# Bounded, process-local storage. Core Web Vitals are summarized at the 75th
# percentile, so we keep the most recent N samples per metric and compute p75 on
# read. deque(maxlen=...) drops the oldest sample automatically — no unbounded
# growth, no lock contention beyond a cheap append.
_MAX_SAMPLES = 500
_samples: Dict[str, Deque[float]] = defaultdict(lambda: deque(maxlen=_MAX_SAMPLES))
_lock = threading.Lock()

# Google's Core Web Vitals thresholds: (good_max, needs_improvement_max).
# At or below good_max -> "good"; at or below ni_max -> "needs-improvement";
# above -> "poor". CLS is unitless; the rest are milliseconds.
_THRESHOLDS = {
    "LCP": (2500.0, 4000.0),
    "INP": (200.0, 500.0),
    "CLS": (0.1, 0.25),
    "FCP": (1800.0, 3000.0),
    "TTFB": (800.0, 1800.0),
    "FID": (100.0, 300.0),
}


def _percentile(values: List[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    # Nearest-rank on a 0-based index, clamped to the array bounds.
    idx = int(round((pct / 100.0) * (len(ordered) - 1)))
    idx = max(0, min(len(ordered) - 1, idx))
    return ordered[idx]


def _rate(name: str, value: float) -> str | None:
    bounds = _THRESHOLDS.get(name.upper())
    if bounds is None:
        return None
    good_max, ni_max = bounds
    if value <= good_max:
        return "good"
    if value <= ni_max:
        return "needs-improvement"
    return "poor"


@router.post("/vitals")
def report_vital(
    report: WebVitalReport,
    session: SessionIdentity | None = Depends(get_current_user),
):
    """Record one Core Web Vital sample. Fire-and-forget from the client."""
    with _lock:
        _samples[report.name].append(report.value)
    logger.info(
        "vital name=%s value=%.2f rating=%s path=%s user=%s",
        report.name,
        report.value,
        report.rating or _rate(report.name, report.value) or "-",
        report.path or "-",
        session.user_id if session else "anon",
    )
    return {"ok": True}


@router.get("/vitals", response_model=VitalsSummaryResponse)
def vitals_summary():
    """Per-metric count + p75 + rating, computed from real collected samples."""
    with _lock:
        snapshot = {name: list(values) for name, values in _samples.items()}

    metrics = [
        VitalMetricSummary(
            name=name,
            count=len(values),
            p75=round(_percentile(values, 75), 2),
            rating=_rate(name, _percentile(values, 75)),
        )
        for name, values in sorted(snapshot.items())
    ]
    return VitalsSummaryResponse(metrics=metrics)
