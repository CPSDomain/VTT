// Token art: built-in icons (game-icons.net, CC BY 3.0) on coloured discs, or uploaded images cropped to a circle.
let data = { icons: {}, library: [], credit: '', size: 512 };
const iconImgs = {}, photoImgs = {};
let onReady = () => {};
export const ready = fetch('tokens.json').then((r) => r.json()).then((d) => { data = d; onReady(); return d; }).catch(() => data);
export const whenArtLoads = (fn) => { onReady = fn; };
export const builtins = () => data.library;
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
    const s = Math.max((rad * 2) / img.naturalWidth, (rad * 2) / img.naturalHeight);
    g.drawImage(img, cx - (img.naturalWidth * s) / 2, cy - (img.naturalHeight * s) / 2, img.naturalWidth * s, img.naturalHeight * s);
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
