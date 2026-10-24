"use client";

import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  const [client] = useState(() => (url ? new ConvexReactClient(url) : null));
  if (!client) {
    return (
      <main className="grid min-h-dvh place-items-center p-8 text-center">
        <div className="max-w-md space-y-3">
          <h1 className="text-2xl font-semibold">Convex isn&apos;t connected yet</h1>
          <p className="text-[var(--muted)]">
            Run <code className="rounded bg-white/10 px-1.5 py-0.5">npx convex dev</code> once. It writes NEXT_PUBLIC_CONVEX_URL to .env.local. Then restart the dev server.
          </p>
        </div>
      </main>
    );
  }
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
