// Drives /spike/clayzo in Chromium and prints the measured results.
// Usage: node scripts/spike-clayzo.mjs [baseUrl]
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: process.env.HEADED ? false : true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => m.type() === "error" && console.error("[page]", m.text()));
await page.goto(`${base}/spike/clayzo`);
await page.waitForFunction(() => window.__clayzoSpike?.done === true, null, { timeout: 120_000 });
const results = await page.evaluate(() => window.__clayzoSpike);
mkdirSync("docs/screenshots", { recursive: true });
await page.screenshot({ path: "docs/screenshots/clayzo-spike.png" });
writeFileSync("docs/clayzo-spike-results.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
