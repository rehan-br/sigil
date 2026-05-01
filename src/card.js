// Render a downloadable PNG "card" of the sigil: navy background, faint
// starfield, the user's constellation, name + myth + URL. Used by the
// download button on the reveal screen.

const W = 1200;
const H = 1500;

const PALETTE = {
  bg0: '#161b35',
  bg1: '#0e1226',
  bg2: '#06091a',
  starWarm: '#f5ecd6',
  starWarmHalo: 'rgba(240,229,208,.55)',
  starWarmFaint: 'rgba(240,229,208,.55)',
  edge: 'rgba(232,216,184,.85)',
  edgeGlow: 'rgba(240,229,208,.45)',
  bgStar: 'rgba(232,228,220,1)',
  ink: '#f0e5d0',
  inkBody: 'rgba(232,228,220,.92)',
  inkDim: 'rgba(240,229,208,.55)',
};

// --- Tiny seeded RNG (mirrors sky.js) ---
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

export async function downloadSigilCard({ id, name, myth, stars, edges }) {
  // Make sure the Instrument Serif / Outfit fonts are available before we
  // rasterise. They're already loaded by the page; this just blocks until
  // FontFace registration is complete.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch {}
  }

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawBackgroundStars(ctx);
  drawConstellation(ctx, stars, edges);
  drawText(ctx, { id, name, myth });

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob returned null');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sigil-${id}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, W * 0.6, H);
  grad.addColorStop(0,    PALETTE.bg0);
  grad.addColorStop(0.55, PALETTE.bg1);
  grad.addColorStop(1,    PALETTE.bg2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Two soft accent washes, mirroring the on-screen #sky-container.
  const accent1 = ctx.createRadialGradient(W * 0.30, H * 0.18, 0, W * 0.30, H * 0.18, W * 0.6);
  accent1.addColorStop(0, 'rgba(60,80,150,.22)');
  accent1.addColorStop(1, 'rgba(60,80,150,0)');
  ctx.fillStyle = accent1;
  ctx.fillRect(0, 0, W, H);

  const accent2 = ctx.createRadialGradient(W * 0.85, H * 0.78, 0, W * 0.85, H * 0.78, W * 0.55);
  accent2.addColorStop(0, 'rgba(120,80,180,.16)');
  accent2.addColorStop(1, 'rgba(120,80,180,0)');
  ctx.fillStyle = accent2;
  ctx.fillRect(0, 0, W, H);

  // 1px inner border, like the on-screen card.
  ctx.strokeStyle = 'rgba(255,255,255,.08)';
  ctx.lineWidth = 2;
  roundRect(ctx, 16, 16, W - 32, H - 32, 26);
  ctx.stroke();
}

function drawBackgroundStars(ctx) {
  const rand = mulberry32(0xC07057E1);
  for (let i = 0; i < 320; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const t = rand();
    const r = t < 0.65 ? 1.1 : t < 0.92 ? 1.6 : 2.4;
    const a = t < 0.65 ? 0.45 : t < 0.92 ? 0.7 : 0.9;
    ctx.fillStyle = `rgba(232,228,220,${a})`;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}

function drawConstellation(ctx, stars, edges) {
  if (!stars?.length || !edges?.length) return;

  // Constellation panel: upper portion of the card.
  const panel = { x0: 120, x1: W - 120, y0: 130, y1: 740 };

  let minX =  Infinity, minY =  Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of stars) {
    if (s.ux < minX) minX = s.ux;
    if (s.uy < minY) minY = s.uy;
    if (s.ux > maxX) maxX = s.ux;
    if (s.uy > maxY) maxY = s.uy;
  }
  const spanX = Math.max(0.05, maxX - minX);
  const spanY = Math.max(0.05, maxY - minY);
  const panelW = panel.x1 - panel.x0;
  const panelH = panel.y1 - panel.y0;
  // Fit, preserving aspect, with breathing room.
  const scale = Math.min(panelW / spanX, panelH / spanY) * 0.78;
  const cx = (panel.x0 + panel.x1) / 2;
  const cy = (panel.y0 + panel.y1) / 2;
  const mx = (minX + maxX) / 2;
  const my = (minY + maxY) / 2;
  const toPx = (s) => ({ x: cx + (s.ux - mx) * scale, y: cy + (s.uy - my) * scale });

  // Edges (with glow)
  ctx.save();
  ctx.shadowColor = PALETTE.edgeGlow;
  ctx.shadowBlur = 14;
  ctx.strokeStyle = PALETTE.edge;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  for (const [a, b] of edges) {
    const pa = toPx(stars[a]);
    const pb = toPx(stars[b]);
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  ctx.restore();

  // Stars (halo + core)
  for (const s of stars) {
    const p = toPx(s);
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 32);
    halo.addColorStop(0, PALETTE.starWarmHalo);
    halo.addColorStop(1, 'rgba(240,229,208,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(p.x, p.y, 32, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = PALETTE.starWarm;
    ctx.beginPath(); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.fill();
  }
}

function drawText(ctx, { id, name, myth }) {
  // Eyebrow
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '600 18px "Outfit", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`SIGIL  ·  ${id.toUpperCase()}`, W / 2, 90);

  // Name (italic Instrument Serif)
  ctx.fillStyle = PALETTE.ink;
  ctx.font = 'italic 76px "Instrument Serif", Georgia, serif';
  // Auto-shrink if name is unusually long.
  let nameSize = 76;
  while (ctx.measureText(name).width > W - 240 && nameSize > 44) {
    nameSize -= 4;
    ctx.font = `italic ${nameSize}px "Instrument Serif", Georgia, serif`;
  }
  ctx.fillText(name, W / 2, 850);

  // Myth body — wrap to width.
  ctx.fillStyle = PALETTE.inkBody;
  ctx.font = '26px "Instrument Serif", Georgia, serif';
  const box = { x: 130, y: 940, w: W - 260, lineHeight: 40, maxLines: 12 };
  wrapText(ctx, myth, box);

  // Footer URL
  ctx.fillStyle = PALETTE.inkDim;
  ctx.font = '500 18px "Outfit", system-ui, sans-serif';
  ctx.fillText(`sigil.thedeveloperguys.com/c/${id}`, W / 2, H - 60);
}

function wrapText(ctx, text, { x, y, w, lineHeight, maxLines }) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > w && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
    if (maxLines && lines.length >= maxLines - 1) break;
  }
  if (line) lines.push(line);
  if (maxLines && lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S+$/, '…');
  }
  ctx.textAlign = 'center';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + w / 2, y + i * lineHeight);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}
