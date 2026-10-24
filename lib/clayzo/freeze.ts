import { constant, valueAt, type AnimationDocument, type SceneNode } from "@clayzo/animation/authoring";

type Json = unknown;

function isKeyframed(value: Json): value is { kind: "keyframed"; keyframes: unknown[] } {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "keyframed" &&
    Array.isArray((value as { keyframes?: unknown }).keyframes)
  );
}

/** Replaces every keyframed track inside `value` with a constant holding its value at `tick`. */
function freezeValue(value: Json, tick: number, ticksPerSecond: number): Json {
  if (isKeyframed(value)) return constant(valueAt(value as never, tick, ticksPerSecond));
  if (Array.isArray(value)) return value.map((item) => freezeValue(item, tick, ticksPerSecond));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeValue(item, tick, ticksPerSecond)]));
  }
  return value;
}

/**
 * The scene exactly as it looks at `tick`, as a still document `durationTicks` long.
 *
 * Every node visible at `tick` is kept with all its animated properties frozen at their value
 * then (Clayzo's own `valueAt`, so springs and easing match the player). Audio, interaction and
 * markers are dropped. A detour or feedback animation that starts from these nodes starts on a
 * frame identical to the one the student paused on.
 */
export function freezeFrame(document: AnimationDocument, tick: number, durationTicks: number): AnimationDocument {
  const ticksPerSecond = document.timing.ticksPerSecond;
  const compositions: AnimationDocument["compositions"] = {};

  for (const [compositionId, composition] of Object.entries(document.compositions)) {
    const kept: Record<string, SceneNode> = {};
    for (const [id, node] of Object.entries(composition.nodes)) {
      if (node.type === "audio") continue;
      if (node.inTick > tick || node.outTick <= tick) continue;
      const frozen = freezeValue(node, tick, ticksPerSecond) as SceneNode;
      kept[id] = { ...frozen, inTick: 0, outTick: durationTicks };
    }
    // Drop references to nodes that are gone so the document stays valid.
    for (const node of Object.values(kept)) {
      if (node.type === "group") node.children = node.children.filter((child) => child in kept);
      if (node.type === "effect" && !(node.inputId in kept)) delete kept[node.id];
    }
    compositions[compositionId] = {
      ...composition,
      durationTicks,
      nodes: kept,
      rootNodeIds: composition.rootNodeIds.filter((id) => id in kept),
    };
  }

  const assets = Object.fromEntries(Object.entries(document.assets).filter(([, asset]) => asset.type !== "audio"));
  const rest: AnimationDocument = { ...document };
  delete rest.interaction;
  return {
    ...rest,
    id: `${document.id}-frozen-${tick}`,
    revision: "",
    timing: { ...document.timing, durationTicks, displayStartTick: 0 },
    assets,
    compositions,
    markers: [],
  };
}
