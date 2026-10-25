import type { Block } from "../types";
import * as ai from "./ai";
import * as charts from "./charts";
import * as data from "./data";
import * as devices from "./devices";
import * as software from "./software";

export * from "./ai";
export * from "./charts";
export * from "./data";
export * from "./devices";
export * from "./software";
// Several files declare the same { color } options shape; name one so the re-exports don't clash.
export type { ColorOptions } from "./devices";

const blocks = (mod: Record<string, unknown>) => Object.values(mod).filter((v): v is Block => typeof v === "object" && v !== null && "parts" in v && "anchors" in v);

/** Every computing block (the default instance of each factory), by topic. */
export const BY_TOPIC: Record<string, Block[]> = {
  devices: blocks(devices),
  software: blocks(software),
  "data and algorithms": blocks(data),
  "AI and neural networks": blocks(ai),
  "charts and flow": blocks(charts),
};

export const COMPUTING: Block[] = Object.values(BY_TOPIC).flat();
