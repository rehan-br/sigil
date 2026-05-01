import { generateOrFetchSigil } from '../_lib/sigil.js';

// POST /api/sigil
export async function onRequestPost({ request, env }) {
  let payload;
  try { payload = await request.json(); }
  catch { return jsonError(400, 'invalid json'); }

  try {
    const result = await generateOrFetchSigil({
      payload,
      env,
      kv: kvAdapter(env.SIGIL_KV),
    });
    return jsonOk(result);
  } catch (err) {
    const status = err.status || 500;
    console.error('sigil POST error', err);
    return jsonError(status, err.message || 'unknown error');
  }
}

function kvAdapter(ns) {
  return {
    async get(id) {
      const raw = await ns.get(id);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async put(id, record) {
      await ns.put(id, JSON.stringify(record));
    },
  };
}

function jsonOk(obj) {
  return new Response(JSON.stringify(obj), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
