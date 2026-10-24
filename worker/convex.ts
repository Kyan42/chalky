import { ConvexHttpClient } from "convex/browser";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import type { Id } from "../convex/_generated/dataModel";
import { env } from "./env";

let client: ConvexHttpClient | null = null;
const convex = () => (client ??= new ConvexHttpClient(env.convexUrl()));

type WithSecret<F extends FunctionReference<"query" | "mutation">> = Omit<FunctionArgs<F>, "secret">;

/** Calls a worker-only query, adding the shared secret. */
export function workerQuery<F extends FunctionReference<"query">>(fn: F, args: WithSecret<F>): Promise<FunctionReturnType<F>> {
  return convex().query(fn, { ...args, secret: env.workerSecret() } as FunctionArgs<F>);
}

/** Calls a worker-only mutation, adding the shared secret. */
export function workerMutation<F extends FunctionReference<"mutation">>(fn: F, args: WithSecret<F>): Promise<FunctionReturnType<F>> {
  return convex().mutation(fn, { ...args, secret: env.workerSecret() } as FunctionArgs<F>);
}

export async function upload(bytes: Uint8Array | string, contentType: string): Promise<Id<"_storage">> {
  const { api } = await import("../convex/_generated/api");
  const url = await workerMutation(api.jobs.uploadUrl, {});
  const body = typeof bytes === "string" ? bytes : new Blob([bytes as BlobPart], { type: contentType });
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": contentType }, body });
  if (!response.ok) throw new Error(`Upload failed: ${response.status} ${await response.text()}`);
  const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
  return storageId;
}

export async function download(url: string | null): Promise<Uint8Array> {
  if (!url) throw new Error("Missing file URL");
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
