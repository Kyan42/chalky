// Ported from Janani's PR #2 (lib/voice/stt.ts), unchanged.
// Cartesia Ink 2 with built-in turn detection, straight from the browser.
import { STT_SAMPLE_RATE } from "./audio";

export type TurnEvents = {
  onStart?: () => void;
  /** Cumulative transcript of the current turn; never revised. */
  onUpdate?: (transcript: string) => void;
  onEagerEnd?: (transcript: string) => void;
  onResume?: () => void;
  onEnd?: (transcript: string) => void;
  onError?: (message: string) => void;
};

export class InkSession {
  private socket: WebSocket | null = null;
  private closed = false;
  private retries = 0;

  constructor(
    private readonly auth: () => Promise<{ token: string; version: string }>,
    private readonly events: TurnEvents,
    private keyterms: string[] = [],
  ) {}

  async connect() {
    this.closed = false;
    const { token, version } = await this.auth();
    const params = new URLSearchParams({
      model: "ink-2",
      encoding: "pcm_s16le",
      sample_rate: String(STT_SAMPLE_RATE),
      cartesia_version: version,
      access_token: token,
    });
    for (const term of this.keyterms.slice(0, 100)) params.append("keyterm", term);
    const socket = new WebSocket(`wss://api.cartesia.ai/stt/turns/websocket?${params}`);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => (this.retries = 0);
    socket.onmessage = (event) => this.handle(JSON.parse(String(event.data)));
    socket.onclose = () => {
      if (this.socket !== socket || this.closed) return;
      // Reconnect with backoff; tokens can expire and networks blip.
      const delay = Math.min(8000, 500 * 2 ** this.retries++);
      setTimeout(() => void this.connect().catch((e) => this.events.onError?.(String(e))), delay);
    };
    this.socket = socket;
  }

  /** Reconnects with a new keyterm list (the topic's vocabulary) if it changed. */
  setKeyterms(terms: string[]) {
    const next = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length > 1 && t.length < 50))];
    if (next.join("|") === this.keyterms.join("|")) return;
    this.keyterms = next;
    if (this.socket) {
      const old = this.socket;
      this.socket = null;
      old.close();
      void this.connect();
    }
  }

  send(pcm: ArrayBuffer) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(pcm);
  }

  close() {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  private handle(message: { type: string; transcript?: string; message?: string }) {
    switch (message.type) {
      case "turn.start":
        return this.events.onStart?.();
      case "turn.update":
        return this.events.onUpdate?.(message.transcript ?? "");
      case "turn.eager_end":
        return this.events.onEagerEnd?.(message.transcript ?? "");
      case "turn.resume":
        return this.events.onResume?.();
      case "turn.end":
        return this.events.onEnd?.(message.transcript ?? "");
      case "error":
        return this.events.onError?.(message.message ?? "Speech recognition error");
    }
  }
}
