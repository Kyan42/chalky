// Ported from Janani's PR #2 (lib/voice/audio.ts), unchanged.
// One AudioContext for the whole app: microphone capture for speech-to-text and playback of the
// tutor's voice. It must be created from a click (browsers block audio until the user interacts),
// and it survives client-side navigation because it lives at module scope.

const CAPTURE_WORKLET = `
class ChalkyCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("chalky-capture", ChalkyCapture);
`;

/** Ink 2 gets 16 kHz 16-bit PCM in ~100 ms chunks. */
export const STT_SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = STT_SAMPLE_RATE / 10;

let context: AudioContext | null = null;
/** The microphone's own context: `holdAudio` freezes Chalky's clock without cutting off what the learner says. */
let captureContext: AudioContext | null = null;
let outputGain: GainNode | null = null;
let outputAnalyser: AnalyserNode | null = null;

/** Set by `holdAudio`: the learner stopped Chalky, so nothing may start the clock again until they press Start. */
let held = false;
const voiceStateListeners = new Set<() => void>();
const notifyVoiceState = () => voiceStateListeners.forEach(listener => listener());
function makeContext() {
  const ctx = new AudioContext();
  ctx.addEventListener("statechange", notifyVoiceState);
  return ctx;
}
export function subscribeVoiceState(listener: () => void) {
  voiceStateListeners.add(listener);
  return () => { voiceStateListeners.delete(listener); };
}
export function voiceNeedsGesture() {
  return !held && !!context && (context.state !== "running" || (!!captureContext && captureContext.state !== "running"));
}

/** Both resume calls run inside the tap, before network or permission awaits. */
export async function unlockVoice() {
  const playback = unlockAudio();
  captureContext ??= makeContext();
  const capture = captureContext.state !== "running" ? captureContext.resume() : Promise.resolve();
  await Promise.all([playback, capture]);
}

/** Call from a click handler. Safe to call again. */
export async function unlockAudio() {
  context ??= makeContext();
  if (context.state !== "running" && !held) await context.resume();
  if (!outputGain) {
    outputGain = context.createGain();
    outputAnalyser = context.createAnalyser();
    outputAnalyser.fftSize = 512;
    outputGain.connect(outputAnalyser).connect(context.destination);
  }
  return context;
}

export const audioUnlocked = () => context?.state === "running";

/**
 * Freezes (or restarts) Chalky's audio at once: playback and the clock every
 * player's position() reads (the board and cursor follow it). Whatever is
 * playing stops on the spot and carries on from there. The microphone runs on
 * its own context and keeps capturing; whether it is heard is the mic's call.
 */
export async function holdAudio(on: boolean) {
  held = on;
  if (!context) return;
  if (on && context.state === "running") await context.suspend();
  else if (!on && context.state !== "running") await context.resume();
}

export function audioContext() {
  if (!context) throw new Error("Audio is not unlocked yet");
  return context;
}

export function outputNode() {
  if (!outputGain) throw new Error("Audio is not unlocked yet");
  return outputGain;
}

function rms(analyser: AnalyserNode | null) {
  if (!analyser) return 0;
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const v of data) sum += v * v;
  return Math.sqrt(sum / data.length);
}

/** 0..1 loudness of the tutor's voice right now. */
export const outputLevel = () => Math.min(1, rms(outputAnalyser) * 4);

export type Microphone = {
  level: () => number;
  stop: () => void;
};

/** Starts the mic and calls `onChunk` with 16 kHz s16le PCM chunks. */
export async function startMicrophone(onChunk: (pcm: ArrayBuffer) => void): Promise<Microphone> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access requires a secure HTTPS connection and a browser that supports voice.");
  }
  await unlockVoice();
  captureContext ??= makeContext();
  const ctx = captureContext;
  if (ctx.state !== "running") await ctx.resume();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "application/javascript" }));
  try {
    await ctx.audioWorklet.addModule(url);
  } catch (error) {
    stream.getTracks().forEach(track => track.stop());
    throw error;
  } finally {
    URL.revokeObjectURL(url);
  }

  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  const worklet = new AudioWorkletNode(ctx, "chalky-capture");
  source.connect(analyser);
  source.connect(worklet);
  // Keep the capture graph pulled by Safari's audio renderer, without monitoring the microphone.
  const silent = ctx.createGain();
  silent.gain.value = 0;
  worklet.connect(silent).connect(ctx.destination);

  // Downsample by averaging, then convert to 16-bit.
  const ratio = ctx.sampleRate / STT_SAMPLE_RATE;
  let carry = 0;
  let accumulator = 0;
  let accumulated = 0;
  let out = new Int16Array(CHUNK_SAMPLES);
  let filled = 0;
  worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
    for (const sample of event.data) {
      accumulator += sample;
      accumulated++;
      carry += 1;
      if (carry >= ratio) {
        carry -= ratio;
        const value = Math.max(-1, Math.min(1, accumulator / accumulated));
        accumulator = 0;
        accumulated = 0;
        out[filled++] = value < 0 ? value * 0x8000 : value * 0x7fff;
        if (filled === CHUNK_SAMPLES) {
          onChunk(out.buffer);
          out = new Int16Array(CHUNK_SAMPLES);
          filled = 0;
        }
      }
    }
  };

  return {
    level: () => Math.min(1, rms(analyser) * 6),
    stop: () => {
      worklet.port.onmessage = null;
      source.disconnect();
      worklet.disconnect();
      analyser.disconnect();
      silent.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}
