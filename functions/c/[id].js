// GET /c/<id> — server-renders the shell index.html with the cached
// constellation + myth inlined as window.__SIGIL__, plus permalink-specific
// OG tags so previews look right when shared.

export async function onRequestGet({ params, env, request, next }) {
  const id = (params?.id || '').toLowerCase();
  if (!/^[a-z0-9]{6,32}$/.test(id)) {
    return new Response('Not found', { status: 404 });
  }

  const raw = await env.SIGIL_KV.get(id);
  if (!raw) {
    // Fall back to the SPA shell so the client shows "drawing" state.
    return next();
  }

  let record;
  try { record = JSON.parse(raw); }
  catch { return new Response('Corrupt record', { status: 500 }); }

  // Pull the static index.html as the shell.
  const url = new URL(request.url);
  const shellRes = await env.ASSETS.fetch(`${url.origin}/index.html`);
  if (!shellRes.ok) return new Response('Shell missing', { status: 500 });
  let html = await shellRes.text();

  const data = { id, ...record };
  const safeJson = JSON.stringify(data).replace(/</g, '\\u003c');

  // Open Graph + title tweaks
  const firstSentence = (record.myth || '').split(/(?<=[.!?])\s/)[0] || '';
  const ogDesc = (firstSentence || record.myth || '').slice(0, 200);
  const ogTitle = `${record.name} — A Sigil`;
  const ogUrl   = `${url.origin}/c/${id}`;

  html = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(ogTitle)}</title>`)
    .replace(/<meta property="og:url"[^>]*>/, `<meta property="og:url" content="${escapeAttr(ogUrl)}">`)
    .replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escapeAttr(ogTitle)}">`)
    .replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escapeAttr(ogDesc)}">`)
    .replace(/<meta name="twitter:title"[^>]*>/, `<meta name="twitter:title" content="${escapeAttr(ogTitle)}">`)
    .replace(/<meta name="twitter:description"[^>]*>/, `<meta name="twitter:description" content="${escapeAttr(ogDesc)}">`)
    .replace('</head>', `<script>window.__SIGIL__=${safeJson};</script></head>`);

  return new Response(html, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=86400, s-maxage=2592000, immutable',
    },
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
