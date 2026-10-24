/**
 * Turns Ink-2's turns into learner utterances. Ink ends a turn at every short
 * pause, so one sentence said with a breath in the middle came back as two
 * turns and, in an earlier version, got two replies. Turns that end within
 * `mergeMs` of each other are joined into one utterance; a turn that starts
 * inside the window keeps it open until that turn ends too.
 *
 * Pure (time is injected), so it can be tested without a microphone.
 */
export interface TurnMergerOptions {
  mergeMs: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class TurnMerger {
  private pending: string[] = [];
  private timer: unknown = null;
  private turnActive = false;
  private discardCurrent = false;
  private holding = false;
  private windowMs: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(
    private readonly options: TurnMergerOptions,
    private readonly emit: (text: string, turns: number) => void,
  ) {
    this.windowMs = options.mergeMs;
    this.now = options.now ?? (() => performance.now());
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  /** Whether Ink is in the middle of a turn. */
  get active() {
    return this.turnActive;
  }

  /** Text waiting to be emitted (turns ended, window still open). */
  get buffered() {
    return this.pending.join(" ");
  }

  /** How many ended turns are waiting. */
  get bufferedTurns() {
    return this.pending.length;
  }

  turnStart() {
    this.turnActive = true;
    // A new turn inside the window: hold the buffered text until this one ends.
    this.stopTimer();
  }

  turnEnd(transcript: string) {
    this.turnActive = false;
    const text = transcript.trim();
    if (this.discardCurrent) {
      this.discardCurrent = false;
      // A discarded turn still ends the window for whatever was buffered before it.
      if (this.pending.length) this.arm();
      return;
    }
    if (text) this.pending.push(text);
    if (this.pending.length) this.arm();
  }

  /**
   * Changes the merge window from now on: longer when Chalky has just asked
   * the learner something and a pause mid-answer must not end it.
   */
  setWindow(ms: number) {
    this.windowMs = ms;
  }

  /**
   * While held (the barge-in key is down) the window never closes: the key
   * release ends the utterance, not Ink's pauses. Releasing arms the window.
   */
  setHold(hold: boolean) {
    this.holding = hold;
    if (hold) this.stopTimer();
    else if (this.pending.length && !this.turnActive) this.arm();
  }

  /** Emits whatever is buffered right now (for a barge-in ending with the key release). */
  flush() {
    this.stopTimer();
    if (!this.pending.length) return;
    const text = this.pending.join(" ");
    const turns = this.pending.length;
    this.pending = [];
    this.emit(text, turns);
  }

  /** Throws away the buffered text and, if a turn is in progress, that turn too. */
  discard() {
    this.stopTimer();
    this.pending = [];
    if (this.turnActive) this.discardCurrent = true;
  }

  private arm() {
    this.stopTimer();
    if (this.holding) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, this.windowMs);
  }

  private stopTimer() {
    if (this.timer !== null) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
  }
}
