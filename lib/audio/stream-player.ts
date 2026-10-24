/**
 * Plays streamed raw PCM (f32le, mono) through Web Audio, chunk by chunk, and
 * exposes the one clock everything else follows: `position()`, the time in the
 * *speech* (Sonic's timestamp timebase) that is audible right now.
 *
 * Each chunk remembers both where it sits in the speech and when it was
 * scheduled on the AudioContext, so the mapping stays exact even if the
 * network falls behind and a gap has to be inserted.
 */

interface Scheduled {
  source: AudioBufferSourceNode;
  /** AudioContext time the chunk starts playing. */
  ctxStart: number;
  /** Speech time the chunk starts at. */
  speechStart: number;
  duration: number;
}

/** Initial cushion between the first chunk arriving and it playing. */
const LEAD_SECONDS = 0.1;

export class StreamPlayer {
  readonly ctx: AudioContext;
  private chunks: Scheduled[] = [];
  private nextCtxTime = 0;
  private speechCursor = 0;
  private stopped = false;
  /** Seconds of silence inserted because audio arrived late. */
  underrunSeconds = 0;
  bytesReceived = 0;
  /** AudioContext time the first sample plays; null until the first chunk. */
  startCtxTime: number | null = null;

  /** Taps the output so the level actually reaching the speakers can be measured. */
  private meter: AnalyserNode;
  private meterBuffer: Float32Array<ArrayBuffer>;

  /** Raw PCM as Sonic sends it; read from the stream's start event. */
  private encoding: "pcm_f32le" | "pcm_s16le";
  /** A trailing odd byte of a 16-bit sample split across chunks. */
  private carry: Uint8Array | null = null;

  constructor(ctx: AudioContext, private sampleRate: number, encoding: "pcm_f32le" | "pcm_s16le" = "pcm_f32le") {
    this.encoding = encoding;
    this.ctx = ctx;
    this.meter = ctx.createAnalyser();
    this.meter.fftSize = 2048;
    this.meter.connect(ctx.destination);
    this.meterBuffer = new Float32Array(this.meter.fftSize);
  }

  /** RMS of the last ~46 ms of output. 0 means silence. */
  level(): number {
    this.meter.getFloatTimeDomainData(this.meterBuffer);
    let sum = 0;
    for (const v of this.meterBuffer) sum += v * v;
    return Math.sqrt(sum / this.meterBuffer.length);
  }

  /** Decodes one chunk to float samples (once, on append); the AudioContext resamples 24 kHz to its own rate. */
  private toFloat(chunk: Uint8Array): Float32Array<ArrayBuffer> {
    let bytes = chunk;
    if (this.carry) {
      bytes = new Uint8Array(this.carry.length + chunk.length);
      bytes.set(this.carry);
      bytes.set(chunk, this.carry.length);
      this.carry = null;
    }
    const width = this.encoding === "pcm_s16le" ? 2 : 4;
    const whole = bytes.length - (bytes.length % width);
    if (whole < bytes.length) this.carry = bytes.slice(whole);
    const view = new DataView(bytes.buffer, bytes.byteOffset, whole);
    const out = new Float32Array(whole / width);
    if (width === 2) for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    else for (let i = 0; i < out.length; i++) out[i] = view.getFloat32(i * 4, true);
    return out;
  }

  append(base64: string) {
    if (this.stopped) return;
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    this.bytesReceived += bytes.byteLength;
    const samples = this.toFloat(bytes);
    if (samples.length === 0) return;
    const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);

    const now = this.ctx.currentTime;
    if (this.startCtxTime === null) {
      this.nextCtxTime = now + LEAD_SECONDS;
      this.startCtxTime = this.nextCtxTime;
    } else if (this.nextCtxTime < now + 0.005) {
      this.underrunSeconds += now + 0.02 - this.nextCtxTime;
      this.nextCtxTime = now + 0.02;
    }
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.meter);
    source.start(this.nextCtxTime);
    this.chunks.push({ source, ctxStart: this.nextCtxTime, speechStart: this.speechCursor, duration: buffer.duration });
    this.nextCtxTime += buffer.duration;
    this.speechCursor += buffer.duration;
  }

  /** Speech seconds audible now; -1 before the first sample plays. */
  position(at = this.ctx.currentTime): number {
    if (this.startCtxTime === null || at < this.startCtxTime) return -1;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      const c = this.chunks[i];
      if (at >= c.ctxStart) return c.speechStart + Math.min(at - c.ctxStart, c.duration);
    }
    return 0;
  }

  /** Seconds of speech received so far. */
  get receivedSeconds() {
    return this.speechCursor;
  }

  /** True once every received chunk has finished playing. */
  get drained() {
    return this.startCtxTime !== null && this.ctx.currentTime >= this.nextCtxTime;
  }

  /** Silences everything now and ignores anything appended later. */
  stop() {
    this.stopped = true;
    for (const c of this.chunks) {
      try {
        c.source.stop();
        c.source.disconnect();
      } catch {
        /* already stopped */
      }
    }
  }
}
