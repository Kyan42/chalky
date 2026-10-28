/**
 * The text each catalog block is searched by, shared by both engines (the local one embeds it into
 * lib/blocks/vectors.json; scripts/moss-build-blocks.ts uploads it to Moss), and which engine runs.
 */
import { createHash } from "node:crypto";
import { BLOCKS, type Block } from "@/lib/blocks";
import { foldNumbered } from "@/lib/blocks/catalog";

const STANDARD_ANCHORS = new Set(["center", "top", "bottom", "left", "right"]);

export type BlockDoc = { id: string; text: string; metadata: Record<string, string> };

/**
 * A block's search text: its title and topic words first, then what it is, its parts and anchor
 * names, with numbered runs folded ("cell 1-1…cell 7-18") so a block with 118 parts is still
 * about its title.
 */
export function blockDoc(b: Block): BlockDoc {
  const parts = foldNumbered([...new Set(b.parts.map((p) => p.label))]);
  const anchors = foldNumbered(Object.keys(b.anchors).filter((a) => !STANDARD_ANCHORS.has(a)));
  return {
    id: b.id,
    text: `${b.title}. About: ${b.tags.join(", ")}. ${b.describe}. Parts: ${parts}.${anchors ? ` Anchors: ${anchors}.` : ""}`,
    metadata: { blockId: b.id, title: b.title },
  };
}

export const blockDocs = (): BlockDoc[] => BLOCKS.map(blockDoc);

/** Changes when a block's text or the embedding model changes: its stored vector is then stale. */
export const docHash = (stamp: string, text: string) => createHash("sha1").update(`${stamp}\n${text}`).digest("hex").slice(0, 16);

export const hasMossKeys = () => Boolean(process.env.MOSS_PROJECT_ID && process.env.MOSS_PROJECT_KEY);

export type Engine = "local" | "moss";

/** RETRIEVAL_ENGINE=moss with both MOSS_* keys set uses Moss; anything else is the local engine. */
export function retrievalEngine(): Engine {
  return process.env.RETRIEVAL_ENGINE === "moss" && hasMossKeys() ? "moss" : "local";
}
