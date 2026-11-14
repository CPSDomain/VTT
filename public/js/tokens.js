// Token art: built-in icons (game-icons.net, CC BY 3.0) on coloured discs, or uploaded images cropped to a circle.
let data = { icons: {}, library: [], credit: '', size: 512 };
const iconImgs = {}, photoImgs = {};
let onReady = () => {};
export const ready = fetch('tokens.json').then((r) => r.json()).then((d) => { data = d; onReady(); return d; }).catch(() => data);
export const whenArtLoads = (fn) => { onReady = fn; };
export const builtins = () => data.library;
export const conditions = () => data.conditions || [];
const condById = () => Object.fromEntries((data.conditions || []).map((c) => [c.id, c]));

// A small round condition badge (white icon on the condition's colour).
export function drawCondition(g, id, cx, cy, r, redraw = () => {}) {
  const c = condById()[id]; if (!c) return;
  g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = c.color; g.fill();
  g.lineWidth = Math.max(1, r * 0.18); g.strokeStyle = 'rgba(0,0,0,.75)'; g.stroke();
  const ic = iconImage(c.icon, '#ffffff', redraw);
  if (ic && ic.complete && ic.naturalWidth) { const s = r * 1.45; g.drawImage(ic, cx - s / 2, cy - s / 2, s, s); }
}
export function conditionThumb(id, px, canvas) {
  const c = canvas || document.createElement('canvas'); c.width = c.height = px * 2;
  const g = c.getContext('2d');
  const paint = () => { g.clearRect(0, 0, c.width, c.height); drawCondition(g, id, px, px, px - 2, paint); };
  paint(); return c;
}
export const credit = () => data.credit;

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const iconColor = (bg) => (luminance(bg || '#888888') > 0.6 ? '#1c1917' : '#f6f1e7');

// Images are shared by every token that uses them, so each keeps a list of who to redraw once it loads.
function loadShared(cache, key, src, redraw) {
  let img = cache[key];
  if (!img) {
    img = new Image(); img.waiting = new Set();
    img.onload = () => { img.waiting.forEach((fn) => fn()); img.waiting.clear(); };
    img.src = src; cache[key] = img;
  }
  if (!img.complete) img.waiting.add(redraw);
  return img;
}
function iconImage(name, fg, redraw) {
  const body = data.icons[name];
  if (!body) return null;
  return loadShared(iconImgs, name + fg, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.size} ${data.size}" color="${fg}" fill="${fg}">${body}</svg>`), redraw);
}
const photo = (url, redraw) => loadShared(photoImgs, url, url, redraw);

const initials = (l = '?') => { const w = l.trim().split(/\s+/); return (w.length > 1 && /\d/.test(w[w.length - 1]) ? w[0][0] + w[w.length - 1] : l.slice(0, 2)).toUpperCase(); };

// Draw a token disc centred on (cx, cy). t = { color, icon?, img?, label }.
export function drawTokenArt(g, t, cx, cy, rad, redraw = () => {}) {
  const col = t.color || '#888888';
  g.save();
  g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = rad * 0.3; g.shadowOffsetY = rad * 0.06;
  g.beginPath(); g.arc(cx, cy, rad, 0, Math.PI * 2);
  const grd = g.createRadialGradient(cx - rad * .35, cy - rad * .4, rad * .1, cx, cy, rad);
  grd.addColorStop(0, shade(col, 0.25)); grd.addColorStop(1, shade(col, -0.2));
  g.fillStyle = grd; g.fill();
  g.restore();

  const img = t.img ? photo(t.img, redraw) : null;
  if (img && img.complete && img.naturalWidth) {
    g.save(); g.beginPath(); g.arc(cx, cy, rad - 1, 0, Math.PI * 2); g.clip();
    // a portrait: zoomed and moved inside the circle as its owner set it (imgPos: x, y from -1 to 1, z from 1 to 4)
    const p = t.imgPos || {}, z = Math.max(1, Math.min(4, p.z || 1));
    const s = Math.max((rad * 2) / img.naturalWidth, (rad * 2) / img.naturalHeight) * z, w = img.naturalWidth * s, h = img.naturalHeight * s;
    const ox = (p.x || 0) * Math.max(0, (w - rad * 2) / 2), oy = (p.y || 0) * Math.max(0, (h - rad * 2) / 2);
    g.drawImage(img, cx - w / 2 - ox, cy - h / 2 - oy, w, h);
    g.restore();
  } else {
    const ic = t.icon ? iconImage(t.icon, iconColor(col), redraw) : null;
    if (ic && ic.complete && ic.naturalWidth) {
      const s = rad * 1.42; g.drawImage(ic, cx - s / 2, cy - s / 2, s, s);
    } else {
      g.fillStyle = iconColor(col); g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${Math.max(9, rad * 0.8)}px system-ui, sans-serif`;
      g.fillText(initials(t.label), cx, cy + 1);
    }
  }
  drawFrame(g, t, cx, cy, rad);
}

// a frame round the token: gold, silver, iron, wood, or the token's own colour
const FRAMES = { gold: ['#fff2b0', '#d4a23a', '#7a5212'], silver: ['#ffffff', '#b8c0c8', '#5c6670'], iron: ['#9aa3ab', '#4b535b', '#1f2428'], wood: ['#d9a46a', '#8a5a2b', '#4a2e14'], bronze: ['#ffd29a', '#b0702e', '#5a3412'] };
export const FRAME_NAMES = { '': 'No frame', gold: 'Gold', silver: 'Silver', bronze: 'Bronze', iron: 'Iron', wood: 'Wood', color: 'Its colour' };
export function drawFrame(g, t, cx, cy, rad) {
  if (!t.frame) return;
  const w = Math.max(2, rad * 0.16), r = rad - w / 2 + 1;
  const cols = t.frame === 'color' ? [shade(t.color || '#888888', 0.5), t.color || '#888888', shade(t.color || '#888888', -0.5)] : FRAMES[t.frame]; if (!cols) return;
  const gr = g.createLinearGradient(cx - rad, cy - rad, cx + rad, cy + rad);
  gr.addColorStop(0, cols[0]); gr.addColorStop(0.45, cols[1]); gr.addColorStop(0.55, cols[2]); gr.addColorStop(1, cols[1]);
  g.save(); g.lineWidth = w; g.strokeStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = Math.max(1, w * 0.18); g.strokeStyle = 'rgba(0,0,0,.45)'; g.beginPath(); g.arc(cx, cy, r - w / 2, 0, Math.PI * 2); g.stroke(); // inner edge
  g.strokeStyle = 'rgba(255,255,255,.35)'; g.beginPath(); g.arc(cx, cy, r + w / 2 - 0.5, Math.PI * 1.05, Math.PI * 1.7); g.stroke(); // a glint
  g.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c) => Math.max(0, Math.min(255, Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// Small canvas preview (library tiles, panels).
export function thumb(t, px = 56, canvas) {
  const c = canvas || document.createElement('canvas');
  c.width = c.height = px * 2;
  const g = c.getContext('2d');
  const redraw = () => { g.clearRect(0, 0, c.width, c.height); paint(); };
  const paint = () => { drawTokenArt(g, t, px, px, px - 6, redraw); g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.6)'; g.beginPath(); g.arc(px, px, px - 6, 0, Math.PI * 2); g.stroke(); };
  paint();
  return c;
}
