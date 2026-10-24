"use client";

import type { AnimationDocument } from "@clayzo/animation";
import type { PlayerAssetLoaders } from "@clayzo/webgl-player";

/** A segment as the app receives it from Convex: storage URLs for the document and its files. */
export type PlayableSegment = {
  _id: string;
  kind: string;
  documentUrl: string | null;
  assets: { uri: string; url: string | null }[];
  manifest: unknown;
  durationTicks: number;
  ticksPerSecond: number;
};

const bytes = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url} (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
};

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, load().catch((e) => (cache.delete(key), Promise.reject(e))));
  return cache.get(key) as Promise<T>;
}

export function loadDocument(url: string) {
  return cached(url, async () => JSON.parse(new TextDecoder().decode(await bytes(url))) as AnimationDocument);
}

/** Fonts ship with the app under /fonts; audio and images come from the segment's storage URLs. */
export function loadersFor(assets: { uri: string; url: string | null }[]): PlayerAssetLoaders {
  const byUri = new Map(assets.map((a) => [a.uri, a.url]));
  const fromStorage = async (uri: string) => {
    const url = byUri.get(uri);
    return url ? await cached(url, () => bytes(url)) : null;
  };
  return {
    fontAssetLoader: (asset) => cached(`font:${asset.uri}`, () => bytes(`/${asset.uri.replace(/^\.?\//, "")}`)),
    audioAssetLoader: (asset) => fromStorage(asset.uri),
    imageAssetLoader: (asset) => fromStorage(asset.uri),
  };
}
