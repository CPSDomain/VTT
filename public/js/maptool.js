// Reading MapTool files: campaigns (.cmpgn), maps (.rpmap) and tokens (.rptok).
// They're zip files holding content.xml (MapTool's objects written out by XStream) and an assets/ folder
// with the images. Nothing here needs MapTool or Java: the zip is read with the browser's own inflater.

// ---------- zip ----------
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer()), dv = new DataView(buf.buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error(`${file.name} isn't a MapTool file (not a zip)`);
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entries = new Map(), dec = new TextDecoder();
  for (let n = 0; n < count && dv.getUint32(p, true) === 0x02014b50; n++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true), name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = buf.subarray(start, start + csize);
    entries.set(name, async () => {
      if (method === 0) return raw;
      if (method !== 8) throw new Error('unsupported compression in ' + name);
      return new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    });
  }
  return entries;
}

// ---------- XStream XML ----------
// XStream writes a repeated object once and refers back to it with an XPath ("../../entry[2]/..."); follow those.
function deref(el) {
  for (let n = 0; el && el.getAttribute && el.hasAttribute('reference') && n < 30; n++) {
    try { el = el.ownerDocument.evaluate(el.getAttribute('reference'), el, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch { return null; }
  }
  return el;
}
const kids = (el, name) => (el ? [...el.children].filter((c) => !name || c.tagName === name).map(deref).filter(Boolean) : []);
const kid = (el, name) => kids(el, name)[0] || null;
const txt = (el, name) => { const k = kid(el, name); return k ? k.textContent.trim() : null; };
const num = (el, name, d = 0) => { const v = Number(txt(el, name)); return Number.isFinite(v) ? v : d; };
const bool = (el, name, d) => { const v = txt(el, name); return v == null ? d : v === 'true'; };
const md5Of = (el) => (el ? txt(el, 'id') : null);

// Square-grid footprints are fixed in MapTool, so their ids tell us the size.
const FOOTPRINTS = {
  '7F000101D065152A060000002A000100': 2, // Large
  '7F000101D065152A070000002A000100': 3, // Huge
  '7F000101D165152A080000002A000101': 4, // Gargantuan
  '7F000101E165152A090000002A000101': 6 // Colossal
};
function footprintSize(tok) {
  for (const e of kids(kid(tok, 'sizeMap'), 'entry')) {
    const g = [...e.children].map(deref).find((c) => c && /GUID$/.test(c.tagName));
    const b64 = g && txt(g, 'baGUID');
    if (!b64) continue;
    try { const hex = [...atob(b64)].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('').toUpperCase(); if (FOOTPRINTS[hex]) return FOOTPRINTS[hex]; } catch { /* ignore */ }
  }
  return 1;
}
// java.awt.geom.Area is saved as its edges ("curves"), each running top to bottom with a direction.
// We keep them as straight segments [x0, y0, x1, y1, direction] (curves become their chords).
function areaSegs(el) {
  const out = [];
  const curves = kid(el, 'curves');
  for (const c of kids(curves)) {
    if (!/Order[123]$/.test(c.tagName)) continue;
    const x0 = num(c, 'x0', NaN), y0 = num(c, 'y0', NaN), x1 = num(c, 'x1', NaN), y1 = num(c, 'y1', NaN);
    if ([x0, y0, x1, y1].some((v) => !Number.isFinite(v))) continue;
    out.push([x0, y0, x1, y1, num(c, 'direction', 1) || 1]);
  }
  return out;
}
// is a point inside an Area? (non-zero winding: add up the edges crossed going right)
export function inArea(segs, px, py) {
  let w = 0;
  for (const [x0, y0, x1, y1, dir] of segs) {
    if (y0 === y1 || py < Math.min(y0, y1) || py >= Math.max(y0, y1)) continue;
    const x = x0 + (x1 - x0) * (py - y0) / (y1 - y0);
    if (x > px) w += dir;
  }
  return w !== 0;
}
const colourOf = (paint) => {
  if (!paint || !/ColorPaint/.test(paint.getAttribute('class') || paint.tagName)) return null;
  const c = num(paint, 'color', 0) >>> 0, a = (c >>> 24) / 255;
  return `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a || 1})`;
};
const point = (el) => (el ? [num(el, 'x'), num(el, 'y')] : null);
// a drawing: its shape in map pixels, and how it's painted
function drawingInfo(de) {
  const d = kid(de, 'drawable'), pen = kid(de, 'pen');
  if (!d || !pen || bool(pen, 'eraser', false)) return [];
  const cls = d.getAttribute('class') || '';
  if (/Template/.test(cls)) return []; // spell templates in MapTool are temporary; not brought across
  let stroke = colourOf(kid(pen, 'paint')) || colourOf(kid(pen, 'foregroundPaint'));
  let fill = colourOf(kid(pen, 'backgroundPaint'));
  if (!stroke && txt(pen, 'color') != null && num(pen, 'foregroundMode', 0) === 0) { const c = num(pen, 'color') >>> 0; stroke = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`; }
  if (!fill && txt(pen, 'backgroundColor') != null && num(pen, 'backgroundMode', 1) === 0) { const c = num(pen, 'backgroundColor') >>> 0; fill = `rgb(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255})`; }
  const style = { stroke, fill, width: num(pen, 'thickness', 3) || 3, opacity: num(pen, 'opacity', 1) || 1, square: bool(pen, 'squareCap', false) };
  if (/DrawablesGroup/.test(cls)) return kids(kid(d, 'drawableList')).flatMap(drawingInfo);
  if (/LineSegment/.test(cls)) {
    const pts = kids(kid(d, 'points')).map(point).filter(Boolean);
    return pts.length > 1 ? [{ ...style, kind: 'line', pts, width: num(d, 'width', style.width) || style.width }] : [];
  }
  if (/drawing\.(Rectangle|Oval|Cross)$/.test(cls)) {
    const a = point(kid(d, 'startPoint')), b = point(kid(d, 'endPoint'));
    if (!a || !b) return [];
    const kind = /Oval/.test(cls) ? 'oval' : /Cross/.test(cls) ? 'cross' : 'rect';
    return [{ ...style, kind, x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) }];
  }
  if (/ShapeDrawable/.test(cls)) {
    const sh = kid(d, 'shape'); if (!sh) return [];
    const sc = sh.getAttribute('class') || '';
    if (/Rectangle|Ellipse/.test(sc)) return [{ ...style, kind: /Ellipse/.test(sc) ? 'oval' : 'rect', x: num(sh, 'x'), y: num(sh, 'y'), w: num(sh, 'width'), h: num(sh, 'height') }];
    if (/geom\.Area$/.test(sc)) return [{ ...style, kind: 'area', segs: areaSegs(sh) }];
    if (/Path2D|GeneralPath/.test(sc)) {
      const typesB64 = txt(sh, 'pointTypes'); const coordsEl = kid(sh, 'doubleCoords') || kid(sh, 'floatCoords');
      if (!typesB64 || !coordsEl) return [];
      const types = [...atob(typesB64)].map((ch) => ch.charCodeAt(0)).slice(0, num(sh, 'numTypes', 1e9));
      const coords = kids(coordsEl).map((c) => Number(c.textContent));
      return [{ ...style, kind: 'path', types, coords }];
    }
  }
  return [];
}

function tokenInfo(t) {
  const facing = txt(t, 'facing');
  const img = (() => {
    const entries = kids(kid(t, 'imageAssetMap'), 'entry');
    const pick = entries.find((e) => e.children[0] && e.children[0].tagName === 'null') || entries[0];
    return pick ? md5Of([...pick.children].map(deref).find((c) => c && /MD5Key$/.test(c.tagName))) : null;
  })();
  // hit points from the token's properties, if the campaign has them (HP, Hit Points, MaxHP…)
  const props = {};
  for (const e of kid(t, 'propertyMapCI') ? kid(t, 'propertyMapCI').querySelectorAll('entry') : []) {
    const parts = [...e.querySelectorAll('string')].map((s) => s.textContent.trim());
    if (parts.length >= 2) props[parts[0].toLowerCase().replace(/[^a-z]/g, '')] = parts[parts.length - 1];
  }
  const pnum = (...keys) => { for (const k of keys) { const v = parseInt(props[k], 10); if (Number.isFinite(v)) return v; } return null; };
  return {
    name: txt(t, 'name') || '', gmName: txt(t, 'gmName') || '', layer: (txt(t, 'layer') || 'TOKEN').toUpperCase(),
    x: num(t, 'x'), y: num(t, 'y'), z: num(t, 'z'), w: num(t, 'width'), h: num(t, 'height'), sx: num(t, 'scaleX', 1), sy: num(t, 'scaleY', 1),
    snapScale: bool(t, 'snapToScale', true), snapGrid: bool(t, 'snapToGrid', true), visible: bool(t, 'isVisible', true),
    facing: facing == null ? null : Number(facing), shape: txt(t, 'tokenShape') || '', type: txt(t, 'tokenType') || 'NPC',
    owners: kids(kid(t, 'ownerList'), 'string').map((s) => s.textContent.trim()), fp: footprintSize(t), img,
    hp: pnum('hp', 'hitpoints', 'currenthp', 'hpcurrent'), maxHp: pnum('maxhp', 'hpmax', 'maxhitpoints'),
    sight: txt(t, 'sightType') || '', hasSight: bool(t, 'hasSight', false),
    lights: kids(kid(t, 'lightSourceList')).map((a) => txt(kid(a, 'lightSourceId'), 'baGUID')).filter(Boolean)
  };
}
function zoneInfo(z) {
  const grid = kid(z, 'grid'), gridClass = grid ? grid.getAttribute('class') || '' : '';
  const bp = kid(z, 'boardPosition'), paint = kid(z, 'backgroundPaint');
  const tokens = [];
  for (const e of kids(kid(z, 'tokenMap'), 'entry')) {
    const t = [...e.children].map(deref).find((c) => c && /Token$/.test(c.tagName));
    if (t) tokens.push(tokenInfo(t));
  }
  const labels = [];
  for (const e of kids(kid(z, 'labels'), 'entry')) {
    const l = [...e.children].map(deref).find((c) => c && /Label$/.test(c.tagName));
    if (l && txt(l, 'label')) labels.push({ text: txt(l, 'label'), x: num(l, 'x'), y: num(l, 'y') });
  }
  let bgColour = null, bgTexture = null;
  if (paint && /ColorPaint/.test(paint.getAttribute('class') || '')) { const c = num(paint, 'color', -16777216) >>> 0; bgColour = '#' + (c & 0xffffff).toString(16).padStart(6, '0'); }
  if (paint && /TexturePaint/.test(paint.getAttribute('class') || '')) bgTexture = md5Of(kid(paint, 'assetId')) || md5Of(kid(paint, 'asset'));
  // fog: what's been revealed, for the whole party and each token's own exploration
  const exposed = [areaSegs(kid(z, 'exposedArea'))];
  for (const e of kids(kid(z, 'exposedAreaMeta'), 'entry')) { const m = [...e.children].map(deref).find((c) => c && /ExposedAreaMetaData$/.test(c.tagName)); if (m) exposed.push(areaSegs(kid(m, 'exposedAreaHistory'))); }
  // walls: vision blocking shapes (their outlines), and the wall lines newer MapTool versions draw
  const blockSegs = [...areaSegs(kid(z, 'topology')), ...areaSegs(kid(z, 'coverVbl')), ...areaSegs(kid(z, 'hillVbl'))].map(([a, b, c, d]) => [a, b, c, d]);
  const wallEl = kid(z, 'walls');
  if (wallEl) {
    const verts = {};
    for (const v of wallEl.querySelectorAll('[id][x][y]')) verts[v.getAttribute('id')] = [Number(v.getAttribute('x')), Number(v.getAttribute('y'))];
    for (const w of wallEl.querySelectorAll('[from][to]')) { const a = verts[w.getAttribute('from')], b = verts[w.getAttribute('to')]; if (a && b) blockSegs.push([a[0], a[1], b[0], b[1]]); }
  }
  const drawings = [];
  for (const [field, layer] of [['backgroundDrawables', 'BACKGROUND'], ['objectDrawables', 'OBJECT'], ['drawables', 'TOKEN']]) {
    for (const de of kids(kid(z, field))) drawingInfo(de).forEach((d) => drawings.push({ ...d, layer }));
  }
  return {
    name: txt(z, 'playerAlias') || txt(z, 'name') || 'MapTool map',
    exposed: exposed.filter((a) => a.length), blockSegs, drawings,
    hasFog: bool(z, 'hasFog', false), visionType: (txt(z, 'visionType') || 'OFF').toUpperCase(), unitsPerCell: num(z, 'unitsPerCell', 5) || 5,
    gridSize: num(grid, 'size', 50) || 50, offX: num(grid, 'offsetX'), offY: num(grid, 'offsetY'),
    hex: /Hex|Isometric/i.test(gridClass), gridless: /Gridless/i.test(gridClass),
    mapAsset: md5Of(kid(z, 'mapAsset')), boardX: num(bp, 'x'), boardY: num(bp, 'y'),
    imageScaleX: num(z, 'imageScaleX', 1) || 1, imageScaleY: num(z, 'imageScaleY', 1) || 1,
    bgColour, bgTexture, tokens, labels
  };
}

// ---------- assets ----------
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' };
function assetReader(zip) {
  const cache = new Map();
  return (md5) => {
    if (!md5) return Promise.resolve(null);
    if (!cache.has(md5)) cache.set(md5, (async () => {
      // newer MapTool: assets/<md5>.<ext> holds the image; older: the image is base64 inside assets/<md5>
      for (const [name, get] of zip) {
        const m = name.match(/^assets\/([0-9a-f]+)\.([a-z0-9]+)$/i);
        if (m && m[1] === md5 && MIME[m[2].toLowerCase()]) return new Blob([await get()], { type: MIME[m[2].toLowerCase()] });
      }
      const xmlGet = zip.get('assets/' + md5);
      if (!xmlGet) return null;
      const bytes = await xmlGet();
      if (bytes[0] === 0x89 && bytes[1] === 0x50) return new Blob([bytes], { type: 'image/png' });
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return new Blob([bytes], { type: 'image/jpeg' });
      const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'text/xml');
      const ext = (doc.querySelector('extension') || {}).textContent || 'png';
      const data = doc.querySelector('image') || doc.querySelector('data');
      if (!data) return null;
      const bin = atob(data.textContent.replace(/\s+/g, '')), arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: MIME[ext.toLowerCase()] || 'image/png' });
    })().catch(() => null));
    return cache.get(md5);
  };
}

// ---------- the whole file ----------
export async function readMapTool(file) {
  const zip = await readZip(file);
  const content = zip.get('content.xml');
  if (!content) throw new Error(`${file.name} has no content.xml; is it a MapTool file?`);
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(await content()), 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(`Couldn't read the map data in ${file.name}`);
  const root = doc.documentElement;
  const asset = assetReader(zip);
  if (/Token$/.test(root.tagName)) return { kind: 'token', token: tokenInfo(root), asset }; // .rptok
  // light sources defined in a campaign: GUID → [bright, dim] in feet (a light with no colour is bright,
  // the widest one is how far dim light reaches, as in MapTool's own D20 lights)
  const lightDefs = {};
  for (const ls of doc.getElementsByTagName('*')) {
    if (!/LightSource$/.test(ls.tagName) || ls.hasAttribute('reference') || /Attached/.test(ls.tagName)) continue;
    const id = txt(kid(ls, 'id'), 'baGUID'); if (!id) continue;
    if (/AURA/i.test(txt(ls, 'type') || '')) continue;
    const ls2 = kids(kid(ls, 'lightList')).map((l) => ({ r: num(l, 'radius', 0), dark: !!kid(l, 'paint'), gm: bool(l, 'isGM', false) })).filter((l) => l.r > 0 && !l.gm);
    if (!ls2.length) continue;
    const bright = Math.min(...ls2.filter((l) => !l.dark).map((l) => l.r).concat(ls2.length === 1 ? [ls2[0].r] : [])), dim = Math.max(...ls2.map((l) => l.r));
    lightDefs[id] = [Number.isFinite(bright) ? bright : dim / 2, dim];
  }
  const zones = [...doc.getElementsByTagName('*')].filter((el) => !el.hasAttribute('reference') && (el.tagName === 'zone' || /\.Zone$/.test(el.tagName)) && kid(el, 'grid'));
  return { kind: 'maps', maps: zones.map(zoneInfo), asset, lightDefs };
}

// Lay a MapTool map out on our grid: where it starts, how many squares, and where each piece goes.
// MapTool maps have no edge, so the map is as big as what's on it: the map image, the stamps and the tokens.
export function layout(z, imgSizes) {
  const S = z.gridSize, rects = [];
  const cellOf = (x, y) => [Math.floor((x - z.offX) / S), Math.floor((y - z.offY) / S)];
  if (z.mapAsset && imgSizes[z.mapAsset]) { const s = imgSizes[z.mapAsset]; rects.push([z.boardX, z.boardY, z.boardX + s.w * z.imageScaleX, z.boardY + s.h * z.imageScaleY]); }
  const placed = z.tokens.map((t) => {
    let x, y, w, h;
    const [cx, cy] = cellOf(t.x, t.y);
    if (t.snapScale) { w = h = t.fp * S; } else { w = (t.w || S) * t.sx; h = (t.h || S) * t.sy; }
    if (t.snapGrid) { x = z.offX + cx * S; y = z.offY + cy * S; if (!t.snapScale && t.layer !== 'TOKEN') { x -= (w - t.fp * S) / 2; y -= (h - t.fp * S) / 2; } } else { x = t.x; y = t.y; }
    rects.push([x, y, x + w, y + h]);
    return { ...t, px: x, py: y, pw: w, ph: h, cx, cy };
  });
  for (const l of z.labels) rects.push([l.x - S / 2, l.y - S / 2, l.x + S / 2, l.y + S / 2]);
  for (const d of z.drawings || []) {
    const xs = d.pts ? d.pts.map((p) => p[0]) : d.segs ? d.segs.flatMap((g) => [g[0], g[2]]) : d.coords ? d.coords.filter((_, i) => i % 2 === 0) : [d.x, d.x + d.w];
    const ys = d.pts ? d.pts.map((p) => p[1]) : d.segs ? d.segs.flatMap((g) => [g[1], g[3]]) : d.coords ? d.coords.filter((_, i) => i % 2 === 1) : [d.y, d.y + d.h];
    if (xs.length) rects.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r[0])), minY = Math.min(...rects.map((r) => r[1]));
  const maxX = Math.max(...rects.map((r) => r[2])), maxY = Math.max(...rects.map((r) => r[3]));
  const [gx0, gy0] = cellOf(minX + 0.01, minY + 0.01);
  const gx1 = Math.ceil((maxX - z.offX) / S - 0.01), gy1 = Math.ceil((maxY - z.offY) / S - 0.01);
  const cols = Math.max(5, gx1 - gx0), rows = Math.max(5, gy1 - gy0);
  return { S, gx0, gy0, cols, rows, originX: z.offX + gx0 * S, originY: z.offY + gy0 * S, placed };
}
