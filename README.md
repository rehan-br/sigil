# Sigil

Constellation-myth lab. Trace stars, get a Gemini-written myth in the voice
of a 19th-century astronomer.

Live at `sigil.thedeveloperguys.com`. Lab 04 of `fun.thedeveloperguys.com`.

See `CLAUDE.md` for the full design brief.

## Running locally

```bash
npm install
npm run dev
```

The Vite dev server emulates the Cloudflare Pages Functions in-process — no
wrangler required. Reads `GEMINI_API_KEY` from `.env`. KV is an in-memory
`Map` that resets when the dev server restarts.

To exercise the **real** Pages Functions + KV bindings locally:

```bash
npm run build
npm run pages:dev
```

This requires `wrangler.toml` to point at a real KV namespace (see below).

## Cloudflare deploy

### One-time setup

1. Create the KV namespace:
   ```bash
   npx wrangler kv:namespace create SIGIL_KV
   npx wrangler kv:namespace create SIGIL_KV --preview
   ```
   Paste the returned IDs into `wrangler.toml` as `id` and `preview_id`.

2. Set the Gemini secret on the project (NOT in source):
   ```bash
   npx wrangler pages secret put GEMINI_API_KEY --project-name=sigil
   # paste your AIza... key when prompted
   ```
   Optionally set `GEMINI_MODEL` the same way to override the default
   `gemini-2.5-flash`.

3. Connect the GitHub repo to a Cloudflare Pages project named `sigil`.
   Build command: `npm run build`. Build output: `dist`.

4. Bind the KV namespace in **Pages → Settings → Functions → KV namespace
   bindings**: variable name `SIGIL_KV` → the namespace from step 1.

5. Add the custom domain `sigil.thedeveloperguys.com` under **Pages →
   Custom domains**.

6. On `fun.thedeveloperguys.com`, add the Sigil card as Lab 04 with a link
   to the new subdomain.

### Rotating the Gemini key

If a key leaks (or you just want to rotate):

1. Revoke the old key in Google AI Studio.
2. Generate a new one.
3. `npx wrangler pages secret put GEMINI_API_KEY --project-name=sigil`
4. Update `.env` locally for dev.

## Files

```
index.html                # Single-page shell (drawing / generating / reveal)
src/
  main.js                 # State + interaction
  sky.js                  # Starfield generator, canvas renderer, hash
  style.css               # Agency design system, deep-navy canvas
  dev-api.js              # Vite plugin: emulates Pages Functions in dev
functions/
  _lib/sigil.js           # Shared: canonical hash, prompt, Gemini call
  api/sigil.js            # POST /api/sigil
  api/sigil/[id].js       # GET  /api/sigil/<id>
  c/[id].js               # GET  /c/<id> — SSR shell with __SIGIL__ inlined
samples/                  # Reference outputs for prompt-regression testing
wrangler.toml             # KV binding config
```
