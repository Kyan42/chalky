// One sentence through the lesson's /api/tts with different preference cookies: speech length per speed and voice.
const text = "Light from the sun is a mix of every color, and the air scatters blue the most.";
const prefs = (voice) => `chalky-preferences=${encodeURIComponent(JSON.stringify({ voice }))}`;
const cases = [
  ["default (no cookie)", ""],
  ["speed 0.8", "chalky-speed=0.8"],
  ["speed 1.2", "chalky-speed=1.2"],
  ["Clive, speed 1.2", `${prefs("b24f41fd-00a3-4cd8-992a-a0c9f13f3ef1")}; chalky-speed=1.2`],
  ["Archie, default speed", prefs("ef191366-f52f-447a-a398-ed8c0f2943a1")],
];
for (const [name, cookie] of cases) {
  const r = await fetch("http://localhost:3006/api/tts", { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ text }) });
  const events = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
  const done = events.find((e) => e.type === "done");
  const ends = events.filter((e) => e.type === "timestamps").flatMap((e) => e.end);
  console.log(`${name.padEnd(24)} audio ${done?.stats?.audioSeconds?.toFixed(2)} s, last word ends ${Math.max(0, ...ends).toFixed(2)} s ${events.find((e) => e.type === "error")?.message ?? ""}`);
}
