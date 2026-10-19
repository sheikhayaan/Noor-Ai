"use client";

import { useEffect, useRef } from "react";
import { googleLogin, type NoorUser } from "@/lib/api";

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? "";

type GsiIdApi = {
  initialize: (config: { client_id: string; callback: (r: { credential?: string }) => void }) => void;
  renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GsiIdApi } };
  }
}

export function GoogleSignInButton({
  onSignedIn,
  onError,
}: {
  onSignedIn: (user: NoorUser) => void;
  onError?: (message: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!CLIENT_ID) {
      onError?.("Google client ID is not configured (NEXT_PUBLIC_GOOGLE_CLIENT_ID).");
      return;
    }

    let cancelled = false;

    function render() {
      const idApi = window.google?.accounts?.id;
      if (!idApi || !containerRef.current) return false;

      idApi.initialize({
        client_id: CLIENT_ID,
        callback: async (response) => {
          if (!response.credential) {
            onError?.("Google did not return a credential.");
            return;
          }
          try {
            const user = await googleLogin(response.credential);
            if (!cancelled) onSignedIn(user);
          } catch (error) {
            onError?.(error instanceof Error ? error.message : "Sign-in failed.");
          }
        },
      });
      idApi.renderButton(containerRef.current, {
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "signin_with",
        width: 280,
      });
      return true;
    }

    if (render()) return;

    // The GSI script may still be loading — poll briefly until it's ready.
    const timer = window.setInterval(() => {
      if (render()) window.clearInterval(timer);
    }, 150);
    const timeout = window.setTimeout(() => {
      window.clearInterval(timer);
      if (!window.google?.accounts?.id) {
        onError?.("Google sign-in failed to load. Check your connection and try again.");
      }
    }, 6000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [onSignedIn, onError]);

  return <div ref={containerRef} className="flex min-h-[44px] justify-center" />;
}
