import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlockParam, BetaMessageParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** The live tutor. Override with TUTOR_MODEL on the Convex deployment. */
export const tutorModel = () => process.env.TUTOR_MODEL ?? "claude-opus-5-5";

let client: Anthropic | null = null;
function anthropic() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set on the Convex deployment (npx convex env set ANTHROPIC_API_KEY ...)");
  }
  client ??= new Anthropic();
  return client;
}

/**
 * One structured call: the reply is validated against `schema` by the API.
 * Uses refusal fallbacks so a declined request is retried on a fallback model server-side.
 */
export async function askJson<T>(options: {
  system: string;
  messages: BetaMessageParam[];
  schema: Record<string, unknown>;
  effort: Effort;
  maxTokens?: number;
}): Promise<T> {
  const stream = anthropic().beta.messages.stream({
    model: tutorModel(),
    max_tokens: options.maxTokens ?? 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }],
    messages: options.messages,
    output_config: { effort: options.effort, format: { type: "json_schema", schema: options.schema } },
  });
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error("The model declined this request");
  if (message.stop_reason === "max_tokens") throw new Error("The model ran out of room for its answer");
  const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
  return JSON.parse(text) as T;
}

export function imageBlock(base64Png: string): BetaContentBlockParam {
  return { type: "image", source: { type: "base64", media_type: "image/png", data: base64Png } };
}

export function pdfBlock(base64Pdf: string): BetaContentBlockParam {
  return { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } };
}

export async function blobToBase64(blob: Blob) {
  return Buffer.from(await blob.arrayBuffer()).toString("base64");
}

/** Strict JSON-schema helpers: every property is required and nothing extra is allowed. */
export const s = {
  object(properties: Record<string, unknown>) {
    return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
  },
  string: (description?: string) => ({ type: "string", ...(description ? { description } : {}) }),
  enum: (values: string[], description?: string) => ({ type: "string", enum: values, ...(description ? { description } : {}) }),
  array: (items: unknown, description?: string) => ({ type: "array", items, ...(description ? { description } : {}) }),
  boolean: (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) }),
};

export const beatSchema = s.object({
  narration: s.string("What the tutor says out loud: 1-3 short spoken sentences, no markdown, no lists."),
  visual: s.string("What the animation shows while this is said: concrete shapes, labels, motion and colour."),
});
