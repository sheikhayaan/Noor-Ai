"use client";

import { AdminDashboard } from "@/components/admin/AdminDashboard";

// Access is enforced server-side (allowlisted session identity or loopback);
// the dashboard renders a clean "restricted" state on 403. Identity rides the
// signed HttpOnly cookie, so this page needs no props.
export default function AdminPage() {
  return (
    <main className="min-h-dvh bg-[#08090b] text-white">
      <AdminDashboard />
    </main>
  );
}
