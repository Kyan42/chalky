import { action } from "./_generated/server";

export const CARTESIA_VERSION = "2026-08-14";

/** A short-lived token so the browser can talk to Cartesia without ever seeing the API key. */
export const token = action({
  args: {},
  handler: async () => {
    const apiKey = process.env.CARTESIA_API_KEY;
    if (!apiKey) throw new Error("CARTESIA_API_KEY is not set on the Convex deployment (npx convex env set CARTESIA_API_KEY ...)");
    const response = await fetch("https://api.cartesia.ai/access-token", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ grants: { tts: true, stt: true }, expires_in: 3600 }),
    });
    if (!response.ok) throw new Error(`Cartesia token request failed: ${response.status} ${await response.text()}`);
    const { token } = (await response.json()) as { token: string };
    return {
      token,
      expiresAt: Date.now() + 3600 * 1000,
      version: CARTESIA_VERSION,
      voiceId: process.env.CARTESIA_VOICE_ID ?? "694f9389-aac1-45b6-b726-9d9369183238",
    };
  },
});
