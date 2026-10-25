import type { Block } from "../types";
import * as atoms from "./atoms";
import * as lab from "./lab";
import * as molecules from "./molecules";
import * as reactions from "./reactions";
import * as solutions from "./solutions";

export * from "./atoms";
export * from "./lab";
export * from "./molecules";
export * from "./reactions";
export * from "./solutions";

const blocks = (mod: Record<string, unknown>) => Object.values(mod).filter((v): v is Block => typeof v === "object" && v !== null && "parts" in v && "anchors" in v);

/** Every chemistry block (the default instance of each factory), by topic. */
export const BY_TOPIC: Record<string, Block[]> = {
  "atoms and elements": blocks(atoms),
  "molecules and bonds": blocks(molecules),
  "matter and reactions": blocks(reactions),
  "solutions, acids and gases": blocks(solutions),
  "lab equipment": blocks(lab),
};

export const CHEMISTRY: Block[] = Object.values(BY_TOPIC).flat();
