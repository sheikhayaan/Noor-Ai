"""Concurrency sanity probe for chat throughput and backpressure.

Answers the only question that matters before claiming "it scales": when many
clients hammer the API at once, does latency stay bounded and does overload
surface as a fast 429 instead of a stall?

Usage (backend already running):

    .venv\\Scripts\\python.exe scripts\\load_test.py --concurrency 50 --requests 500
    .venv\\Scripts\\python.exe scripts\\load_test.py --url http://127.0.0.1:8000 --concurrency 200

Notes
-----
* Uses the ``fake`` provider by default of the server you point at, so the
  measurement is Noor's own overhead, not the upstream model's. Run it against a
  gateway-backed server to measure end-to-end latency instead.
* Identities are per-request guests so the per-user limiter does not mask the
  global path; use ``--same-user`` to test the fair-use limiter instead.
"""
from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from typing import Any

import httpx


async def one_request(
    client: httpx.AsyncClient,
    base: str,
    index: int,
    same_user: bool,
    session_id: str | None,
) -> tuple[float, int, str]:
    headers: dict[str, str] = {}
    user_id = "loadtest:shared" if same_user else f"loadtest:{index}"
    if session_id:
        headers["cookie"] = f"noor_session={session_id}"
    started = time.perf_counter()
    try:
        response = await client.post(
            f"{base}/chat",
            json={"message": f"load probe {index}", "gem_id": "general", "user_id": user_id},
            headers=headers,
        )
        elapsed = (time.perf_counter() - started) * 1000
        return elapsed, response.status_code, response.text[:120]
    except Exception as error:  # noqa: BLE001 - the failure mode is the data
        elapsed = (time.perf_counter() - started) * 1000
        return elapsed, 0, f"{type(error).__name__}: {error}"


async def run(args: argparse.Namespace) -> int:
    base = args.url.rstrip("/")
    async with httpx.AsyncClient(timeout=args.timeout) as probe:
        health = await probe.get(f"{base}/health")
        if health.status_code != 200:
            print(f"FAIL  {base}/health -> {health.status_code}. Start the backend first.")
            return 2
        ready = await probe.get(f"{base}/ready")
        if ready.status_code == 200:
            print(f"ready: {ready.json()}")

        session_id = None
        if args.session:
            guest = await probe.post(f"{base}/auth/guest")
            if guest.status_code != 200:
                print(f"FAIL  /auth/guest -> {guest.status_code}")
                return 2
            session_id = guest.cookies.get("noor_session")

    limits = httpx.Limits(
        max_connections=args.concurrency + 10, max_keepalive_connections=args.concurrency
    )
    semaphore = asyncio.Semaphore(args.concurrency)
    results: list[tuple[float, int, str]] = []

    async with httpx.AsyncClient(limits=limits, timeout=args.timeout) as client:

        async def worker(index: int) -> None:
            async with semaphore:
                results.append(await one_request(client, base, index, args.same_user, session_id))

        started = time.perf_counter()
        await asyncio.gather(*(worker(i) for i in range(args.requests)))
        wall = time.perf_counter() - started

    latencies = sorted(item[0] for item in results)
    codes: dict[int, int] = {}
    for _elapsed, status, _body in results:
        codes[status] = codes.get(status, 0) + 1

    def pct(p: float) -> float:
        if not latencies:
            return 0.0
        idx = min(len(latencies) - 1, int(round(p / 100 * (len(latencies) - 1))))
        return latencies[idx]

    ok = codes.get(200, 0)
    shed = codes.get(429, 0) + codes.get(503, 0)
    print("\n--- load probe ---------------------------------")
    print(f"requests        : {args.requests} @ concurrency {args.concurrency}")
    print(f"wall time       : {wall:.2f}s  ({args.requests / wall:.1f} req/s)")
    print(f"status codes    : {dict(sorted(codes.items()))}")
    print(f"latency p50/p95 : {pct(50):.0f} ms / {pct(95):.0f} ms   max {latencies[-1]:.0f} ms")
    print(f"mean latency    : {statistics.fmean(latencies):.0f} ms")
    print(f"served / shed   : {ok} / {shed}")

    failures = [item for item in results if item[1] not in (200, 429, 503)]
    if failures:
        print("\nUnexpected failures:")
        for elapsed, status, body in failures[:5]:
            print(f"  {status} ({elapsed:.0f} ms) {body}")
        return 1

    if pct(95) > args.max_p95_ms:
        print(f"\nFAIL  p95 {pct(95):.0f} ms exceeds --max-p95-ms {args.max_p95_ms}")
        return 1
    print("\nPASS  no unexpected errors, latency within budget.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Chat concurrency probe")
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--concurrency", type=int, default=50)
    parser.add_argument("--requests", type=int, default=200)
    parser.add_argument("--timeout", type=float, default=60.0)
    parser.add_argument("--max-p95-ms", type=float, default=5000.0)
    parser.add_argument("--same-user", action="store_true", help="Hit one identity (limiter test)")
    parser.add_argument("--session", action="store_true", help="Use a guest session cookie")
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
