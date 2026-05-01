// Shared logic for the Sigil API: canonicalisation, hash, prompt, LLM call.
// Used by Pages Functions in production AND by the Vite dev plugin locally,
// so this file must stay portable (Web Crypto, fetch, no Node-only APIs).

// ---- Canonical hash (mirror of src/sky.js canonicalKey) -----------------
// Inputs: stars = [[ux,uy,tier], ...], edges = [[a,b], ...]
// Output: short base32 id, or null if no edges.
export async function canonicalKey(stars, edges) {
  const used = new Set();
  for (const [a, b] of edges) { used.add(a); used.add(b); }
  if (used.size === 0) return null;

  let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of used) {
    const [ux, uy] = stars[i];
    if (ux < minX) minX = ux;
    if (uy < minY) minY = uy;
    if (ux > maxX) maxX = ux;
    if (uy > maxY) maxY = uy;
  }
  const span = Math.max(1e-6, Math.max(maxX - minX, maxY - minY));

  const N = 32;
  const snapped = new Map();
  for (const i of used) {
    const [ux, uy] = stars[i];
    const nx = (ux - minX) / span;
    const ny = (uy - minY) / span;
    const gx = Math.round(nx * (N - 1));
    const gy = Math.round(ny * (N - 1));
    snapped.set(i, gy * N + gx);
  }

  const edgeSet = new Set();
  for (const [a, b] of edges) {
    const sa = snapped.get(a);
    const sb = snapped.get(b);
    if (sa === sb) continue;
    const lo = Math.min(sa, sb);
    const hi = Math.max(sa, sb);
    edgeSet.add(`${lo}-${hi}`);
  }
  const sorted = [...edgeSet].sort();
  if (sorted.length === 0) return null;

  const buf = new TextEncoder().encode(sorted.join(','));
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return base32(new Uint8Array(digest).slice(0, 10));
}

const B32_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function base32(bytes) {
  let bits = 0, value = 0, out = '';
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

// ---- The prompt ---------------------------------------------------------
// Voice references: Aristotle's "On the Heavens"; KJV cadence; 19th-century
// astronomy primers. Slightly wrong about astronomy. Dignified.
export function buildPrompt({ starCount, edgeCount }) {
  return `You are an astronomer-poet writing a single entry for a celestial almanac, circa 1840. You have just been shown a newly catalogued constellation. Give it a name and write its myth.

VOICE
- Dignified, slow, formal. Heavy on cadence; prefer semicolons to dashes.
- Slight grandeur from the King James Bible. Slight breathlessness from a Victorian astronomy primer. Slight earnest wrongness from Aristotle's "On the Heavens".
- Astronomy itself should be confidently wrong. Speak of the stars' "humours", of "the obedience of the lesser fires", of their "ether". Do NOT use modern terms ("light-year", "galaxy", "spectrum", parsec, kilometre, Celsius).

CONSTRAINTS
- Output a single JSON object: { "name": ..., "myth": ... }.
- "name" is short — 2 to 5 words — Latin or pseudo-Latin, or English in the manner of an astronomical primer (e.g. "Cervus Lapidaris", "The Serpent of Glass", "Argo's Lantern").
- "myth" is one paragraph, 90–140 words. Begin with a brief line of the constellation's character ("A figure of...", "It is held that...", "The ancients called it..."). Do not repeat the name inside the myth. Do not use quotation marks around the name.
- Reference the figure exactly: it has ${starCount} stars and ${edgeCount} connecting lines.
- Make at least ONE confidently false astronomical claim — its season, its supposed influence on tides or beasts, its position relative to a fictional adjacent constellation, etc.
- End with a short reflective clause about what the constellation portends, or how mariners or shepherds have read it.

Now write the entry.`;
}

// ---- Gemini call --------------------------------------------------------
export async function callGemini({ apiKey, model, prompt }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 1.05,
      topP: 0.95,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          myth: { type: 'string' },
        },
        required: ['name', 'myth'],
      },
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gemini ${res.status}: ${text.slice(0, 400)}`);
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  if (!text) throw new Error(`Gemini returned no text: ${JSON.stringify(json).slice(0, 400)}`);

  let parsed;
  try { parsed = JSON.parse(text); }
  catch {
    // The schema should have guaranteed JSON, but if not, fall back.
    parsed = { name: 'An Unnamed Sigil', myth: text.trim() };
  }
  const name = String(parsed.name || '').trim().slice(0, 80) || 'An Unnamed Sigil';
  const myth = String(parsed.myth || '').trim();
  if (!myth) throw new Error('Gemini returned empty myth');
  return { name, myth };
}

// ---- High-level helper used by both the Pages Function and the dev API.
// `kvGet` and `kvPut` abstract the storage backend.
export async function generateOrFetchSigil({ payload, env, kv }) {
  const stars = payload?.stars;
  const edges = payload?.edges;
  if (!Array.isArray(stars) || !Array.isArray(edges) || edges.length < 1) {
    throw Object.assign(new Error('bad payload'), { status: 400 });
  }

  const id = await canonicalKey(stars, edges);
  if (!id) throw Object.assign(new Error('no edges'), { status: 400 });

  const existing = await kv.get(id);
  if (existing) {
    return { id, ...existing, cached: true };
  }

  // Build a *minimal* stored representation: only the stars used by edges,
  // re-indexed. This keeps the KV value compact and lets the permalink
  // re-render the constellation without storing the whole 220-star sky.
  const used = new Set();
  for (const [a, b] of edges) { used.add(a); used.add(b); }
  const usedIndices = [...used];
  const reindex = new Map(usedIndices.map((origIdx, newIdx) => [origIdx, newIdx]));
  const compactStars = usedIndices.map(i => {
    const s = stars[i];
    return { ux: s[0], uy: s[1], tier: s[2] };
  });
  const compactEdges = edges.map(([a, b]) => [reindex.get(a), reindex.get(b)]);

  const prompt = buildPrompt({ starCount: compactStars.length, edgeCount: compactEdges.length });
  const { name, myth } = await callGemini({
    apiKey: env.GEMINI_API_KEY,
    model: env.GEMINI_MODEL || 'gemini-2.5-flash',
    prompt,
  });

  const record = {
    name,
    myth,
    stars: compactStars,
    edges: compactEdges,
    createdAt: new Date().toISOString(),
  };
  await kv.put(id, record);

  return { id, ...record, cached: false };
}
