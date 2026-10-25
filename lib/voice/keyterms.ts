/**
 * Ink-2 key terms: words the recogniser should expect. Measured
 * (scripts/keyterm-check.mjs): they work ("Hey Chucky" became "Hey Chalky"),
 * Ink accepts at most 100 (more is an error and nothing is transcribed), and
 * they are connection parameters, so changing them reconnects the socket.
 *
 * Order matters under the cap: Chalky's name, then the lesson's own topic
 * words, then common science and learning vocabulary for the first turn,
 * before any topic is known ("photosynthesis" once came back as "put it in
 * the chat").
 */
export const MAX_KEYTERMS = 100;

export const SEED_KEYTERMS = [
  // biology
  "photosynthesis", "chlorophyll", "chloroplast", "mitochondria", "nucleus", "molecule", "protein", "enzyme", "DNA", "gene",
  "evolution", "ecosystem", "bacteria", "virus", "vaccine", "antibody", "immune", "neuron", "digestion", "osmosis",
  "diffusion", "xylem", "stomata", "glucose", "respiration", "metabolism", "organism", "species", "cell membrane", "hormone",
  // physics
  "gravity", "friction", "momentum", "velocity", "acceleration", "wavelength", "frequency", "photon", "electron", "proton",
  "neutron", "atom", "electricity", "magnetism", "voltage", "circuit", "energy", "entropy", "thermodynamics", "relativity",
  "quantum", "refraction", "reflection", "spectrum", "Rayleigh scattering", "radiation", "nuclear", "orbit", "black hole", "galaxy",
  // chemistry and earth
  "oxygen", "carbon dioxide", "nitrogen", "hydrogen", "ion", "isotope", "catalyst", "atmosphere", "climate", "tectonic plates",
  "volcano", "erosion",
  // maths and other subjects
  "algebra", "calculus", "derivative", "integral", "probability", "statistics", "geometry", "theorem", "compound interest", "inflation",
  "supply and demand", "democracy",
];

const STOP = new Set(["about", "after", "again", "because", "before", "being", "could", "does", "doing", "explain", "going", "happens", "learn", "really", "should", "something", "tell", "their", "there", "these", "thing", "things", "those", "through", "understand", "walk", "what", "when", "where", "which", "while", "would", "works"]);

/** Content words of a question or title, worth expecting in what the learner says next. */
export function topicWords(...texts: string[]): string[] {
  return texts
    .flatMap((t) => t.split(/[^A-Za-z'-]+/))
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter((w) => w.length > 4 && !STOP.has(w.toLowerCase()));
}

/** Chalky's name, then the topic words, then the seed vocabulary: unique, at most 100. */
export function buildKeyterms(topic: string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of ["Chalky", ...topic, ...SEED_KEYTERMS]) {
    const k = t.trim();
    if (k.length < 2 || k.length > 49 || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
    if (out.length >= MAX_KEYTERMS) break;
  }
  return out;
}
