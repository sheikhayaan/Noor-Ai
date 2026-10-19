"use client";

// Route-level error boundary. Without this a render error in the chat tree
// unmounts the page and leaves a blank white screen with no explanation.
import { useEffect } from "react";
import Link from "next/link";

export default function ChatError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Noor chat render error:", error);
  }, [error]);

  return (
    <main className="grid min-h-dvh place-items-center bg-[#08090b] px-5 text-white">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-[#0e0f13] p-6 text-center">
        <h1 className="text-lg font-semibold">The chat view hit an error</h1>
        <p className="mt-2 text-sm leading-6 text-white/55">
          Your conversations are stored on the server, so nothing is lost. Reload the view to continue.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-black hover:bg-white/90"
          >
            Try again
          </button>
          <Link href="/" className="rounded-xl border border-white/12 px-4 py-2 text-sm text-white/75 hover:bg-white/[0.06]">
            Home
          </Link>
        </div>
        {error.digest ? <p className="mt-4 font-mono text-[10px] text-white/25">ref {error.digest}</p> : null}
      </div>
    </main>
  );
}
