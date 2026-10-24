/**
 * A cached Cartesia access token for the browser's Ink-2 socket, refreshed
 * when fewer than five minutes remain. Same flow as useListening's, shared so
 * other hooks don't repeat it.
 */
export type CartesiaToken = { token: string; version: string; expiresAt: number };

let inflight: Promise<CartesiaToken> | null = null;

export async function cartesiaToken(): Promise<CartesiaToken> {
  const current = inflight ? await inflight.catch(() => null) : null;
  if (current && current.expiresAt - Date.now() >= 5 * 60 * 1000) return current;
  const next = fetch("/api/cartesia/token", { method: "POST" }).then(async (r) => {
    const body = await r.json();
    if (!r.ok) throw new Error(body.error ?? `token request failed (${r.status})`);
    return body as CartesiaToken;
  });
  inflight = next;
  return await next;
}
