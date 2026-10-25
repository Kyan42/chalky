# Chalky style packs

Regenerate with `npx tsx scripts/build-style-packs.ts`.

Each style has style.json, icons.json and one SVG per existing block. Base geometry, named parts, anchors and teaching meaning are preserved. All packs use palette.json with identical per-part fill and stroke values. The chair reference is the priority. SVG filters implement deterministic grain and contour wobble in the exported icons. These are style studies; changing live Clayzo rendering requires an adapter. The paper-cut preset retains curved source geometry and is not yet fully angular.
