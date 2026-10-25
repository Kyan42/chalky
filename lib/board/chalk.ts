/**
 * Janani's chalk grain (presets/board.ts on her `presets` branch): a custom SkSL effect node over
 * everything drawn, giving grain and slightly broken edges like chalk dragged over slate. Kept
 * verbatim so the two boards look the same; `chalkEffect` wraps it as a node for our documents.
 */
import { base, constant, type SceneNode } from "@clayzo/animation/authoring";

export const CHALK_SKSL = `
uniform shader inputImage;
uniform float grain;
uniform float2 renderScale;
float hash(float2 p) { return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
float vnoise(float2 p) {
  float2 i = floor(p); float2 f = fract(p);
  float a = hash(i), b = hash(i + float2(1, 0)), c = hash(i + float2(0, 1)), d = hash(i + float2(1, 1));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
half4 main(float2 p) {
  float2 q = p / renderScale.x;
  float2 wobble = (float2(vnoise(q * 0.3), vnoise(q * 0.3 + 17.0)) - 0.5) * 2.5;
  half4 src = inputImage.eval((q + wobble) * renderScale.x);
  if (src.a < 0.002) { return half4(0.0); }
  half4 c = unpremul(src);
  float fine = hash(floor(q * 1.3));
  float mid = vnoise(q * 0.55);
  float streak = vnoise(float2(q.x * 0.12 + q.y * 0.04, q.y * 1.1));
  float keep = smoothstep(0.22, 0.6, fine * 0.5 + mid * 0.3 + streak * 0.2);
  float a = float(c.a) * mix(1.0, keep, grain);
  return half4(c.rgb * half(a), half(a));
}`;

/** An effect node of `kind` over `inputId` (her `effect` helper). */
export function effectNode(id: string, inputId: string, kind: "custom-sksl" | "blur", end: number, params: [string, number, number, number][], sksl?: string): SceneNode {
  return {
    ...base(id, { outTick: end }),
    type: "effect",
    inputId,
    effect: kind,
    ...(sksl ? { implementation: sksl } : {}),
    parameters: params.map(([name, value, minimum, maximum]) => ({ id: `${id}-${name}`, name, valueType: "number" as const, value: constant(value), minimum, maximum })),
    capability: { requires: [kind === "blur" ? "image-filter" : "runtime-effect"], fallback: "passthrough", maxTemporarySurfaces: 1 },
  } as SceneNode;
}

/** The chalk grain over the node `inputId`, with `grain` 0..1. */
export function chalkEffect(id: string, inputId: string, end: number, grain: number, sksl = CHALK_SKSL): SceneNode {
  return effectNode(id, inputId, "custom-sksl", end, [["grain", grain, 0, 1]], sksl);
}
