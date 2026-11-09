// Weather drawn over the map: rain, a storm with lightning, snow, drifting fog, rising embers.
// Its own canvas on top of the map, animated only while a map has weather; particles fall in screen space,
// clipped to the map, with as many as the visible area and the strength (1–3) call for.
export function createWeather(canvas, get) {
  const g = canvas.getContext('2d');
  let parts = [], kind = 'none', raf = 0, last = 0, flash = 0, nextFlash = 0, fogTex = null, fogX = 0;
  const rand = (a, b) => a + Math.random() * (b - a);

  function fogTexture() {
    if (fogTex) return fogTex;
    const c = document.createElement('canvas'); c.width = c.height = 512; const f = c.getContext('2d');
    for (let i = 0; i < 70; i++) { // soft puffs, wrapped so the texture tiles
      const x = rand(0, 512), y = rand(0, 512), r = rand(50, 140), a = rand(0.05, 0.16);
      for (const dx of [-512, 0, 512]) for (const dy of [-512, 0, 512]) {
        const gr = f.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        gr.addColorStop(0, `rgba(215,220,228,${a})`); gr.addColorStop(1, 'rgba(215,220,228,0)');
        f.fillStyle = gr; f.fillRect(x + dx - r, y + dy - r, r * 2, r * 2);
      }
    }
    return (fogTex = c);
  }
  function spawn(k, w, h, anywhere) {
    const y = anywhere ? rand(0, h) : rand(-40, -5);
    if (k === 'rain' || k === 'storm') return { x: rand(-60, w + 20), y, v: rand(850, 1250), l: rand(10, 22), a: rand(0.22, 0.45) };
    if (k === 'snow') return { x: rand(0, w), y, v: rand(35, 85), r: rand(1, 3.2), ph: rand(0, 6.28), a: rand(0.55, 0.95) };
    if (k === 'embers') { const ash = Math.random() < 0.35; return { x: rand(0, w), y: ash ? y : anywhere ? rand(0, h) : h + rand(5, 30), v: ash ? rand(25, 50) : -rand(30, 75), r: ash ? rand(1, 2.2) : rand(1, 2.4), ph: rand(0, 6.28), ash, life: rand(0.6, 1) }; }
    return null;
  }
  const density = { rain: 520, storm: 900, snow: 260, embers: 70, fog: 0, none: 0 };

  function frame(t) {
    raf = 0;
    const st = get();
    const dpr = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
    if (!st || st.weather === 'none') { parts = []; kind = 'none'; last = 0; return; }
    const dt = last ? Math.min(0.05, (t - last) / 1000) : 0.016; last = t;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // the part of the map on screen
    const x0 = Math.max(0, st.rect.x), y0 = Math.max(0, st.rect.y), x1 = Math.min(W, st.rect.x + st.rect.w), y1 = Math.min(H, st.rect.y + st.rect.h);
    if (x1 <= x0 || y1 <= y0) { raf = requestAnimationFrame(frame); return; }
    const w = x1 - x0, h = y1 - y0;
    if (kind !== st.weather) { kind = st.weather; parts = []; }
    const want = Math.round(density[kind] * (w * h) / 1e6 * [0, 0.45, 1, 1.8][st.level || 2]);
    while (parts.length < want) parts.push(spawn(kind, w, h, true));
    if (parts.length > want) parts.length = want;
    g.save(); g.beginPath(); g.rect(x0, y0, w, h); g.clip(); g.translate(x0, y0);
    const wind = kind === 'storm' ? 0.38 : kind === 'rain' ? 0.12 : 0;
    if (kind === 'rain' || kind === 'storm') {
      g.lineCap = 'round'; g.lineWidth = 1.1;
      for (const p of parts) {
        p.y += p.v * dt; p.x += p.v * wind * dt;
        if (p.y > h + 20 || p.x > w + 40) Object.assign(p, spawn(kind, w, h, false));
        g.strokeStyle = `rgba(178,196,224,${p.a})`; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.l * wind, p.y - p.l); g.stroke();
      }
      g.fillStyle = `rgba(40,52,72,${0.08 * (st.level || 2)})`; g.fillRect(0, 0, w, h); // the gloom of a downpour
    } else if (kind === 'snow') {
      for (const p of parts) {
        p.ph += dt * 1.3; p.y += p.v * dt; p.x += Math.sin(p.ph) * 18 * dt + 10 * dt * (st.level || 2) / 2;
        if (p.y > h + 6) Object.assign(p, spawn(kind, w, h, false)); if (p.x > w + 5) p.x -= w + 10;
        g.fillStyle = `rgba(255,255,255,${p.a})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill();
      }
      g.fillStyle = `rgba(230,236,245,${0.04 * (st.level || 2)})`; g.fillRect(0, 0, w, h);
    } else if (kind === 'embers') {
      for (const p of parts) {
        p.ph += dt * 3; p.y += p.v * dt; p.x += Math.sin(p.ph) * 12 * dt;
        if (!p.ash) p.life -= dt * 0.12;
        if (p.y < -10 || p.y > h + 10 || p.life <= 0) Object.assign(p, spawn(kind, w, h, false));
        if (p.ash) { g.fillStyle = 'rgba(120,115,110,.7)'; g.fillRect(p.x, p.y, p.r * 1.6, p.r); continue; }
        const a = Math.max(0, p.life) * (0.65 + 0.35 * Math.sin(p.ph * 2.3));
        g.fillStyle = `rgba(255,150,40,${a * 0.35})`; g.beginPath(); g.arc(p.x, p.y, p.r * 3, 0, 6.283); g.fill();
        g.fillStyle = `rgba(255,214,120,${a})`; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.283); g.fill();
      }
      g.fillStyle = `rgba(120,40,10,${0.05 * (st.level || 2)})`; g.fillRect(0, 0, w, h);
    } else if (kind === 'fog') {
      const tex = fogTexture(); fogX = (fogX + dt * 14) % 512;
      g.globalAlpha = [0, 0.45, 0.7, 0.95][st.level || 2];
      for (const [k, s] of [[1, 1.6], [-0.6, 2.4]]) {
        const size = 512 * s, ox = ((fogX * k * s) % size + size) % size;
        for (let x = -ox - size; x < w + size; x += size) for (let y = -(fogX * 0.3 * s % size); y < h + size; y += size) g.drawImage(tex, x, y, size, size);
      }
      g.globalAlpha = 1;
    }
    if (kind === 'storm') { // lightning: a bright flicker now and then
      if (!nextFlash) nextFlash = t + rand(5000, 14000);
      if (t > nextFlash) { flash = 1; nextFlash = t + rand(7000, 20000); }
      if (flash > 0) { const f = flash > 0.7 ? 0.7 : flash > 0.45 ? 0.15 : flash > 0.3 ? 0.55 : flash * 0.9; g.fillStyle = `rgba(225,232,255,${f * 0.6})`; g.fillRect(0, 0, w, h); flash -= dt * 2.2; }
    }
    g.restore();
    raf = requestAnimationFrame(frame);
  }
  return {
    update() { if (!raf) raf = requestAnimationFrame(frame); },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); parts = []; kind = 'none'; }
  };
}

// time of day: a colour the map is multiplied by (null for daylight)
export const TINT = { day: null, dawn: 'rgb(255,214,196)', dusk: 'rgb(236,166,138)', night: 'rgb(88,104,158)' };
// a fitting ambience for a weather or time of day
export const MATCH = { rain: 'rain', storm: 'thunderstorm', snow: 'wind', fog: 'wind', embers: 'campfire', night: 'night' };
