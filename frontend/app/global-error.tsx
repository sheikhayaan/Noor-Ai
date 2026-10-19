"use client";

// Last-resort boundary: replaces the white screen with something actionable.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#08090b", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
        <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24 }}>
          <div style={{ maxWidth: 420, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 24, padding: 24, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, margin: 0 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: "rgba(255,255,255,0.6)" }}>
              Noor could not finish loading this view. Reloading usually fixes it.
            </p>
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 12, borderRadius: 12, border: 0, background: "#fff", color: "#000", padding: "10px 16px", fontSize: 14, cursor: "pointer" }}
            >
              Reload
            </button>
            {error.digest ? (
              <p style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 12 }}>ref {error.digest}</p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
