// The tutor's conversational voice: Cartesia Sonic over a WebSocket, played through Web Audio.
// (Narration inside animations is generated ahead of time by the worker instead.)
import { audioContext, outputNode } from "./audio";

const SAMPLE_RATE = 44100;

type Utterance = {
  contextId: string;
  sources: AudioBufferSourceNode[];
  done: boolean;
  resolve: () => void;
};

export class SonicSpeaker {
  private socket: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private current: Utterance | null = null;
  private playhead = 0;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  onSpeakingChange?: (speaking: boolean) => void;

  constructor(private readonly auth: () => Promise<{ token: string; version: string; voiceId: string }>) {}

  get speaking() {
    return this.current !== null;
  }

  private async open() {
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    this.opening ??= (async () => {
      const { token, version } = await this.auth();
      const socket = new WebSocket(`wss://api.cartesia.ai/tts/websocket?cartesia_version=${version}&access_token=${encodeURIComponent(token)}`);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("Could not connect to Cartesia TTS"));
      });
      socket.onmessage = (event) => this.handle(JSON.parse(String(event.data)));
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
      };
      this.socket = socket;
      return socket;
    })().finally(() => (this.opening = null));
    return await this.opening;
  }

  /** Speaks `text`; resolves when it has finished playing or was interrupted. */
  async speak(text: string): Promise<void> {
    this.stop();
    const { voiceId } = await this.auth();
    const socket = await this.open();
    const contextId = crypto.randomUUID();
    return await new Promise<void>((resolve) => {
      this.current = { contextId, sources: [], done: false, resolve };
      this.playhead = 0;
      this.onSpeakingChange?.(true);
      socket.send(
        JSON.stringify({
          model_id: "sonic-3.6",
          transcript: text,
          voice: voiceId,
          language: "en",
          context_id: contextId,
          output_format: { container: "raw", encoding: "pcm_f32le", sample_rate: SAMPLE_RATE },
          continue: false,
        }),
      );
    });
  }

  /** Cuts the tutor off immediately (barge-in). */
  stop() {
    const utterance = this.current;
    if (!utterance) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ context_id: utterance.contextId, cancel: true }));
    for (const source of utterance.sources) {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.finish(utterance);
  }

  private finish(utterance: Utterance) {
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = null;
    if (this.current === utterance) {
      this.current = null;
      this.onSpeakingChange?.(false);
    }
    utterance.resolve();
  }

  private handle(message: { type: string; context_id?: string; data?: string; done?: boolean; error?: string }) {
    const utterance = this.current;
    if (!utterance || message.context_id !== utterance.contextId) return;
    if (message.type === "chunk" && message.data) this.play(utterance, message.data);
    if (message.type === "done" || message.done || message.type === "error") {
      utterance.done = true;
      const ctx = audioContext();
      const remaining = Math.max(0, this.playhead - ctx.currentTime);
      this.endTimer = setTimeout(() => this.finish(utterance), remaining * 1000 + 50);
    }
  }

  private play(utterance: Utterance, base64: string) {
    const ctx = audioContext();
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, SAMPLE_RATE);
    buffer.copyToChannel(samples, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(outputNode());
    const startAt = Math.max(ctx.currentTime + 0.03, this.playhead);
    source.start(startAt);
    this.playhead = startAt + buffer.duration;
    utterance.sources.push(source);
  }
}
