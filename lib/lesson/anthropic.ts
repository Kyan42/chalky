import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

let client: Anthropic | null = null;

/**
 * The Anthropic client for the lesson routes. Prefers ANTHROPIC_API_KEY from
 * .env.local: a dev server launched by another tool can inherit an unrelated
 * ANTHROPIC_API_KEY, and Next.js never lets .env.local override an existing variable.
 */
export function anthropic(): Anthropic {
  if (client) return client;
  const file = join(process.cwd(), ".env.local");
  const local = existsSync(file) ? parseEnv(readFileSync(file, "utf8")).ANTHROPIC_API_KEY : undefined;
  client = new Anthropic({ apiKey: local || process.env.ANTHROPIC_API_KEY, maxRetries: 2 });
  return client;
}
