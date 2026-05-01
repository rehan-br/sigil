// Vite dev plugin: emulates the Cloudflare Pages Functions during `vite dev`.
// - POST /api/sigil           → calls Gemini, stores in an in-memory map
// - GET  /api/sigil/<id>      → reads from the in-memory map
// - GET  /c/<id>              → injects window.__SIGIL__ into index.html
//
// Production uses the real Pages Functions in /functions; this plugin is
// only loaded when `vite` is in serve mode.

import fs from 'node:fs';
import path from 'node:path';

export function devApiPlugin(env) {
  const mem = new Map();
  let sigilLib = null;

  async function loadLib() {
    if (sigilLib) return sigilLib;
    // Vite supports importing .js modules at runtime via dynamic import.
    sigilLib = await import('../functions/_lib/sigil.js');
    return sigilLib;
  }

  function readJson(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : {});
        } catch (e) { reject(e); }
      });
      req.on('error', reject);
    });
  }

  function sendJson(res, status, body) {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  return {
    name: 'sigil-dev-api',
    apply: 'serve',
    configureServer(server) {
      // Permalink HTML route
      server.middlewares.use(async (req, res, next) => {
        const m = req.url && req.url.match(/^\/c\/([a-z0-9]{6,32})(?:\?.*)?$/i);
        if (!m || req.method !== 'GET') return next();
        const id = m[1].toLowerCase();
        const record = mem.get(id);

        // Read the shell index.html through Vite so HMR / module rewriting
        // is preserved, then inline the data ourselves.
        const indexPath = path.resolve(server.config.root, 'index.html');
        let html = fs.readFileSync(indexPath, 'utf8');
        try { html = await server.transformIndexHtml(req.url, html); }
        catch (e) { return next(e); }

        if (record) {
          const safe = JSON.stringify({ id, ...record }).replace(/</g, '\\u003c');
          html = html.replace('</head>',
            `<script>window.__SIGIL__=${safe};</script></head>`);
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
      });

      // GET /api/sigil/<id>
      server.middlewares.use(async (req, res, next) => {
        const m = req.url && req.url.match(/^\/api\/sigil\/([a-z0-9]+)(?:\?.*)?$/i);
        if (!m || req.method !== 'GET') return next();
        const id = m[1].toLowerCase();
        const record = mem.get(id);
        if (!record) return sendJson(res, 404, { error: 'not found' });
        return sendJson(res, 200, { id, ...record });
      });

      // POST /api/sigil
      server.middlewares.use('/api/sigil', async (req, res, next) => {
        if (req.method !== 'POST') return next();
        let payload;
        try { payload = await readJson(req); }
        catch { return sendJson(res, 400, { error: 'invalid json' }); }
        try {
          const lib = await loadLib();
          const result = await lib.generateOrFetchSigil({
            payload,
            env: {
              GEMINI_API_KEY: env.GEMINI_API_KEY,
              GEMINI_MODEL: env.GEMINI_MODEL || 'gemini-2.5-flash',
            },
            kv: {
              async get(id) { return mem.get(id) || null; },
              async put(id, record) { mem.set(id, record); },
            },
          });
          return sendJson(res, 200, result);
        } catch (err) {
          const status = err.status || 500;
          console.error('[dev-api] sigil POST error:', err);
          return sendJson(res, status, { error: err.message || 'unknown error' });
        }
      });
    },
  };
}
