// GET /api/sigil/<id>  →  return cached record or 404.
export async function onRequestGet({ params, env }) {
  const id = (params?.id || '').toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(id)) {
    return new Response(JSON.stringify({ error: 'bad id' }), {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  const raw = await env.SIGIL_KV.get(id);
  if (!raw) {
    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  let record;
  try { record = JSON.parse(raw); }
  catch {
    return new Response(JSON.stringify({ error: 'corrupt record' }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  return new Response(JSON.stringify({ id, ...record }), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=86400, immutable',
    },
  });
}
