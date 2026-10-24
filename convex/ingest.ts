"use node";

import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { askJson, blobToBase64, pdfBlock, s } from "./lib/claude";

/** Stored source text is capped; prompts take slices of it. */
const MAX_TEXT = 120_000;

type Extracted = { title: string; summary: string; text: string };

const extractedSchema = s.object({
  title: s.string("A short title for the material."),
  summary: s.string("A 4-8 sentence summary of what the material teaches and at what level."),
  text: s.string(
    "A faithful, detailed condensation of the material's teachable content: definitions, key facts, equations, diagrams described in words, worked examples. Keep the material's own terms. Up to about 6000 words.",
  ),
});

function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

async function fromPdf(base64: string) {
  return await askJson<Extracted>({
    system: "You prepare reference material for a tutor who will teach from it.",
    messages: [{ role: "user", content: [pdfBlock(base64), { type: "text", text: "Extract this document." }] }],
    schema: extractedSchema,
    effort: "low",
    maxTokens: 32000,
  });
}

export const extract = internalAction({
  args: { sourceId: v.id("sources") },
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.runQuery(internal.sources.getInternal, { sourceId });
    if (!source) return;
    try {
      let result: Extracted;
      if (source.kind === "pdf") {
        const blob = await ctx.storage.get(source.storageId!);
        if (!blob) throw new Error("The uploaded file is missing");
        result = await fromPdf(await blobToBase64(blob));
      } else {
        const response = await fetch(source.url!, { headers: { "User-Agent": "Mozilla/5.0 (Chalky reader)" } });
        if (!response.ok) throw new Error(`Could not fetch the page (${response.status})`);
        if ((response.headers.get("content-type") ?? "").includes("pdf")) {
          result = await fromPdf(Buffer.from(await response.arrayBuffer()).toString("base64"));
        } else {
          const text = htmlToText(await response.text()).slice(0, MAX_TEXT);
          const { title, summary } = await askJson<Omit<Extracted, "text">>({
            system: "You prepare reference material for a tutor who will teach from it.",
            messages: [{ role: "user", content: `Here is the text of ${source.url}:\n\n${text.slice(0, 60_000)}` }],
            schema: s.object({ title: extractedSchema.properties.title, summary: extractedSchema.properties.summary }),
            effort: "low",
          });
          result = { title, summary, text };
        }
      }
      await ctx.runMutation(internal.sources.finish, {
        sourceId,
        status: "ready",
        title: result.title,
        summary: result.summary,
        text: result.text.slice(0, MAX_TEXT),
      });
    } catch (error) {
      await ctx.runMutation(internal.sources.finish, {
        sourceId,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
});
