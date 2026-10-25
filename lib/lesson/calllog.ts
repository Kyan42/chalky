/**
 * One model call, measured: which model, time to first token, total time,
 * and every HTTP attempt the SDK made (it retries 408/409/429/5xx silently),
 * with status, time to headers, request id, retry-after and any rate-limit
 * headers. Routes return the CallLog to the page, which puts it in the lesson
 * transcript, so a slow run can be told apart: our contention, a retry, a
 * rate limit, or the API simply being slow.
 */
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { anthropic } from "./anthropic";
import type { CallAttempt, CallLog } from "./types";

/** Explicit, so the transcript can say how many retries were possible. */
export const MAX_RETRIES = 2;

export interface TrackedCall {
  client: Anthropic;
  log: CallLog;
  /** Mark the first token (call once; later calls are ignored). */
  firstToken: () => void;
  /** Watch a MessageStream for its first content delta. */
  watch: <S extends { on: (event: "streamEvent", fn: (e: { type: string }) => void) => unknown }>(stream: S) => S;
  /** Stamps the total time and returns the log. */
  finish: (error?: unknown) => CallLog;
}

export function trackCall(name: string, model: string): TrackedCall {
  const t0 = performance.now();
  const log: CallLog = { name, model, maxRetries: MAX_RETRIES, ttftMs: null, totalMs: null, retries: 0, attempts: [], error: null };
  const instrumented = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const ta = performance.now();
    const n = log.attempts.length + 1;
    try {
      const response = await fetch(input, init);
      const h = response.headers;
      const rateLimit: Record<string, string> = {};
      h.forEach((v, k) => {
        if (k.startsWith("anthropic-ratelimit-")) rateLimit[k.slice("anthropic-ratelimit-".length)] = v;
      });
      const attempt: CallAttempt = { n, status: response.status, headersMs: Math.round(performance.now() - ta), atMs: Math.round(ta - t0), requestId: h.get("request-id") };
      const retryAfter = h.get("retry-after");
      if (retryAfter) attempt.retryAfter = retryAfter;
      // Rate-limit headers only matter when they say something is short; keep them on any non-200.
      if (response.status !== 200 && Object.keys(rateLimit).length) attempt.rateLimit = rateLimit;
      log.attempts.push(attempt);
      log.retries = log.attempts.length - 1;
      return response;
    } catch (e) {
      log.attempts.push({ n, status: null, headersMs: Math.round(performance.now() - ta), atMs: Math.round(ta - t0), requestId: null, error: String((e as Error)?.message ?? e).slice(0, 160) });
      log.retries = log.attempts.length - 1;
      throw e;
    }
  };
  const client = anthropic().withOptions({ maxRetries: MAX_RETRIES, fetch: instrumented as never });
  const firstToken = () => {
    if (log.ttftMs === null) log.ttftMs = Math.round(performance.now() - t0);
  };
  return {
    client,
    log,
    firstToken,
    watch: (stream) => {
      stream.on("streamEvent", (e) => {
        if (e.type === "content_block_delta") firstToken();
      });
      return stream;
    },
    finish: (error) => {
      log.totalMs = Math.round(performance.now() - t0);
      if (error) log.error = String((error as Error)?.message ?? error).slice(0, 200);
      return log;
    },
  };
}
