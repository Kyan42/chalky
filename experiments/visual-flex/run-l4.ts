// Child process for level 4: imports one model-written module and prints its default export as JSON.
// Run with a timeout from generate.ts; network APIs are removed before the module loads.
import { pathToFileURL } from "node:url";

for (const name of ["fetch", "WebSocket", "EventSource", "XMLHttpRequest"]) {
  Object.defineProperty(globalThis, name, { value: undefined, configurable: false, writable: false });
}

async function main() {
  const mod = await import(pathToFileURL(process.argv[2]).href);
  // A CommonJS-transformed module nests the export once more.
  process.stdout.write(JSON.stringify(mod.default?.default ?? mod.default));
}

main().catch((e) => {
  process.stderr.write(String(e?.stack ?? e));
  process.exit(1);
});
