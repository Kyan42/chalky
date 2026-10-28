/**
 * The one place that knows which model provider answers: every lesson call (converse, plan, amend, draw,
 * layout, intake, quiz, delegate, opener, reply, visual) goes through streamModel or callModel with the same
 * request shape, and gets text (or JSON text against a schema) back.
 *
 * MODEL_PROVIDER=openai|anthropic (default anthropic) picks the default model for each role, read once at
 * startup. Each role's env override (CONVERSE_MODEL, PLANNER_MODEL, …) still works for either provider, and
 * a model id routes itself: "gpt-…" or "o…" to OpenAI, "claude-…" to Anthropic, so mixed setups work.
 *
 * Anthropic: the Messages API (thinking, output_config effort and json_schema, cached system prompt).
 * OpenAI: the Responses API (reasoning.effort, text.format json_schema strict, input_image; caching is
 * automatic). Both go through the call log's instrumented fetch (lib/lesson/calllog.ts) and the SDKs'
 * retries (429 and 5xx with backoff).
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { MAX_RETRIES, trackCall, type TrackedCall } from "./calllog";
import { providerLines } from "./provider-prompts";
import type { CallLog } from "./types";

export type Provider = "anthropic" | "openai";
export const PROVIDER: Provider = process.env.MODEL_PROVIDER === "openai" ? "openai" : "anthropic";

/** A model id names its provider. */
export const providerOf = (model: string): Provider => (/^(gpt-|o\d|chatgpt-)/i.test(model) ? "openai" : "anthropic");

/** The model roles, with the env name that overrides each and each provider's default. */
const ROLES = {
  converse: { env: "CONVERSE_MODEL", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
  "converse-fallback": { env: "CONVERSE_FALLBACK_MODEL", anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" },
  planner: { env: "PLANNER_MODEL", anthropic: "claude-opus-5-5", openai: "gpt-6.1-sol" },
  amend: { env: "AMEND_MODEL", anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" },
  draw: { env: "DRAW_MODEL", anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" },
  "draw-fast": { env: "DRAW_FAST_MODEL", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
  "draw-slow": { env: "DRAW_SLOW_MODEL", anthropic: "claude-opus-5-5", openai: "gpt-6.1-sol" },
  layout: { env: "LAYOUT_MODEL", anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" },
  delegate: { env: "DELEGATE_MODEL", anthropic: "claude-sonnet-5-5", openai: "gpt-6.1-terra" },
  opener: { env: "OPENER_MODEL", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
  reply: { env: "REPLY_MODEL", anthropic: "claude-opus-5-5", openai: "gpt-6.1-terra" },
  visual: { env: "VISUAL_MODEL", anthropic: "claude-haiku-5-5", openai: "gpt-6-luna" },
} as const;
export type ModelRole = keyof typeof ROLES;

/** The model for a role: its env override, else the live provider's default. */
export function modelFor(role: ModelRole): string {
  const r = ROLES[role];
  return process.env[r.env] || r[PROVIDER];
}

export type Part = { type: "text"; text: string } | { type: "image"; jpegBase64: string };
export interface ModelMessage {
  role: "user" | "assistant";
  content: string | Part[];
}
export interface ModelRequest {
  /** The call log's name ("converse", "draw", "quiz-label"…). */
  name: string;
  model: string;
  system: string;
  /** Anthropic: mark the system prompt cacheable (OpenAI caches long prefixes by itself). */
  cacheSystem?: boolean;
  messages: ModelMessage[];
  maxTokens: number;
  /** How hard to think: "off" (none), else the effort. Default low. */
  effort?: "off" | "low" | "medium" | "high";
  /** A JSON schema the answer must follow (the text is then that JSON). */
  schema?: object;
  signal?: AbortSignal;
}
export type StopReason = "end" | "max_tokens" | "refusal" | "other";
export interface ModelResult {
  text: string;
  stop: StopReason;
  usage: { input: number; output: number };
  call: CallLog;
}
/** A streaming call: iterate for text deltas in order; result() once it ends. */
export interface ModelStream extends AsyncIterable<string> {
  result(): Promise<ModelResult>;
  /** The call log as it fills in (attempts, first token). */
  log: CallLog;
  /** Closes the log with an error (a caller that stopped partway, or caught a throw). */
  fail(error: unknown): CallLog;
}

// ---------- clients: keys from .env.local first (a dev server launched by another tool can inherit unrelated keys) ----------

const localEnv = (() => {
  let env: Record<string, string | undefined> | null = null;
  return () => {
    if (env) return env;
    const file = join(process.cwd(), ".env.local");
    env = existsSync(file) ? parseEnv(readFileSync(file, "utf8")) : {};
    return env;
  };
})();
let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
const anthropicBase = () => (anthropicClient ??= new Anthropic({ apiKey: localEnv().ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY, maxRetries: MAX_RETRIES }));
const openaiBase = () => (openaiClient ??= new OpenAI({ apiKey: localEnv().OPENAI_API_KEY || process.env.OPENAI_API_KEY, maxRetries: MAX_RETRIES }));

// ---------- Anthropic ----------

function anthropicParams(req: ModelRequest): Anthropic.MessageStreamParams {
  const effort = req.effort ?? "low";
  const system = `${req.system}${providerLines(req.name, "anthropic")}`;
  // Thinking off: Haiku 5.5 takes "disabled"; Sonnet 5.5 turns it off with "between_tools".
  const thinking = effort === "off" ? (req.model.startsWith("claude-sonnet-5-5") ? { type: "between_tools" } : { type: "disabled" }) : { type: "adaptive" };
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.cacheSystem ? [{ type: "text", text: system, cache_control: { type: "ephemeral" } }] : system,
    thinking,
    output_config: { effort: effort === "off" ? "low" : effort, ...(req.schema ? { format: { type: "json_schema", schema: req.schema } } : {}) },
    messages: req.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data: p.jpegBase64 } })),
    })),
  } as Anthropic.MessageStreamParams;
}

function anthropicStop(reason: string | null | undefined): StopReason {
  return reason === "end_turn" ? "end" : reason === "max_tokens" ? "max_tokens" : reason === "refusal" ? "refusal" : "other";
}

function anthropicStream(req: ModelRequest, tracked: TrackedCall): ModelStream {
  const client = anthropicBase().withOptions({ maxRetries: MAX_RETRIES, fetch: tracked.fetch });
  const stream = client.messages.stream(anthropicParams(req), { signal: req.signal });
  // The first content delta (thinking or text) is the first token, whether or not the caller iterates.
  stream.on("streamEvent", (e) => {
    if (e.type === "content_block_delta") tracked.firstToken();
  });
  const usage = { input: 0, output: 0 };
  let text = "";
  /** The caller stopped reading before the end (it had what it needed): the request is cancelled, not failed. */
  let early = false;
  return {
    log: tracked.log,
    fail: (e) => tracked.finish(e),
    async *[Symbol.asyncIterator]() {
      let completed = false;
      try {
        for await (const e of stream) {
          if (e.type === "content_block_delta") {
            if (e.delta.type === "text_delta") {
              text += e.delta.text;
              yield e.delta.text;
            }
          } else if (e.type === "message_start") {
            const u = e.message.usage;
            usage.input = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
          } else if (e.type === "message_delta") usage.output = e.usage.output_tokens;
        }
        completed = true;
      } finally {
        if (!completed && !req.signal?.aborted) {
          early = true;
          stream.abort();
        }
      }
    },
    async result() {
      if (early) return { text, stop: "end", usage, call: tracked.finish() };
      try {
        const final = await stream.finalMessage();
        const all = final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const u = final.usage;
        return { text: all || text, stop: anthropicStop(final.stop_reason), usage: { input: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), output: u.output_tokens || usage.output }, call: tracked.finish() };
      } catch (e) {
        tracked.finish(e);
        throw e;
      }
    },
  };
}

// ---------- OpenAI ----------

/** Strict structured outputs need every property required and no extra properties, all the way down. */
function strictOk(schema: unknown): boolean {
  if (!schema || typeof schema !== "object") return true;
  const s = schema as Record<string, unknown>;
  if (s.type === "object" && s.properties) {
    const props = Object.keys(s.properties as object);
    const required = new Set((s.required as string[] | undefined) ?? []);
    if (s.additionalProperties !== false || props.some((p) => !required.has(p))) return false;
    if (!Object.values(s.properties as object).every(strictOk)) return false;
  }
  if (s.items && !strictOk(s.items)) return false;
  for (const k of ["anyOf", "oneOf", "allOf"]) if (Array.isArray(s[k]) && !(s[k] as unknown[]).every(strictOk)) return false;
  return true;
}

function openaiParams(req: ModelRequest): OpenAI.Responses.ResponseCreateParamsStreaming {
  const effort = req.effort ?? "low";
  return {
    model: req.model,
    instructions: `${req.system}${providerLines(req.name, "openai")}`,
    max_output_tokens: req.maxTokens,
    reasoning: { effort: effort === "off" ? "none" : effort },
    ...(req.schema ? { text: { format: { type: "json_schema", name: req.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64), schema: req.schema as Record<string, unknown>, strict: strictOk(req.schema) } } } : {}),
    input: req.messages.map((m) => ({
      role: m.role,
      content:
        typeof m.content === "string"
          ? m.content
          : m.content.map((p) => (p.type === "text" ? { type: "input_text" as const, text: p.text } : { type: "input_image" as const, image_url: `data:image/jpeg;base64,${p.jpegBase64}`, detail: "auto" as const })),
    })) as OpenAI.Responses.ResponseInput,
    stream: true,
    store: false,
  };
}

function openaiStream(req: ModelRequest, tracked: TrackedCall): ModelStream {
  const client = openaiBase().withOptions({ maxRetries: MAX_RETRIES, fetch: tracked.fetch });
  const opened = client.responses.create(openaiParams(req), { signal: req.signal });
  let text = "";
  let refused = false;
  let final: OpenAI.Responses.Response | null = null;
  let consumed: Promise<void> | null = null;
  /** The caller stopped reading before the end: the request is cancelled, not failed. */
  let early = false;
  const consume = async function* () {
    const events = await opened;
    let completed = false;
    try {
      for await (const e of events) {
        if (e.type === "response.output_text.delta") {
          tracked.firstToken();
          text += e.delta;
          yield e.delta;
        } else if (e.type === "response.refusal.delta") {
          tracked.firstToken();
          refused = true;
        } else if (e.type === "response.completed" || e.type === "response.incomplete" || e.type === "response.failed") final = e.response;
        else if (e.type === "error") throw new Error(`OpenAI: ${e.message}`);
      }
      completed = true;
    } finally {
      if (!completed && !req.signal?.aborted && !final) {
        early = true;
        events.controller.abort();
      }
    }
  };
  return {
    log: tracked.log,
    fail: (e) => tracked.finish(e),
    [Symbol.asyncIterator]() {
      const it = consume();
      consumed = (async () => {})();
      return it;
    },
    async result() {
      if (early) return { text, stop: "end", usage: { input: 0, output: 0 }, call: tracked.finish() };
      try {
        // Not iterated by the caller (a one-shot call): drain it here.
        if (!consumed) for await (const _ of consume()) void _;
        const r = final as OpenAI.Responses.Response | null;
        const status = r?.status;
        const reason = r?.incomplete_details?.reason;
        const stop: StopReason = refused ? "refusal" : status === "completed" ? "end" : reason === "max_output_tokens" ? "max_tokens" : status === "failed" ? "other" : "other";
        if (status === "failed") throw new Error(`OpenAI: ${r?.error?.message ?? "failed"}`);
        return { text, stop, usage: { input: r?.usage?.input_tokens ?? 0, output: r?.usage?.output_tokens ?? 0 }, call: tracked.finish() };
      } catch (e) {
        tracked.finish(e);
        throw e;
      }
    },
  };
}

// ---------- the two shapes every caller uses ----------

/** A streaming call: text deltas in order, then result() (stop reason, usage, the call log). */
export function streamModel(req: ModelRequest): ModelStream {
  const tracked = trackCall(req.name, req.model);
  return providerOf(req.model) === "openai" ? openaiStream(req, tracked) : anthropicStream(req, tracked);
}

/** A one-shot call: the final text (JSON text when a schema is given). */
export async function callModel(req: ModelRequest): Promise<ModelResult> {
  return streamModel(req).result();
}

/** A one-shot call against a schema, parsed. Throws on a refusal or an answer cut off. */
export async function callJson<T>(req: ModelRequest & { schema: object }): Promise<{ value: T; result: ModelResult }> {
  const result = await callModel(req);
  if (result.stop === "refusal") throw new Error("refused");
  if (result.stop === "max_tokens") throw new Error("cut off at max_tokens");
  return { value: JSON.parse(result.text) as T, result };
}

/** An API error's HTTP status and message, whichever SDK threw it. */
export function apiError(e: unknown): string {
  const x = e as { status?: number; message?: string };
  return x?.status ? `${x.status} ${x.message ?? ""}`.trim() : String(x?.message ?? e);
}
