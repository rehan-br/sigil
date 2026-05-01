import { generateStars, SkyRenderer, canonicalKey } from './sky.js';
import { downloadSigilCard } from './card.js';

// ---- Theme toggle (mirrors Plume) ---------------------------------------
const themeBtn = document.getElementById('themeToggle');
themeBtn?.addEventListener('click', () => {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});

// ---- DOM refs -----------------------------------------------------------
const body          = document.body;
const canvas        = document.getElementById('sky-canvas');
const stateLabel    = document.getElementById('state-label');
const countLabel    = document.getElementById('count-label');
const undoBtn       = document.getElementById('undo-btn');
const clearBtn      = document.getElementById('clear-btn');
const castBtn       = document.getElementById('cast-btn');
const revealName    = document.getElementById('reveal-name');
const revealMyth    = document.getElementById('reveal-myth');
const revealId      = document.getElementById('reveal-id');
const revealLink    = document.getElementById('reveal-permalink');
const copyLinkBtn   = document.getElementById('copy-link-btn');
const resetBtn      = document.getElementById('reset-btn');
const downloadBtn   = document.getElementById('download-btn');

// The constellation currently on display in reveal mode (compact form).
// Set by showReveal; read by the download handler.
let activeReveal = null;

// ---- Sky setup ----------------------------------------------------------
const stars = generateStars({ count: 220 });
const sky   = new SkyRenderer(canvas, stars);

let edges = [];        // [[a,b], ...]
let pending = -1;      // currently-selected star awaiting partner

function setState(s) {
  body.dataset.state = s;
  if (s === 'drawing')    stateLabel.textContent = 'Drawing';
  if (s === 'generating') stateLabel.textContent = 'Casting';
  if (s === 'reveal')     stateLabel.textContent = 'Cast';
}

function refreshCount() {
  const used = new Set();
  for (const [a, b] of edges) { used.add(a); used.add(b); }
  const s = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  countLabel.textContent = `${s(used.size, 'star')} · ${s(edges.length, 'line')}`;
  castBtn.disabled = edges.length < 1;
  undoBtn.disabled = edges.length < 1 && pending < 0;
  clearBtn.disabled = edges.length < 1 && pending < 0;
}

function syncRenderer() {
  sky.setEdges(edges);
  sky.setPending(pending);
  refreshCount();
}

function clearAll() {
  edges = [];
  pending = -1;
  syncRenderer();
}

function undoLast() {
  if (pending !== -1) { pending = -1; syncRenderer(); return; }
  if (edges.length) { edges.pop(); syncRenderer(); }
}

// ---- Pointer events on canvas ------------------------------------------
function pointerToCanvas(ev) {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

canvas.addEventListener('mousemove', (ev) => {
  if (body.dataset.state !== 'drawing') return;
  const { x, y } = pointerToCanvas(ev);
  const idx = sky.hitTest(x, y);
  sky.setHover(idx);
  canvas.style.cursor = idx >= 0 ? 'pointer' : 'crosshair';
});

canvas.addEventListener('mouseleave', () => sky.setHover(-1));

canvas.addEventListener('click', (ev) => {
  if (body.dataset.state !== 'drawing') return;
  const { x, y } = pointerToCanvas(ev);
  const idx = sky.hitTest(x, y);
  if (idx < 0) {
    // click on empty: deselect pending
    if (pending !== -1) { pending = -1; syncRenderer(); }
    return;
  }
  if (pending === -1) {
    pending = idx;
  } else if (pending === idx) {
    pending = -1;
  } else {
    const lo = Math.min(pending, idx);
    const hi = Math.max(pending, idx);
    const exists = edges.some(([a, b]) => a === lo && b === hi);
    if (!exists) edges.push([lo, hi]);
    pending = -1;
  }
  syncRenderer();
});

// ---- Buttons & keys ----------------------------------------------------
undoBtn.addEventListener('click', undoLast);
clearBtn.addEventListener('click', clearAll);
castBtn.addEventListener('click', cast);
resetBtn.addEventListener('click', () => {
  // Drop the URL back to root, clear, return to drawing state.
  history.pushState({}, '', '/');
  clearAll();
  setState('drawing');
});
copyLinkBtn.addEventListener('click', async () => {
  const url = revealLink.href;
  try {
    await navigator.clipboard.writeText(url);
    copyLinkBtn.textContent = 'Copied';
    setTimeout(() => { copyLinkBtn.textContent = 'Copy permalink'; }, 1600);
  } catch {
    copyLinkBtn.textContent = 'Press Ctrl+C';
  }
});

downloadBtn.addEventListener('click', async () => {
  if (!activeReveal) return;
  const original = downloadBtn.querySelector('svg')?.outerHTML || '';
  downloadBtn.disabled = true;
  const labelNode = downloadBtn.lastChild;
  const prevLabel = labelNode.textContent;
  labelNode.textContent = ' Drawing…';
  try {
    await downloadSigilCard(activeReveal);
  } catch (err) {
    console.error('download failed', err);
    alert('Could not generate the image. Try again.');
  } finally {
    downloadBtn.disabled = false;
    labelNode.textContent = prevLabel;
  }
});

window.addEventListener('keydown', (ev) => {
  if (body.dataset.state !== 'drawing') return;
  if (ev.key === 'Escape') { ev.preventDefault(); undoLast(); }
  else if (ev.key === 'c' || ev.key === 'C') { ev.preventDefault(); clearAll(); }
  else if (ev.key === 'Enter' && edges.length >= 1) { ev.preventDefault(); cast(); }
});

// ---- Cast: send to API, then reveal -----------------------------------
async function cast() {
  if (body.dataset.state !== 'drawing') return;
  if (edges.length < 1) return;

  setState('generating');
  const id = await canonicalKey(stars, edges);

  // Send only the used stars and the edges in their original index space —
  // the server canonicalises again with the same algorithm and stores under
  // its own key. We pass our id as a hint so the server can optionally
  // short-circuit, but the server is the source of truth.
  const payload = {
    id,
    stars: stars.map(s => [s.ux, s.uy, s.tier]),
    edges,
  };

  try {
    const res = await fetch('/api/sigil', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    showReveal(data);
  } catch (err) {
    console.error('cast failed', err);
    setState('drawing');
    alert('The astronomer could not be reached. Try again in a moment.');
  }
}

function showReveal(data) {
  const { id, name, myth } = data;
  revealId.textContent = id;
  revealName.textContent = name || 'An Unnamed Sigil';
  revealMyth.textContent = '';
  const url = `${location.origin}/c/${id}`;
  revealLink.href = url;

  // Build a compact, self-contained snapshot for the download card.
  // For permalinks the API/SSR already provides compact stars+edges; for
  // a fresh cast we build it from the live `edges` array against the sky.
  let cardStars, cardEdges;
  if (Array.isArray(data.stars) && Array.isArray(data.edges)) {
    cardStars = data.stars.map(s => ({ ux: s.ux, uy: s.uy, tier: s.tier ?? 2 }));
    cardEdges = data.edges.map(([a, b]) => [a, b]);
  } else {
    const used = new Set();
    for (const [a, b] of edges) { used.add(a); used.add(b); }
    const indices = [...used];
    const remap = new Map(indices.map((orig, ni) => [orig, ni]));
    cardStars = indices.map(i => ({ ux: stars[i].ux, uy: stars[i].uy, tier: stars[i].tier }));
    cardEdges = edges.map(([a, b]) => [remap.get(a), remap.get(b)]);
  }
  activeReveal = { id, name: revealName.textContent, myth: myth || '', stars: cardStars, edges: cardEdges };

  history.pushState({}, '', `/c/${id}`);
  setState('reveal');

  // Typewriter effect — feels appropriate for the voice.
  typewriter(revealMyth, myth || '', 14);
}

function typewriter(node, text, ms) {
  let i = 0;
  function step() {
    if (i >= text.length) return;
    node.textContent = text.slice(0, ++i);
    setTimeout(step, ms);
  }
  step();
}

// ---- Bootstrapping: handle /c/<id> permalinks --------------------------
function applyPermalinkData(data) {
  // Stored records carry their *own* compact star list, indexed 0..N-1.
  // Append them to the sky and remap edges to those new indices.
  if (Array.isArray(data.stars) && Array.isArray(data.edges)) {
    const start = sky.addStars(data.stars.map(s => ({
      ux: s.ux, uy: s.uy, tier: 2,
    })));
    edges = data.edges.map(([a, b]) => [a + start, b + start]);
    syncRenderer();
  }
}

async function bootstrapFromPermalink() {
  // Server-rendered permalink injects `window.__SIGIL__`.
  if (window.__SIGIL__) {
    const data = window.__SIGIL__;
    applyPermalinkData(data);
    showReveal(data);
    return;
  }
  // Fallback for SPA dev: fetch by id from URL.
  const m = location.pathname.match(/^\/c\/([a-z0-9]+)$/i);
  if (!m) return;
  const id = m[1];
  setState('generating');
  try {
    const res = await fetch(`/api/sigil/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    applyPermalinkData(data);
    showReveal(data);
  } catch (err) {
    console.error('permalink load failed', err);
    setState('drawing');
  }
}

// Initial paint
syncRenderer();
setState('drawing');
bootstrapFromPermalink();

// Debug hook (harmless in prod; tree-shakes only if we conditionally guard).
// Used for end-to-end testing.
if (typeof window !== 'undefined') {
  window.__sigil = {
    sky,
    stars,
    get edges() { return edges; },
    cast,
    clearAll,
    pickAndConnect(unitTargets) {
      // Pick the nearest star to each unit target, then connect them
      // sequentially. Returns the indices used.
      const inset = 18;
      const rect = canvas.getBoundingClientRect();
      const w = rect.width  - inset * 2;
      const h = rect.height - inset * 2;
      const indices = [];
      const seen = new Set();
      for (const [ux, uy] of unitTargets) {
        const px = inset + ux * w;
        const py = inset + uy * h;
        // Same hitTest as the renderer, but no radius cap — pick nearest.
        let best = -1, bestD2 = Infinity;
        for (let i = 0; i < stars.length; i++) {
          const sp = sky.starPixel(stars[i]);
          const dx = sp.x - px;
          const dy = sp.y - py;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2 && !seen.has(i)) { bestD2 = d2; best = i; }
        }
        if (best >= 0) { indices.push(best); seen.add(best); }
      }
      // Connect sequentially: 0-1, 1-2, 2-3, 3-4
      clearAll();
      for (let i = 0; i < indices.length - 1; i++) {
        const lo = Math.min(indices[i], indices[i + 1]);
        const hi = Math.max(indices[i], indices[i + 1]);
        if (!edges.some(([a, b]) => a === lo && b === hi)) edges.push([lo, hi]);
      }
      syncRenderer();
      return indices;
    },
  };
}
