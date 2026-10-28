/**
 * One model call, measured: which model, time to first token, total time,
 * and every HTTP attempt the SDK made (it retries 408/409/429/5xx silently),
 * with status, time to headers, request id, retry-after and any rate-limit
 * headers. Routes return the CallLog to the page, which puts it in the lesson
 * transcript, so a slow run can be told apart: our contention, a retry, a
 * rate limit, or the API simply being slow.
 *
 * Provider-neutral: the instrumented fetch goes into either SDK (lib/lesson/provider.ts). Anthropic sends
 * `request-id` and `anthropic-ratelimit-*`; OpenAI sends `x-request-id` and `x-ratelimit-*`.
 */
import "server-only";
import type { CallAttempt, CallLog } from "./types";

/** Explicit, so the transcript can say how many retries were possible. */
export const MAX_RETRIES = 2;

const RATE_LIMIT_PREFIXES = ["anthropic-ratelimit-", "x-ratelimit-"];

export interface TrackedCall {
  log: CallLog;
  /** A fetch for the SDK client: records every attempt on the log. */
  fetch: typeof fetch;
  /** Mark the first token (call once; later calls are ignored). */
  firstToken: () => void;
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
        const prefix = RATE_LIMIT_PREFIXES.find((p) => k.startsWith(p));
        if (prefix) rateLimit[k.slice(prefix.length)] = v;
      });
      const attempt: CallAttempt = { n, status: response.status, headersMs: Math.round(performance.now() - ta), atMs: Math.round(ta - t0), requestId: h.get("request-id") ?? h.get("x-request-id") };
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
  const firstToken = () => {
    if (log.ttftMs === null) log.ttftMs = Math.round(performance.now() - t0);
  };
  return {
    log,
    fetch: instrumented as typeof fetch,
    firstToken,
    finish: (error) => {
      log.totalMs = Math.round(performance.now() - t0);
      if (error) log.error = String((error as Error)?.message ?? error).slice(0, 200);
      return log;
    },
  };
}
