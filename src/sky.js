// Deterministic starfield generator + canvas renderer for Sigil.
// Stars are placed in a fixed unit-square layout so every visitor sees
// the same sky. The pixel positions scale with the canvas size.

// --- Seeded PRNG (mulberry32) ---------------------------------------------
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- Star generation -------------------------------------------------------
// Each star: { ux, uy, tier } where ux,uy in [0,1] (unit square).
export function generateStars({ count = 220, seed = 0xC07057E1 } = {}) {
  const rand = mulberry32(seed);
  const stars = [];
  // Use blue-noise-ish rejection for nicer distribution.
  const minDist = 0.035;
  const minDist2 = minDist * minDist;
  let safety = 0;
  while (stars.length < count && safety < count * 40) {
    safety++;
    const ux = rand();
    const uy = rand();
    let ok = true;
    for (let i = 0; i < stars.length; i++) {
      const dx = stars[i].ux - ux;
      const dy = stars[i].uy - uy;
      if (dx * dx + dy * dy < minDist2) { ok = false; break; }
    }
    if (!ok) continue;
    // Tier: most stars dim, a few bright. tier in {0,1,2}.
    const r = rand();
    const tier = r < 0.65 ? 0 : r < 0.92 ? 1 : 2;
    stars.push({ ux, uy, tier });
  }
  return stars;
}

// --- Renderer --------------------------------------------------------------
export class SkyRenderer {
  constructor(canvas, stars) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.stars = stars;
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.height = 0;
    this.hoverIndex = -1;
    this.pendingIndex = -1;
    this.selectedSet = new Set();
    this.edges = []; // [a, b]
    this.twinkle = []; // per-star twinkle phase
    for (let i = 0; i < stars.length; i++) {
      this.twinkle.push(Math.random() * Math.PI * 2);
    }
    this._raf = null;
    this._t0 = performance.now();
    this._needsRedraw = true;
    this._resizeObserver = new ResizeObserver(() => this.resize());
    this._resizeObserver.observe(canvas);
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this._needsRedraw = true;
  }

  // Map unit star to pixel position. We add a small inset so stars don't
  // sit right on the edge.
  starPixel(star) {
    const inset = 18;
    const w = this.width  - inset * 2;
    const h = this.height - inset * 2;
    return { x: inset + star.ux * w, y: inset + star.uy * h };
  }

  hitTest(x, y, radius = 22) {
    let best = -1;
    let bestD2 = radius * radius;
    for (let i = 0; i < this.stars.length; i++) {
      const p = this.starPixel(this.stars[i]);
      const dx = p.x - x;
      const dy = p.y - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; best = i; }
    }
    return best;
  }

  setHover(index) {
    if (this.hoverIndex !== index) {
      this.hoverIndex = index;
      this._needsRedraw = true;
    }
  }

  setPending(index) {
    if (this.pendingIndex !== index) {
      this.pendingIndex = index;
      this._needsRedraw = true;
    }
  }

  setEdges(edges) {
    this.edges = edges.slice();
    this.selectedSet = new Set();
    for (const [a, b] of this.edges) { this.selectedSet.add(a); this.selectedSet.add(b); }
    this._needsRedraw = true;
  }

  // Append more stars (e.g. for permalink-restored constellations whose
  // node positions are not in the original deterministic starfield).
  // Returns the index of the first appended star.
  addStars(extra) {
    const start = this.stars.length;
    for (const s of extra) {
      this.stars.push(s);
      this.twinkle.push(Math.random() * Math.PI * 2);
    }
    this._needsRedraw = true;
    return start;
  }

  _loop(now) {
    // Twinkle + ring animations need redraw, even if state didn't change.
    this._needsRedraw = true;
    this.draw(now);
    this._raf = requestAnimationFrame(this._loop);
  }

  draw(now = performance.now()) {
    const { ctx, width, height } = this;
    const t = (now - this._t0) / 1000;

    ctx.clearRect(0, 0, width, height);

    // Background stars
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const p = this.starPixel(s);
      const isSelected = this.selectedSet.has(i);
      const isPending  = i === this.pendingIndex;
      const isHover    = i === this.hoverIndex;

      // Tier governs base size & opacity for unselected stars.
      const baseR = [0.9, 1.4, 2.2][s.tier];
      const baseA = [0.55, 0.78, 0.95][s.tier];
      // Slow twinkle.
      const twinkle = 0.85 + 0.15 * Math.sin(t * 1.4 + this.twinkle[i]);

      if (isSelected) {
        // Halo
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14);
        grad.addColorStop(0, 'rgba(240,229,208,.55)');
        grad.addColorStop(1, 'rgba(240,229,208,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = '#f5ecd6';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.8, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = `rgba(232,228,220,${baseA * twinkle})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, baseR, 0, Math.PI * 2); ctx.fill();
      }

      // Hover ring
      if (isHover && !isSelected && !isPending) {
        ctx.strokeStyle = 'rgba(240,229,208,.4)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2); ctx.stroke();
      }

      // Pending pulse
      if (isPending) {
        const pulse = 6 + Math.sin(t * 3.6) * 2;
        ctx.strokeStyle = 'rgba(240,229,208,.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, pulse, 0, Math.PI * 2); ctx.stroke();

        ctx.fillStyle = '#fff7e0';
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Edges
    if (this.edges.length) {
      ctx.save();
      ctx.shadowColor = 'rgba(240,229,208,.45)';
      ctx.shadowBlur = 6;
      ctx.strokeStyle = 'rgba(232,216,184,.85)';
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      for (const [a, b] of this.edges) {
        const pa = this.starPixel(this.stars[a]);
        const pb = this.starPixel(this.stars[b]);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  destroy() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._resizeObserver.disconnect();
  }
}

// --- Canonicalisation + hash ---------------------------------------------
// Two users who draw "the same" constellation should get the same key.
// Steps:
//  1. Drop unused stars; keep only the indices in any edge.
//  2. Take their unit positions, normalise to a unit bounding box.
//  3. Snap to a 32x32 grid.
//  4. Re-key by snapped coordinates so duplicates collapse.
//  5. Sort edges canonically and stringify.
//  6. SHA-256 → base32 short id.
export async function canonicalKey(stars, edges) {
  const used = new Set();
  for (const [a, b] of edges) { used.add(a); used.add(b); }
  const indices = [...used];
  if (indices.length === 0) return null;

  // Normalise positions to a unit bounding box.
  let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const s = stars[i];
    if (s.ux < minX) minX = s.ux;
    if (s.uy < minY) minY = s.uy;
    if (s.ux > maxX) maxX = s.ux;
    if (s.uy > maxY) maxY = s.uy;
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const span = Math.max(spanX, spanY);

  const N = 32;
  // Map each used star -> snapped grid coord (quantised by N).
  const snapped = new Map();
  for (const i of indices) {
    const s = stars[i];
    const nx = (s.ux - minX) / span;
    const ny = (s.uy - minY) / span;
    const gx = Math.round(nx * (N - 1));
    const gy = Math.round(ny * (N - 1));
    snapped.set(i, gy * N + gx);
  }

  // Canonical edges: each as sorted pair of snapped ids; dedupe + sort.
  const edgeStrings = new Set();
  for (const [a, b] of edges) {
    const sa = snapped.get(a);
    const sb = snapped.get(b);
    if (sa === sb) continue; // collapsed
    const lo = Math.min(sa, sb);
    const hi = Math.max(sa, sb);
    edgeStrings.add(`${lo}-${hi}`);
  }
  const sortedEdges = [...edgeStrings].sort();
  if (sortedEdges.length === 0) return null;

  const payload = sortedEdges.join(',');
  const buf = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  // Take 10 bytes -> base32 (16 chars), readable in URL.
  const bytes = new Uint8Array(digest).slice(0, 10);
  return base32(bytes);
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
