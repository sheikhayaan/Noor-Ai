"use client";

import { useEffect, useState } from "react";

import { SavingsDashboard } from "@/components/intelligence/SavingsDashboard";

// Mirror NoorChatInterface's identity resolution exactly so the dashboard shows
// the same user's memory: a signed-in NoorUser (JSON) wins, else the guest id
// (a plain string), else the backend's default local user.
const USER_KEY = "noor.user.v2";
const GUEST_KEY = "noor.guest.v1";

function resolveUserId(): string {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { user_id?: string };
      if (parsed?.user_id) return parsed.user_id;
    }
  } catch {
    /* fall through to guest */
  }
  try {
    const guest = localStorage.getItem(GUEST_KEY);
    if (guest) return guest;
  } catch {
    /* fall through to default */
  }
  return "local_user";
}

export default function MemoryPage() {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    setUserId(resolveUserId());
  }, []);

  return (
    <main className="min-h-dvh bg-[#08090b] text-white">
      {userId && <SavingsDashboard userId={userId} />}
    </main>
  );
}
