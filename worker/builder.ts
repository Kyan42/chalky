// Runs Claude Code (via the Agent SDK) in a job folder to author Clayzo animations with the kit.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { assertValidAnimationDocument, type AnimationDocument } from "@clayzo/animation/authoring";
import type { Manifest } from "../lib/types";
import { env } from "./env";

const SYSTEM = `You are the motion designer for Chalky, an app that teaches through narrated explainer animations.
You work inside one job folder and author Clayzo animations with the Chalky kit (read KIT.md first).
Work quickly and decisively: write the authoring script, run it, look at a frame sheet, fix what looks wrong, finish.
Only create and edit files inside the current folder. Do not install packages or touch anything outside it.

Shell commands are allowed only one at a time, each starting with one of: npx tsx, npx clayzo, node, ls, cat.
Never chain commands with ; && || or pipes, and never cd: those are denied. The working directory is already the job folder.
Use the Read, Glob and Grep tools to look at files rather than the shell. If a command is denied, rewrite it as a single allowed command; Bash itself is not blocked.`;

/** A Claude Code run that goes this long without any activity is presumed stuck and aborted. */
const IDLE_MS = 6 * 60 * 1000; // writing a long author.ts in one go can take a few quiet minutes
/** Hard ceiling for one animation job. */
const TOTAL_MS = 25 * 60 * 1000;

export type BuiltAnimation = { file: string; document: AnimationDocument; manifest: Manifest };

/**
 * Hands `brief` to Claude Code and returns the animations it was asked to write.
 * `onProgress` gets short human-readable updates for the UI.
 */
export async function buildWithClaudeCode(options: {
  dir: string;
  brief: string;
  expect: string[];
  onProgress: (message: string) => void;
}): Promise<BuiltAnimation[]> {
  // Watchdog: abort a session that hangs (a stalled API call, a loop) so the job fails and retries.
  const abortController = new AbortController();
  let reason = "";
  let idle: ReturnType<typeof setTimeout> | undefined;
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => {
      reason = `no activity for ${IDLE_MS / 60000} minutes`;
      abortController.abort();
    }, IDLE_MS);
  };
  const ceiling = setTimeout(() => {
    reason = `took longer than ${TOTAL_MS / 60000} minutes`;
    abortController.abort();
  }, TOTAL_MS);
  touch();

  const run = query({
    prompt: options.brief,
    options: {
      cwd: options.dir,
      model: env.builderModel(),
      systemPrompt: { type: "preset", preset: "claude_code", append: SYSTEM },
      settingSources: ["project"],
      skills: ["clayzo-animation-authoring"],
      permissionMode: "dontAsk",
      allowedTools: [
        "Read",
        "Write",
        "Edit",
        "Glob",
        "Grep",
        "Bash(npx tsx:*)",
        "Bash(npx clayzo:*)",
        "Bash(ls:*)",
        "Bash(cat:*)",
        "Bash(node:*)",
      ],
      maxTurns: 80,
      abortController,
    },
  });

  let result = "";
  try {
    for await (const message of run) {
      touch();
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if (block.type === "tool_use") options.onProgress(describeTool(block.name, block.input as Record<string, unknown>));
        }
      } else if (message.type === "result") {
        if (message.subtype !== "success" || message.is_error) {
          throw new Error(`Claude Code stopped: ${message.subtype}${"result" in message ? ` ${message.result}` : ""}`);
        }
        result = message.result;
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) throw new Error(`Claude Code was stopped: it ${reason}`);
    throw error;
  } finally {
    clearTimeout(idle);
    clearTimeout(ceiling);
  }

  return options.expect.map((file) => {
    const full = path.join(options.dir, file);
    if (!existsSync(full)) throw new Error(`Claude Code finished without writing ${file}. Last words: ${result.slice(-300)}`);
    const document = JSON.parse(readFileSync(full, "utf8")) as AnimationDocument;
    assertValidAnimationDocument(document);
    const manifestFile = full.replace(/\.json$/, ".manifest.json");
    const manifest: Manifest = existsSync(manifestFile)
      ? JSON.parse(readFileSync(manifestFile, "utf8"))
      : { beats: [], elements: [] };
    return { file, document, manifest };
  });
}

function describeTool(name: string, input: Record<string, unknown>) {
  const command = typeof input.command === "string" ? input.command : "";
  if (name === "Bash" && command.includes("render-frame")) return "Checking frames";
  if (name === "Bash" && command.includes("tsx")) return "Rendering the animation";
  if (name === "Write" || name === "Edit") return `Animating (${path.basename(String(input.file_path ?? "script"))})`;
  if (name === "Read" && String(input.file_path ?? "").endsWith(".png")) return "Looking at the frames";
  if (name === "Read" || name === "Grep" || name === "Glob") return `Reading ${path.basename(String(input.file_path ?? input.path ?? "the kit"))}`;
  if (name === "Skill") return "Reading the motion guide";
  return "Planning the motion";
}
