// Copies the keys in .env.convex onto the Convex deployment (npx convex env set ...).
// Placeholders (values starting with YOUR_) are skipped.
//   npm run keys
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const file = ".env.convex";
if (!existsSync(file)) {
  console.error(`${file} not found. Copy .env.convex.example to ${file} and fill it in.`);
  process.exit(1);
}

for (const line of readFileSync(file, "utf8").split("\n")) {
  const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!match) continue;
  const [, name, raw] = match;
  const value = raw.replace(/^["']|["']$/g, "");
  if (!value || value.startsWith("YOUR_")) {
    console.log(`- ${name}: placeholder, skipped`);
    continue;
  }
  execFileSync("npx", ["convex", "env", "set", name, value], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`✓ ${name}`);
}
